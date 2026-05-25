import { defineContentScript } from "wxt/sandbox";
import { browser } from "wxt/browser";
import {
  loadSettings,
  shouldBlock,
  STORAGE_KEY,
  type BlocklistSettings,
} from "@/composables/blockList";

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
    const url = new URL(location.href);
    const query = url.searchParams.get("q") ?? "";

    // 先注入隱藏 CSS（避免閃爍）
    injectInitialHideStyle();

    let settings = await loadSettings();
    let autocompleteObserver: MutationObserver | null = null;

    function applyState(s: BlocklistSettings) {
      document.getElementById(INITIAL_STYLE_ID)?.remove();

      // paused 時完整早退：不留任何 CSS 或 observer
      if (s.paused) {
        document.getElementById(BLOCK_STYLE_ID)?.remove();
        autocompleteObserver?.disconnect();
        autocompleteObserver = null;
        clearAutocompleteStyles();
        return;
      }

      syncPageBlock(shouldBlock(query, s), s);

      if (s.blockTypes.searchPreview) {
        if (!autocompleteObserver) {
          autocompleteObserver = observeAutocomplete(() => settings);
        }
      } else {
        autocompleteObserver?.disconnect();
        autocompleteObserver = null;
        clearAutocompleteStyles();
      }
    }

    applyState(settings);

    if (import.meta.env.DEV) {
      setTimeout(() => devSelectorAudit(query, settings), 2000);
    }

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !(STORAGE_KEY in changes)) return;
      loadSettings().then((newSettings) => {
        settings = newSettings;
        applyState(newSettings);
      });
    });
  },
});

/**
 * 在 document_start 階段先注入「全部隱藏」的暫時 CSS，
 * 等讀完設定後再決定要保留還是移除，避免使用者看到圖片閃過。
 */
function injectInitialHideStyle(): void {
  const style = document.createElement("style");
  style.id = INITIAL_STYLE_ID;
  style.textContent = `
    /* 暫時通殺所有圖片橫幅、影片卡 — 等 settings 載入後再決定 */
    g-scrolling-carousel,
    div[data-attrid*="kc:/"][data-attrid*="image"],
    div[jsname][data-hveid] g-scrolling-carousel {
      visibility: hidden !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

/**
 * 收集目前 settings 啟用的所有頁面層級 selector（不含 autocomplete）
 */
function collectBlockSelectors(settings: BlocklistSettings): string[] {
  const selectors: string[] = [];

  if (settings.blockTypes.images) {
    selectors.push(
      "g-scrolling-carousel",
      'div[data-attrid*="image"]',
      "g-img",
      "div[data-tts-text]",
    );
  }

  if (settings.blockTypes.thumbnails) {
    // 排除：favicon 容器（cite、span.VuuXrf、.byrV5b、.TbwUpd、.XNo5Ab、.eqA2re）
    // 與影片卡片內部圖片（交給 videos 處理），避免擋到站點 logo 或重複擋影片卡。
    // 排除清單是 Google class 名稱常見模式的猜測，可能需隨 DOM rotation 維護。
    const excludeFaviconsAndVideos =
      ':is(cite img, .VuuXrf img, .byrV5b img, .TbwUpd img, .XNo5Ab, .eqA2re, video-voyager *, [data-attrid*="Video"] *, [data-vido] *, [jscontroller="rTuANe"] *)';
    selectors.push(
      `#search img:not(${excludeFaviconsAndVideos})`,
      `#rcnt img:not(${excludeFaviconsAndVideos})`,
    );
  }

  if (settings.blockTypes.videos) {
    // 只擋影片卡內部的「預覽圖 + <video> + 背景影像」，不擋整張卡，保留文字標題/來源/日期。
    // <video> 用 display:none 後瀏覽器不會載入，hover 預覽自動失效。
    //
    // 影片卡容器辨識：
    //   [jscontroller="rTuANe"]  — 知識面板影片 + 主搜尋結果區影片區「都」用這個 controller
    //   [data-attrid*="Video"]   — 知識面板的 VisualDigestVideoResult / 舊版 VideoObject
    //   video-voyager / [data-vido] — 舊版 layout 的 fallback
    const videoCardContainers = [
      '[jscontroller="rTuANe"]',
      'div[data-attrid*="Video"]',
      "video-voyager",
      "div[data-vido]",
    ];
    for (const card of videoCardContainers) {
      selectors.push(
        `${card} img`,
        `${card} video`,
        `${card} picture`,
        `${card} [style*="background-image"]`,
      );
    }
    selectors.push(
      'a[href*="youtube.com/watch"] img',
      'a[href*="youtube.com/watch"] video',
    );
  }

  if (settings.blockTypes.relatedQuestions) {
    selectors.push('div[jsname="N760b"]', "div[data-initq]");
  }

  if (settings.blockTypes.knowledgePanel) {
    selectors.push(
      'div[data-attrid="kc:/"]',
      "#rhs",
      'div[data-attrid="kc:/local:hero image"]',
      'div[data-attrid$="hero image"]',
      'div[jsname="HiaYvf"]',
    );
  }

  return selectors;
}

/**
 * 根據目前 settings 建出封鎖用 CSS 字串（純函式）
 */
function buildBlockCSS(settings: BlocklistSettings): string {
  const selectors = collectBlockSelectors(settings);
  return selectors.length
    ? `${selectors.join(",\n")} { display: none !important; }`
    : "";
}

/**
 * Dev only: 阻擋啟用 2 秒後檢查所有 selector 是否真的找到元素。
 * 全部 0 命中通常代表 Google 改了 DOM，需要更新 collectBlockSelectors。
 */
function devSelectorAudit(query: string, settings: BlocklistSettings): void {
  if (settings.paused || !shouldBlock(query, settings)) return;
  const selectors = collectBlockSelectors(settings);
  if (selectors.length === 0) return;
  let total = 0;
  for (const sel of selectors) {
    try {
      total += document.querySelectorAll(sel).length;
    } catch {
      // 無效 selector 略過，不應發生
    }
  }
  if (total === 0) {
    console.warn(
      `[SIB dev] All ${selectors.length} block selectors matched 0 elements on this page. ` +
        `Google may have rotated its DOM — check selectors in entrypoints/content/index.ts.`,
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

/**
 * 移除 autocomplete 裡所有 inline visibility 樣式（停用 searchPreview 時清理殘留）
 */
function clearAutocompleteStyles(): void {
  const IMG_SELECTOR =
    'img, g-img, svg, picture, [style*="background-image"], [style*="url("]';
  document.querySelectorAll(IMG_SELECTOR).forEach((el) => {
    (el as HTMLElement).style.removeProperty("visibility");
  });
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
 * 效能設計：
 * - rAF debounce：同一 frame 內的多次 mutation 只 processAll 一次
 * - listbox 不存在時立即返回，避免多個 querySelectorAll 白跑
 * - 觀察根縮小到搜尋框的 <form>，排除頁面其餘 DOM 噪音
 */
function observeAutocomplete(
  getSettings: () => BlocklistSettings,
): MutationObserver {
  const IMG_SELECTOR = [
    "img",
    "g-img",
    "svg",
    "picture",
    '[style*="background-image"]',
    '[style*="url("]',
  ].join(", ");

  function getInputValue(): string {
    const el = document.querySelector('textarea[name="q"], input[name="q"]') as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    return (el?.value ?? "").trim();
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
        (el as HTMLElement).style.visibility = block ? "hidden" : "";
      });
    });

    document.querySelectorAll('[role="listbox"]').forEach((listbox) => {
      const container = listbox.parentElement ?? listbox;
      container.querySelectorAll(IMG_SELECTOR).forEach((el) => {
        if (handled.has(el)) return;
        if (el.closest('[role="option"]')) return;
        (el as HTMLElement).style.visibility = previewBlocked ? "hidden" : "";
      });
    });
  }

  // rAF debounce：同一 frame 的多筆 mutation 只執行一次 processAll
  let rafId: number | null = null;
  function scheduleProcessAll() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      processAll();
    });
  }

  // 把觀察根縮小到搜尋框的 <form>；找不到才退回 documentElement
  const searchInput = document.querySelector(
    'textarea[name="q"], input[name="q"]',
  );
  const observationRoot = searchInput?.closest("form") ?? document.documentElement;

  const observer = new MutationObserver(scheduleProcessAll);
  observer.observe(observationRoot, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "style", "data-src"],
  });
  processAll();
  return observer;
}
