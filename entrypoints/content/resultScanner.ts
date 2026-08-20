/**
 * 逐筆結果比對。
 *
 * query 層級的阻擋是全有全無：搜尋字命中就整頁遮，沒命中就完全不保護。
 * 問題是最需要保護的情境正好落在後者 —— 搜「我家牆上這是什麼」時 query
 * 一個關鍵字都不會命中，但結果標題全是「蜘蛛」。
 *
 * 這支模組補上那張網：對搜尋結果區的每一張圖，讀它所屬結果區塊的文字，
 * 命中黑名單就只隱藏那一張。手法跟 autocomplete 那邊「逐 option 用自己的
 * textContent 判斷」是同一套，只是換了掃描對象。
 *
 * 與 query 層級**疊加而非取代**：query 命中時整頁已經遮了，這支就不跑
 * （省 CPU，也避免重複計數）。
 *
 * ## 為什麼不用 Google 的 class / jsname 找結果卡片
 *
 * 那些屬性 Google 會定期換，是這個專案最大的維護負擔。這裡改成從圖片往上
 * 走，找第一個「文字量足以判斷」的祖先 —— 完全不依賴任何 Google 屬性，
 * 跟 alt 比對一樣天生抗 DOM rotation。
 */
import { findBlockMatch, type BlocklistSettings } from "@/composables/blockList";
import { RESULT_IMAGE_SELECTOR, RESULT_ROOT_SELECTOR } from "./selectors";

/**
 * 超過這個字數代表往上走過頭、抓到整份結果列表了。
 * 這時停止而不是硬判 —— 否則頁面上任何一處出現關鍵字就會擋掉全部圖片，
 * 等於退化成 query 層級阻擋，失去「精準」這個唯一價值。
 */
const MAX_CONTEXT_CHARS = 400;
/** 往上走的層數上限，避免在深巢狀結構裡爬到頁面根部 */
const MAX_WALK_UP = 8;

/**
 * 從一張圖往上收集各層祖先的文字，由近而遠。
 *
 * 刻意**不設「文字至少要幾個字」的門檻**，改成把沿途每一層都交出去讓呼叫端逐一判斷。
 * 原本的寫法是「往上走到文字夠多的那一層才判斷」，有兩個問題：
 *
 *   1. 字數門檻對中文有偏見 —— 「家中常見的蜘蛛種類」只有 9 個字卻資訊完整，
 *      同樣資訊量的英文要 25 個字以上。單一字數門檻等於讓 CJK 使用者少一層保護。
 *   2. 可能停在「廣告」badge 這種有字、但不是標題的容器上，之後就再也看不到標題了。
 *
 * 逐層檢查沒有這兩個問題，代價只是每張圖多幾次 shouldBlock（實測 6 µs 一次）。
 */
export function collectResultContexts(el: Element, root: Element): string[] {
  const contexts: string[] = [];
  let node = el.parentElement;
  for (let i = 0; i < MAX_WALK_UP && node && node !== root; i++) {
    const text = (node.textContent ?? "").trim();
    if (text.length > MAX_CONTEXT_CHARS) break;
    // 巢狀容器常常文字完全相同，不必重複判斷
    if (text && text !== contexts[contexts.length - 1]) contexts.push(text);
    node = node.parentElement;
  }
  return contexts;
}

/**
 * 收集一張圖自己帶的文字描述：alt、title、aria-label，以及外層連結的 aria-label / title。
 *
 * 這是比「往上找周圍文字」更精準也更便宜的訊號，而且抓得到後者抓不到的情境：
 *   - **圖片分頁（`udm=2`）** —— 每個圖磚周圍幾乎沒有文字，但 alt 通常是來源頁標題。
 *     那正是這個產品最關鍵的頁面。
 *   - 結果標題沒提到、但圖片 alt 寫得很清楚的那種
 *   - 輪播與知識面板裡文字稀疏的圖
 *
 * 跟 collectResultContexts 一樣，完全不依賴 Google 的 class / jsname。
 */
export function collectImageLabels(el: Element): string[] {
  const labels: string[] = [];
  const push = (value: string | null | undefined) => {
    const text = value?.trim();
    if (text && !labels.includes(text)) labels.push(text);
  };

  push(el.getAttribute("alt"));
  push(el.getAttribute("title"));
  push(el.getAttribute("aria-label"));

  // 縮圖幾乎都包在連結裡，連結的 aria-label 常常就是完整的結果標題
  const link = el.closest("a");
  if (link) {
    push(link.getAttribute("aria-label"));
    push(link.getAttribute("title"));
  }
  return labels;
}

export interface ResultScanner {
  /** 目前因為逐筆比對而被隱藏的圖片數 */
  readonly hiddenCount: number;
  /** 第一個造成隱藏的命中，供頁面提示說明原因 */
  readonly firstMatch: { keyword: string; categoryLabel: string | null } | null;
  /** 重新掃描（DOM 變動或設定變更後） */
  rescan(): void;
  /** 停止觀察並還原所有自己隱藏的圖片 */
  disconnect(): void;
}

/**
 * 開始逐筆掃描。`onChange` 在隱藏數量變化時觸發，讓頁面提示能更新數字。
 */
/**
 * 要掃描的範圍。找不到任何已知的結果容器時退回 body ——
 * 對這個產品，掃太多遠比完全不掃安全（沒掃到就等於沒保護），
 * 而且圖片自己的 alt 幾乎不可能在導覽列或頭像上誤命中。
 */
function resultRoots(): Element[] {
  const known = document.querySelectorAll(RESULT_ROOT_SELECTOR);
  if (known.length > 0) return [...known];
  return document.body ? [document.body] : [];
}

export function scanResults(
  getSettings: () => BlocklistSettings,
  onChange: () => void,
): ResultScanner {
  /** 已經判斷過的圖片，避免每次掃描重跑同一批 */
  const seen = new WeakSet<Element>();
  /** 自己隱藏起來的圖片，disconnect 時精準還原 */
  const hiddenEls = new Set<HTMLElement>();
  let firstMatch: { keyword: string; categoryLabel: string | null } | null = null;
  let disposed = false;
  let timer = 0;

  function scan() {
    if (disposed) return;
    const settings = getSettings();
    const before = hiddenEls.size;

    for (const root of resultRoots()) {
      for (const el of root.querySelectorAll(RESULT_IMAGE_SELECTOR)) {
        if (seen.has(el)) continue;
        seen.add(el);

        // 先看圖自己帶的描述（更精準也更便宜），再看周圍結果文字
        let match: { keyword: string; categoryLabel: string | null } | null = null;
        for (const text of [
          ...collectImageLabels(el),
          ...collectResultContexts(el, root),
        ]) {
          match = findBlockMatch(text, settings);
          if (match) break;
        }
        if (!match) continue;

        (el as HTMLElement).style.setProperty("display", "none", "important");
        hiddenEls.add(el as HTMLElement);
        firstMatch ??= match;
      }
    }

    if (hiddenEls.size !== before) onChange();
  }

  /** DOM 變動後 debounce 再掃，避免 Google 頻繁改動時空轉 */
  function schedule() {
    if (disposed || timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      scan();
    }, 300);
  }

  const observer = new MutationObserver(schedule);
  // scanner 是 DOM ready 後才建立的，結果區已經存在 —— 直接掛上去，
  // 不必像 autocomplete watcher 那樣先掛 documentElement 再收窄
  for (const root of resultRoots()) {
    observer.observe(root, { childList: true, subtree: true });
  }
  scan();

  return {
    get hiddenCount() {
      return hiddenEls.size;
    },
    get firstMatch() {
      return firstMatch;
    },
    rescan() {
      scan();
    },
    disconnect() {
      disposed = true;
      observer.disconnect();
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      for (const el of hiddenEls) el.style.removeProperty("display");
      hiddenEls.clear();
      firstMatch = null;
    },
  };
}
