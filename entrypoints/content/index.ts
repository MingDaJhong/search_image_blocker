import { defineContentScript } from "wxt/sandbox";
import { browser } from "wxt/browser";
import {
  loadSettings,
  shouldBlock,
  STORAGE_KEY,
  type BlocklistSettings,
} from "@/composables/useBlockList";

const BLOCK_STYLE_ID = "sib-block-style";
const INITIAL_STYLE_ID = "sib-initial-hide";

export default defineContentScript({
  matches: [
    "https://www.google.com/search*",
    "https://www.google.com.tw/search*",
  ],
  runAt: "document_start",
  async main() {
    const url = new URL(location.href);
    const query = url.searchParams.get("q") ?? "";

    // 先注入隱藏 CSS（避免閃爍）
    injectInitialHideStyle();

    let settings = await loadSettings();
    const blocked = shouldBlock(query, settings);

    document.getElementById(INITIAL_STYLE_ID)?.remove();
    if (blocked) {
      console.log("[SIB] Blocking visual blocks for query:", query);
      syncPageBlock(true, settings);
    }

    // autocomplete 縮圖獨立判斷，跟 URL query 解耦
    let autocompleteObserver: MutationObserver | null = settings.blockTypes
      .searchPreview
      ? observeAutocomplete(() => settings)
      : null;

    // 即時套用設定變更
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !(STORAGE_KEY in changes)) return;
      loadSettings().then((newSettings) => {
        settings = newSettings;
        syncPageBlock(shouldBlock(query, newSettings), newSettings);

        autocompleteObserver?.disconnect();
        if (newSettings.blockTypes.searchPreview) {
          autocompleteObserver = observeAutocomplete(() => settings);
        } else {
          autocompleteObserver = null;
          clearAutocompleteStyles();
        }
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
 * 根據目前 settings 建出封鎖用 CSS 字串（純函式）
 */
function buildBlockCSS(settings: BlocklistSettings): string {
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
    selectors.push(
      "#search img",
      "#rcnt img",
    );
  }

  if (settings.blockTypes.videos) {
    selectors.push(
      "video-voyager",
      'div[data-attrid*="VideoObject"]',
      'div[jsname][data-hveid] a[href*="youtube.com"]',
      "div[data-vido]",
      'div[jsname="UWckNb"][href*="youtube.com"]',
      'a[href*="youtube.com/watch"]',
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

  // searchPreview 不在這裡 — 由 observeAutocomplete() 逐 option 判斷
  return selectors.length
    ? `${selectors.join(",\n")} { display: none !important; }`
    : "";
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

  const observer = new MutationObserver(processAll);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "style", "data-src"],
  });
  processAll();
  return observer;
}
