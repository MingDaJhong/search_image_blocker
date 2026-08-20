import { defineContentScript } from "wxt/sandbox";
import { browser } from "wxt/browser";
import {
  findBlockMatch,
  loadSettings,
  shouldBlock,
  STORAGE_KEY,
  type BlocklistSettings,
} from "@/composables/blockList";
import {
  DIAGNOSE_MESSAGE,
  TOGGLE_REVEAL_MESSAGE,
  type DiagnosisReport,
} from "@/composables/diagnostics";
import {
  buildBlockCSS,
  buildInitialHideCSS,
  countBlockedElements,
  findRevealTarget,
} from "./selectors";
import { REVEAL_ATTR, SCAN_ATTR, isRevealable } from "./hideStyle";
import { revealOnClick, type ClickRevealer } from "./clickReveal";
import { createIndicator, type Indicator } from "./indicator";
import { scanResults, type ResultScanner } from "./resultScanner";
import { readSearchQuery, watchSearchQuery } from "./softNav";

const BLOCK_STYLE_ID = "sib-block-style";
const INITIAL_STYLE_ID = "sib-initial-hide";

export default defineContentScript({
  // 與 wxt.config.ts 的 host_permissions 同步維護（WXT 靜態分析需要字面量）
  matches: [
    "https://www.google.com/search*",
    "https://www.google.com.tw/search*",
    "https://www.google.com.hk/search*",
    "https://www.google.co.jp/search*",
    "https://www.google.co.kr/search*",
    "https://www.google.com.sg/search*",
    "https://www.google.co.uk/search*",
    "https://www.google.com.au/search*",
    "https://www.google.ca/search*",
    "https://www.google.co.in/search*",
    "https://www.google.de/search*",
    "https://www.google.fr/search*",
    "https://www.google.es/search*",
    "https://www.google.it/search*",
    "https://www.google.com.br/search*",
    "https://www.google.com.mx/search*",
  ],
  runAt: "document_start",
  async main() {
    // 軟導航（切 udm 分頁 / 按篩選 chip）會換掉 `q` 而不重新執行 content script，
    // 所以這是變數不是常數 —— 見 softNav.ts
    let query = readSearchQuery(location.href);

    // 先注入隱藏 CSS（避免閃爍）
    injectInitialHideStyle();

    let settings = await loadSettings();
    let autocompleteWatcher: AutocompleteWatcher | null = null;
    let indicator: Indicator | null = null;
    let resultScanner: ResultScanner | null = null;
    /** resultScanner 是用哪一種遮蔽方式建的；使用者換模式時要重建才吃得到 */
    let scannerMode = settings.hideMode;
    let clickRevealer: ClickRevealer | null = null;
    /**
     * 頁面層級封鎖 CSS 目前是不是掛著的。
     *
     * 點擊揭露必須看這個旗標，不能只看 selector 有沒有命中：selector 在
     * 「這一頁根本沒被擋」的時候照樣會命中 `#search img`，那會讓 mask 模式下
     * 每一次點縮圖都被吞掉一次 —— 使用者看到的是「這個擴充功能讓 Google 點不動」。
     */
    let pageBlocked = false;
    /** 被點開過的頁面層級元素，換設定時要把標記收回去 */
    const pageRevealed = new Set<HTMLElement>();
    /**
     * 使用者在本頁按了「顯示」。刻意只活在這次頁面載入的記憶體裡 ——
     * 不改設定、不寫任何儲存，所以沒有隱私成本，重新整理就恢復隱藏。
     */
    let revealed = false;

    function stopAutocompleteWatcher() {
      // disconnect() 自己會還原動過的 inline visibility，
      // 不需要（也不該）再對整份文件掃一遍
      autocompleteWatcher?.disconnect();
      autocompleteWatcher = null;
    }

    function removeIndicator() {
      indicator?.destroy();
      indicator = null;
    }

    function stopResultScanner() {
      // disconnect() 自己會還原隱藏掉的圖片
      resultScanner?.disconnect();
      resultScanner = null;
    }

    function stopClickRevealer() {
      clickRevealer?.disconnect();
      clickRevealer = null;
      for (const el of pageRevealed) el.removeAttribute(REVEAL_ATTR);
      pageRevealed.clear();
    }

    /**
     * 點在遮罩上時，先問頁面層級的 selector，再問逐筆掃描留下的標記。
     * 順序無所謂（兩者不會同時生效：query 命中就不跑掃描），但頁面層級便宜一些。
     */
    function findMaskedElement(target: Element): HTMLElement | null {
      const fromPage = pageBlocked
        ? findRevealTarget(target, settings.blockTypes)
        : null;
      if (fromPage) return fromPage;
      const fromScan = target.closest(`[${SCAN_ATTR}]`);
      return fromScan instanceof HTMLElement ? fromScan : null;
    }

    function revealElement(el: HTMLElement) {
      // 逐筆掃描是用 inline style 遮的，得由 scanner 自己清；
      // 頁面 CSS 遮的則是靠這個標記讓抵銷規則生效
      if (resultScanner?.reveal(el)) return;
      el.setAttribute(REVEAL_ATTR, "1");
      pageRevealed.add(el);
    }

    function toggleReveal() {
      // 什麼都沒被遮的時候（例如在無關的搜尋頁按了快捷鍵）不該切換 ——
      // 否則提示會冒出「已顯示本頁圖片」，報告一件沒有發生的事。
      // 頁面提示上那顆按鈕不受影響：提示只在真的有擋到東西時才存在。
      if (!revealed && !shouldBlock(query, settings) && !resultScanner?.hiddenCount) {
        return;
      }
      revealed = !revealed;
      applyState(settings);
    }

    /**
     * 建立／更新／移除頁面提示。
     * document_start 之後幾毫秒 body 還不存在，這時直接跳過 —— onDomReady 會再叫一次。
     */
    function refreshIndicator(s: BlocklistSettings) {
      const queryBlocked = shouldBlock(query, s);
      const scannerHits = resultScanner?.hiddenCount ?? 0;
      // revealed 一定是從提示上按出來的，所以它成立就代表原本有擋到東西 ——
      // 少了這個條件，「只有逐筆命中」的頁面按下顯示後提示會消失，
      // 使用者就找不到「復原」了
      const active = queryBlocked || scannerHits > 0 || revealed;

      if (s.paused || !s.pageIndicator || !active || !document.body) {
        removeIndicator();
        return;
      }
      indicator ??= createIndicator(toggleReveal);
      const match = queryBlocked
        ? findBlockMatch(query, s)
        : (resultScanner?.firstMatch ?? null);
      indicator.update({
        hiddenCount: queryBlocked
          ? countBlockedElements(document, s.blockTypes)
          : scannerHits,
        keyword: match?.keyword ?? "",
        categoryLabel: match?.categoryLabel ?? null,
        revealed,
        locale: s.locale,
      });
    }

    function applyState(s: BlocklistSettings) {
      document.getElementById(INITIAL_STYLE_ID)?.remove();

      // paused 時完整早退：不留任何 CSS、observer 或提示
      if (s.paused) {
        pageBlocked = false;
        document.getElementById(BLOCK_STYLE_ID)?.remove();
        stopAutocompleteWatcher();
        stopResultScanner();
        stopClickRevealer();
        removeIndicator();
        return;
      }

      const queryBlocked = shouldBlock(query, s);
      pageBlocked = queryBlocked && !revealed;
      syncPageBlock(pageBlocked, s);

      // 換遮蔽方式時要重建：已經被遮住的圖在 scanner 的 `seen` 裡，
      // 單純 rescan() 不會回頭把它們換成新模式的樣子
      if (resultScanner && scannerMode !== s.hideMode) stopResultScanner();

      // 逐筆掃描只在「query 沒命中」時跑：命中的話整頁已經遮了，
      // 再掃一次既浪費 CPU 又會把同一批圖重複計數
      if (s.perResultBlock && !queryBlocked && !revealed && document.body) {
        if (!resultScanner) {
          scannerMode = s.hideMode;
          resultScanner = scanResults(
            () => settings,
            () => refreshIndicator(settings),
          );
        }
        resultScanner.rescan();
      } else {
        stopResultScanner();
      }

      // 「點一下顯示這一個」只有 blur / mask 有意義 —— display:none 的元素點不到
      if (isRevealable(s.hideMode) && !revealed) {
        clickRevealer ??= revealOnClick({
          find: findMaskedElement,
          reveal: revealElement,
        });
      } else {
        stopClickRevealer();
      }

      // 「本頁顯示」也要放開搜尋建議的縮圖 —— 那也是這一頁的一部分
      if (s.blockTypes.searchPreview && !revealed) {
        if (!autocompleteWatcher) {
          autocompleteWatcher = observeAutocomplete(() => settings);
        }
      } else {
        stopAutocompleteWatcher();
      }

      refreshIndicator(s);
    }

    applyState(settings);

    onDomReady(() => {
      // 重跑一次：逐筆掃描與頁面提示都需要 body 存在，
      // 第一次 applyState 時（document_start 之後幾毫秒）還沒有
      applyState(settings);
      // Google 的縮圖是延遲載入的，隔一段時間再數一次才數得準。
      // 只補兩次而不是掛 MutationObserver —— 這只是個資訊性標籤，
      // 不值得為了它在每一次 DOM 變動上付出成本。
      setTimeout(() => refreshIndicator(settings), 1000);
      setTimeout(() => refreshIndicator(settings), 3000);

      if (import.meta.env.DEV) {
        setTimeout(() => devSelectorAudit(query, settings), 2000);
      }
    });

    // A6：軟導航後 q 會換掉，但 content script 不會重新執行
    watchSearchQuery((next) => {
      query = next;
      // 換了一頁就該回到「有擋」的狀態：上一頁按過的顯示不該跟著過來
      revealed = false;
      stopResultScanner();
      stopClickRevealer();
      applyState(settings);
      // 新結果是非同步串流進來的，跟首次載入一樣要補數
      setTimeout(() => refreshIndicator(settings), 1000);
    });

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !(STORAGE_KEY in changes)) return;
      loadSettings().then((newSettings) => {
        settings = newSettings;
        applyState(newSettings);
      });
    });

    /**
     * 來自 background（鍵盤快捷鍵）與 popup（診斷）的訊息。
     *
     * 診斷刻意走訊息而不是 `chrome.scripting.executeScript`：後者需要
     * `scripting` 權限，而對已上架的擴充功能新增權限會讓 Chrome 停用它、
     * 等使用者重新同意 —— 一批現有使用者會直接流失在那個對話框上。
     */
    browser.runtime.onMessage.addListener((message: unknown) => {
      const type = (message as { type?: unknown } | null)?.type;
      if (type === TOGGLE_REVEAL_MESSAGE) {
        toggleReveal();
        return Promise.resolve({ revealed });
      }
      if (type === DIAGNOSE_MESSAGE) {
        const report: DiagnosisReport = {
          query,
          paused: settings.paused,
          queryBlocked: !settings.paused && shouldBlock(query, settings),
          cssMatches: countBlockedElements(document, settings.blockTypes),
          scannerMatches: resultScanner?.hiddenCount ?? 0,
          revealed,
        };
        return Promise.resolve(report);
      }
      return undefined;
    });
  },
});

/**
 * 在 document_start 先把所有可能夾帶圖片的區塊遮起來，
 * 等 `loadSettings()` 回來再換成正式的封鎖 CSS 或整個移除。
 *
 * 這一段是產品承諾的關鍵：從 document_start 到 storage 回應之間（通常 1–10 ms，
 * 冷啟動更久）Google 的 HTML 是串流漸進渲染的，很可能已經 paint 過一次。
 * 對一個為了恐懼症存在的擴充功能，那 100 ms 的閃現就是失效。
 *
 * 因此遮的是「所有圖片類 selector 的超集」而不是手寫的一小撮 ——
 * 之前漏掉了預設就開啟的 `thumbnails`（`#search img` / `#rcnt img`）與
 * 大部分影片卡容器，等於最常見的設定完全沒有被保護到。
 */
function injectInitialHideStyle(): void {
  const style = document.createElement("style");
  style.id = INITIAL_STYLE_ID;
  style.textContent = buildInitialHideCSS();
  (document.head || document.documentElement).appendChild(style);
}

/** DOM 可用後執行（document_start 進來時 body 還不存在） */
function onDomReady(fn: () => void): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

/**
 * Dev only: 阻擋啟用 2 秒後檢查 selector 是否真的找到元素。
 * 全部 0 命中通常代表 Google 改了 DOM，需要更新 selectors.ts。
 *
 * 正式版由頁面提示對使用者顯示同一個訊號（「沒有找到可隱藏的區塊」）。
 */
function devSelectorAudit(query: string, settings: BlocklistSettings): void {
  if (settings.paused || !shouldBlock(query, settings)) return;
  const total = countBlockedElements(document, settings.blockTypes);
  if (total === 0) {
    console.warn(
      "[SIB dev] Block selectors matched 0 elements on this page. " +
        "Google may have rotated its DOM — check entrypoints/content/selectors.ts.",
    );
  } else {
    console.debug(`[SIB dev] Block selectors matched ${total} elements.`);
  }
}

/**
 * 新增、更新或移除 #sib-block-style，即時反映最新 settings。
 */
function syncPageBlock(blocked: boolean, settings: BlocklistSettings): void {
  let el = document.getElementById(BLOCK_STYLE_ID) as HTMLStyleElement | null;
  if (!blocked) {
    el?.remove();
    return;
  }
  const css = buildBlockCSS(settings);
  if (el) {
    el.textContent = css;
  } else {
    el = document.createElement("style");
    el.id = BLOCK_STYLE_ID;
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }
}

/** observeAutocomplete 的控制握把 */
interface AutocompleteWatcher {
  /** 停止觀察，並把自己動過的 inline visibility 全部還原 */
  disconnect(): void;
}

/**
 * 觀察 autocomplete 下拉，分兩層判斷：
 *
 * 1. 每個 [role="option"] 用自己的 textContent 判斷（左側 suggestion 縮圖）
 * 2. listbox 周邊但「不在 option 裡」的圖片（右側知識預覽面板等），
 *    用搜尋框當前輸入的字串判斷
 *
 * 接受 getter 而非直接傳入 settings，使 storage 變更後不需重建 observer
 * 就能即時讀到最新設定。
 *
 * 效能與正確性設計：
 * - rAF debounce：同一 frame 內的多次 mutation 只 processAll 一次
 * - listbox 不存在時立即返回，避免多個 querySelectorAll 白跑
 * - 觀察根縮小到搜尋框的 <form>。但這個 observer 是在 document_start 之後
 *   幾毫秒建立的（只等了 storage IPC），那時 DOM 常常連 <body> 都還沒有，
 *   `closest("form")` 會拿到 null —— 所以先掛 documentElement，等
 *   DOMContentLoaded 再重新收窄。原本的寫法沒有這一步，收窄實際上經常沒生效。
 * - 只還原「自己動過」的元素：舊版是對整份文件的所有 img/svg/picture 掃一遍
 *   removeProperty，會把 Google 自己設的 visibility 一起清掉。
 */
function observeAutocomplete(
  getSettings: () => BlocklistSettings,
): AutocompleteWatcher {
  const IMG_SELECTOR = [
    "img",
    "g-img",
    "svg",
    "picture",
    '[style*="background-image"]',
    '[style*="url("]',
  ].join(", ");

  /** 被我們設過 visibility:hidden 的元素，用來精準還原 */
  const hidden = new Set<HTMLElement>();
  let disposed = false;
  let rafId: number | null = null;

  function findSearchInput(): HTMLElement | null {
    return document.querySelector('textarea[name="q"], input[name="q"]');
  }

  function getInputValue(): string {
    const el = findSearchInput() as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    return (el?.value ?? "").trim();
  }

  /** 只在狀態真的改變時才寫 DOM，並記錄自己動過誰 */
  function setHidden(el: HTMLElement, hide: boolean): void {
    if (hide) {
      if (!hidden.has(el)) {
        el.style.visibility = "hidden";
        hidden.add(el);
      }
    } else if (hidden.delete(el)) {
      el.style.removeProperty("visibility");
    }
  }

  function restoreAll(): void {
    for (const el of hidden) el.style.removeProperty("visibility");
    hidden.clear();
  }

  function processAll() {
    // autocomplete 關閉時直接跳出，避免不必要的全文件查詢
    if (!document.querySelector('[role="listbox"]')) return;

    const settings = getSettings();
    const inputValue = getInputValue();
    const inputBlocked = inputValue ? shouldBlock(inputValue, settings) : false;

    const options = Array.from(document.querySelectorAll('[role="option"]'));
    const optionTexts = options.map((o) => (o.textContent ?? "").trim());
    const anyOptionBlocked = optionTexts.some(
      (t) => t && shouldBlock(t, settings),
    );

    // 右側預覽：input 命中 OR 任何 option 命中都擋
    const previewBlocked = inputBlocked || anyOptionBlocked;
    const handled = new WeakSet<Element>();

    options.forEach((option, i) => {
      const text = optionTexts[i];
      const block = text ? shouldBlock(text, settings) : false;
      option.querySelectorAll(IMG_SELECTOR).forEach((el) => {
        handled.add(el);
        setHidden(el as HTMLElement, block);
      });
    });

    document.querySelectorAll('[role="listbox"]').forEach((listbox) => {
      const container = listbox.parentElement ?? listbox;
      container.querySelectorAll(IMG_SELECTOR).forEach((el) => {
        if (handled.has(el)) return;
        if (el.closest('[role="option"]')) return;
        setHidden(el as HTMLElement, previewBlocked);
      });
    });
  }

  // rAF debounce：同一 frame 的多筆 mutation 只執行一次 processAll
  function scheduleProcessAll() {
    if (rafId !== null || disposed) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      processAll();
    });
  }

  const observer = new MutationObserver(scheduleProcessAll);

  /** 掛上觀察；回傳是否成功收窄到搜尋框的 <form> */
  function attach(): boolean {
    const form = findSearchInput()?.closest("form") ?? null;
    observer.observe(form ?? document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "style", "data-src"],
    });
    return form !== null;
  }

  if (!attach()) {
    // document_start 之後幾毫秒，<form> 通常還不存在 —— 先觀察整份文件，
    // DOM ready 後再收窄，否則整個 SERP 的 mutation 都會打進來。
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (disposed) return;
        observer.disconnect();
        attach();
        processAll();
      },
      { once: true },
    );
  }

  processAll();

  return {
    disconnect() {
      disposed = true;
      observer.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      restoreAll();
    },
  };
}
