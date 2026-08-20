/**
 * Google SERP 的封鎖 selector —— 全部集中在這個檔案。
 *
 * 獨立出來的兩個理由：
 *   1. Google 會定期改 DOM，維護時只需要看這一個檔案
 *   2. 純函式、零 runtime import（`BlocklistSettings` 只用 `import type`），
 *      所以測試可以直接載入，不會觸發 content script 的副作用
 *
 * 每一組 selector 的註解裡都有它針對的 DOM 結構；失效時對照著改。
 */
import type { BlocklistSettings } from "@/composables/blockList";
import {
  REVEAL_ATTR,
  hideDeclaration,
  isRevealable,
  revealDeclaration,
} from "./hideStyle";

/**
 * 不算「內容圖片」的東西：favicon 容器（cite、.VuuXrf、.byrV5b、.TbwUpd、
 * .XNo5Ab、.eqA2re）與影片卡片內部圖片（交給 videos 那組處理）。
 * 排除清單是 Google class 名稱常見模式的猜測，可能需隨 DOM rotation 維護。
 */
const EXCLUDE_FAVICONS_AND_VIDEOS =
  ':is(cite img, .VuuXrf img, .byrV5b img, .TbwUpd img, .XNo5Ab, .eqA2re, video-voyager *, [data-attrid*="Video"] *, [data-vido] *, [jscontroller="rTuANe"] *)';

/** 逐筆結果比對要檢查的圖片 */
export const RESULT_IMAGE_SELECTOR = `img:not(${EXCLUDE_FAVICONS_AND_VIDEOS}), g-img, picture`;

/**
 * 逐筆結果比對的掃描範圍。
 * `#center_col` 是圖片／影片等分頁常見的容器，多列一個以防 `#search` 不存在；
 * 三個都找不到時 resultScanner 會退回 body。
 */
export const RESULT_ROOT_SELECTOR = "#search, #rcnt, #center_col";

/**
 * 開場遮蔽用的區塊類型：所有「會夾帶圖片」的都開。
 *
 * 刻意不含 relatedQuestions 與 knowledgePanel —— 那兩個主要是文字區塊，
 * 把它們也蒙起來只會讓每次搜尋都閃一下，卻擋不到任何使用者想避開的東西。
 * 知識面板裡的圖片由 thumbnails 的 `#rcnt img` 一併涵蓋。
 * searchPreview 不產生頁面 CSS（走 MutationObserver），放什麼都無所謂。
 */
export const INITIAL_HIDE_BLOCK_TYPES: BlocklistSettings["blockTypes"] = {
  images: true,
  thumbnails: true,
  videos: true,
  imageFilterBar: true,
  relatedQuestions: false,
  knowledgePanel: false,
  searchPreview: false,
};

/**
 * 影片卡容器辨識：
 *   [jscontroller="rTuANe"]  — 知識面板影片 + 主搜尋結果區影片區「都」用這個 controller
 *   [data-attrid*="Video"]   — 知識面板的 VisualDigestVideoResult / 舊版 VideoObject
 *   video-voyager / [data-vido] — 舊版 layout 的 fallback
 */
const VIDEO_CARD_CONTAINERS = [
  '[jscontroller="rTuANe"]',
  'div[data-attrid*="Video"]',
  "video-voyager",
  "div[data-vido]",
  'div[jsname="tX7jT"]',
];

/**
 * 不管使用者選了哪種遮蔽方式，這些一律 `display: none`。
 *
 * 目前只有 `<video>`：`display: none` 之後瀏覽器根本不會去載入它，hover 預覽
 * 自然失效。改成模糊或遮罩就等於讓影片留在版面上 —— 它會載入、hover 會播、
 * **而且會出聲**。對一個為了避開特定畫面存在的產品，那是比看到縮圖更糟的結果。
 *
 * 這一組不提供「點一下顯示」：使用者要看影片就把遮蔽關掉或用整頁顯示。
 */
export function collectAlwaysHideSelectors(
  blockTypes: BlocklistSettings["blockTypes"],
): string[] {
  if (!blockTypes.videos) return [];
  return [
    ...VIDEO_CARD_CONTAINERS.map((card) => `${card} video`),
    'a[href*="youtube.com/watch"] video',
  ];
}

/**
 * 收集啟用的所有頁面層級 selector（不含 autocomplete）。
 *
 * 只吃 blockTypes 而不是整個 settings，這樣開場遮蔽才能傳入一組
 * 「全部打開」的假設定，不必偽造一整個 BlocklistSettings。
 */
export function collectBlockSelectors(
  blockTypes: BlocklistSettings["blockTypes"],
): string[] {
  const selectors: string[] = [];

  if (blockTypes.images) {
    selectors.push(
      "g-scrolling-carousel",
      'div[data-attrid*="image"]',
      "g-img",
      "div[data-tts-text]",
    );
  }

  if (blockTypes.thumbnails) {
    selectors.push(
      `#search img:not(${EXCLUDE_FAVICONS_AND_VIDEOS})`,
      `#rcnt img:not(${EXCLUDE_FAVICONS_AND_VIDEOS})`,
    );
  }

  if (blockTypes.videos) {
    // 只擋影片卡內部的「預覽圖 + 背景影像」，不擋整張卡，保留文字標題/來源/日期。
    // `<video>` 本身走 collectAlwaysHideSelectors()，理由見那裡。
    for (const card of VIDEO_CARD_CONTAINERS) {
      selectors.push(
        `${card} img`,
        `${card} picture`,
        `${card} [style*="background-image"]`,
      );
    }
    selectors.push('a[href*="youtube.com/watch"] img');
  }

  if (blockTypes.imageFilterBar) {
    // 圖片分頁頂端的相關搜尋 chips（「卡通 / 可愛 / 手繪 …」）——只拿掉縮圖，保留文案。
    // DOM: a[role="link"] > div            ← chip 外框，文案也在這層裡面，整塊隱藏會連字一起消失
    //                        ├─ span > div > div > img   ← 縮圖 → 目標
    //                        └─ span 文案                ← 保留
    // `:has(> img):not(:has(> :not(img)))` = 直接子元素只有 <img> 的純圖片容器，
    // 任何夾帶文字節點以外元素的層級都不會被匹配，Google 改結構也不會誤殺整個 chip。
    // :has() 用 :is() 包起來，舊瀏覽器不支援時只讓這一支失效，不會整條 rule 作廢。
    // [href*="/search"] 把範圍收在「點了會再搜尋」的 chip，避開指向外站的 carousel 卡片。
    const chipLink = '[role="list"] [role="listitem"] a[role="link"][href*="/search"]';
    selectors.push(
      `${chipLink} :is(:has(> img):not(:has(> :not(img))))`,
      `${chipLink} img`,
      `${chipLink} g-img`,
      `${chipLink} picture`,
      `${chipLink} [style*="background-image"]`,
    );
  }

  if (blockTypes.relatedQuestions) {
    selectors.push('div[jsname="N760b"]', "div[data-initq]");
  }

  if (blockTypes.knowledgePanel) {
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
 * 把一組 selector 攤成「一個 selector 一條 rule」的 CSS。
 *
 * 刻意不用逗號把它們併成一條 rule：CSS 規範規定，selector 清單裡只要有**一個**
 * 無效，整條 rule 就會被瀏覽器整個丟掉。以這裡的用法就是「打錯一個字 → 阻擋全滅」。
 * 拆開之後，壞掉的 selector 只讓自己那一條失效，其餘照常運作。
 *
 * 代價是多出幾百 bytes 的 CSS 文字，對一個注入用的 <style> 完全不痛。
 */
function toRules(selectors: string[], declaration: string): string {
  return selectors.map((sel) => `${sel} { ${declaration} }`).join("\n");
}

/** 頁面層級會被處理到的所有 selector（含一律 display:none 的那組） */
export function collectAllSelectors(
  blockTypes: BlocklistSettings["blockTypes"],
): string[] {
  return [
    ...collectBlockSelectors(blockTypes),
    ...collectAlwaysHideSelectors(blockTypes),
  ];
}

/**
 * 根據目前 settings 建出封鎖用 CSS 字串（純函式）。
 *
 * 三段，順序有意義：
 *   1. 使用者選的遮蔽方式（hide / blur / mask）
 *   2. blur / mask 的「這一個已被點開」抵銷規則。specificity 比第 1 段高
 *      （多一個屬性選擇器），所以能蓋掉同樣帶 !important 的遮蔽宣告
 *   3. 一律 display:none 的那組放最後，確保它不會被前面任何一條蓋掉
 */
export function buildBlockCSS(settings: BlocklistSettings): string {
  const { blockTypes, hideMode } = settings;
  const maskable = collectBlockSelectors(blockTypes);
  const parts = [toRules(maskable, hideDeclaration(hideMode))];

  if (isRevealable(hideMode)) {
    parts.push(
      toRules(
        maskable.map((sel) => `${sel}[${REVEAL_ATTR}]`),
        revealDeclaration(),
      ),
    );
  }

  parts.push(
    toRules(collectAlwaysHideSelectors(blockTypes), hideDeclaration("hide")),
  );
  return parts.filter(Boolean).join("\n");
}

/**
 * 開場遮蔽用的 CSS。
 *
 * 用 visibility 而非 display：保留版面，settings 回來移除時不會 reflow。
 * 也刻意不看 `hideMode` —— 這一段跑在 storage 回應之前，那時還不知道使用者
 * 選了哪一種，而 `visibility: hidden` 是三種模式的共同上界（遮得比任何一種都多）。
 */
export function buildInitialHideCSS(): string {
  return toRules(
    collectAllSelectors(INITIAL_HIDE_BLOCK_TYPES),
    "visibility: hidden !important;",
  );
}

/** 一個元素在文件裡的深度，用來在多個命中之間挑最深（也就是範圍最小）的那個 */
function depthOf(el: Element): number {
  let depth = 0;
  for (let node = el.parentElement; node; node = node.parentElement) depth++;
  return depth;
}

/**
 * 從點擊目標往上找「正被頁面 CSS 遮住、而且可以被點開」的元素。
 *
 * 挑最深的命中而不是第一個：selector 之間高度重疊（`#search img` 與
 * `#rcnt img` 幾乎是同一批），而點開的範圍應該愈小愈好 —— 使用者點的是
 * 一張圖，不該連整個輪播一起放開。
 *
 * 每個 selector 各自 try/catch，理由和「一個 selector 一條 rule」一樣：
 * 一個壞掉的 selector 只讓自己失效，不會讓整個點擊揭露不能用。
 */
export function findRevealTarget(
  target: Element,
  blockTypes: BlocklistSettings["blockTypes"],
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDepth = -1;
  for (const sel of collectBlockSelectors(blockTypes)) {
    let found: Element | null;
    try {
      found = target.closest(sel);
    } catch {
      continue;
    }
    if (!(found instanceof HTMLElement)) continue;
    if (found.hasAttribute(REVEAL_ATTR)) continue; // 已經點開過，讓這一下傳下去
    const depth = depthOf(found);
    if (depth > bestDepth) {
      bestDepth = depth;
      best = found;
    }
  }
  return best;
}

/**
 * 數出目前頁面上有多少個元素會被這組設定隱藏。
 *
 * 用 Set 去重而不是把各 selector 的 length 相加 —— selector 之間會重疊
 * （`#search img` 與 `#rcnt img` 幾乎命中同一批），相加會嚴重高估。
 *
 * 回傳 0 而封鎖又是啟用狀態，通常代表 Google 改了 DOM：這是目前唯一
 * 不需要任何遙測就能發現 selector 失效的訊號，頁面提示會把它顯示出來。
 */
export function countBlockedElements(
  root: ParentNode,
  blockTypes: BlocklistSettings["blockTypes"],
): number {
  const seen = new Set<Element>();
  for (const sel of collectAllSelectors(blockTypes)) {
    let matched: NodeListOf<Element>;
    try {
      matched = root.querySelectorAll(sel);
    } catch {
      // selector 語法錯誤：測試會擋下來，這裡只是不要讓計數拖垮整頁
      continue;
    }
    for (const el of matched) seen.add(el);
  }
  return seen.size;
}
