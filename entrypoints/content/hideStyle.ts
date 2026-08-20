/**
 * 「遮成什麼樣子」的單一來源。
 *
 * 三個地方需要同一組視覺處理，而它們套用的方式不同：
 *   1. 頁面層級封鎖 —— 產生 `<style>` 文字（selectors.ts）
 *   2. 逐筆結果比對 —— 逐張圖寫 inline style（resultScanner.ts）
 *   3. 揭露單一元素 —— 把上面兩者抵銷掉（clickReveal.ts / resultScanner.reveal）
 * 分成三份實作的話，改了 blur 半徑卻只改到一半是遲早的事。
 *
 * 只 `import type`，所以維持 selectors.ts 那條「零 runtime import、測試可以
 * 直接載入」的性質。
 */
import type { HideMode } from "@/composables/blockList";

/**
 * blur 模式的參數。這三個數字是拿真實 CSS 引擎渲染出來挑的，不是憑感覺：
 *
 * - `blur(24px)` 單獨用不夠。160×110 的縮圖在那個半徑下仍然是一團輪廓清楚的
 *   色塊 —— 去背 PNG 更慘，蜘蛛的形狀還認得出來。對一個為了恐懼症存在的產品，
 *   「認得出是什麼」就等於沒遮。加大到 32px 並把對比壓到 0.25 之後才真正是
 *   一片看不出內容的霧，同時還保留「這裡有東西」的暗示 —— 那正是 blur 相對於
 *   mask 的唯一價值。
 * - `clip-path: inset(0)` 是必要的，不是裝飾。`filter: blur()` 會把繪製範圍
 *   往外擴，模糊會溢出元素邊界糊到旁邊的結果標題上（實測綠色暈開了將近一個
 *   縮圖的寬度）。clip-path 在 filter 之後套用，剛好把溢出的部分裁掉。
 */
const BLUR_RADIUS_PX = 32;
const BLUR_CONTRAST = 0.25;
const BLUR_BRIGHTNESS = 1.2;

/**
 * mask 模式的核心：`contrast(0)` 會把每一個通道映射成固定的 0.5，
 * 也就是「不論來源是什麼，整塊都變成同一個灰」—— 形狀資訊完全消失。
 *
 * 但 `contrast(0)` 只動顏色、不動 alpha：透明背景的 PNG（圖片分頁很常見）
 * 會留下一個灰色剪影，而剪影正是恐懼症使用者最不能看的東西。
 * 所以先用 inset box-shadow 鋪滿一層不透明底色再套 filter，讓整個
 * border-box 的 alpha 都是 1。
 *
 * 用 inset box-shadow 而不是 `background-color`：後者要覆寫 Google 自己
 * 設在該元素上的背景，揭露時就沒辦法還原成原本的值。
 */
const MASK_FILL = "inset 0 0 0 9999px #000";
/** 0.5（contrast(0) 的輸出）× 1.6 ＝ 0.8 → #cccccc，淺色深色版面都不刺眼 */
const MASK_FILTER = "contrast(0) brightness(1.6)";

/** 逐筆掃描隱藏起來的圖片會帶這個標記，讓點擊委派找得到它（不需要知道 selector） */
export const SCAN_ATTR = "data-sib-scan";
/** 使用者點開的頁面層級元素會帶這個標記，封鎖 CSS 裡有對應的抵銷規則 */
export const REVEAL_ATTR = "data-sib-reveal";

/** 每一種模式要套的 CSS 屬性。CSS 文字與 inline style 都從這裡長出來 */
const DECLARATIONS: Record<HideMode, ReadonlyArray<readonly [string, string]>> = {
  hide: [["display", "none"]],
  blur: [
    [
      "filter",
      `blur(${BLUR_RADIUS_PX}px) contrast(${BLUR_CONTRAST}) brightness(${BLUR_BRIGHTNESS})`,
    ],
    // filter 會把繪製範圍往外擴；沒有這一行，模糊會糊到旁邊的結果標題上
    ["clip-path", "inset(0)"],
    // Google 自己的 hover / 載入動畫會在被遮的元素上跑 transition，
    // 那會讓遮蔽以淡入的方式生效 —— 也就是有幾百毫秒是看得見的
    ["transition", "none"],
    ["cursor", "pointer"],
  ],
  mask: [
    ["box-shadow", MASK_FILL],
    ["filter", MASK_FILTER],
    ["transition", "none"],
    ["cursor", "pointer"],
  ],
};

/** 揭露時要抵銷的屬性；`display` 不在其中 —— hide 模式不可能被點到 */
const REVEAL_DECLARATIONS: ReadonlyArray<readonly [string, string]> = [
  ["filter", "none"],
  ["box-shadow", "none"],
  ["clip-path", "none"],
  ["cursor", "auto"],
];

function toDeclarationText(
  props: ReadonlyArray<readonly [string, string]>,
): string {
  return props.map(([k, v]) => `${k}: ${v} !important;`).join(" ");
}

/** 一種模式對應的 CSS 宣告字串，例如 `display: none !important;` */
export function hideDeclaration(mode: HideMode): string {
  return toDeclarationText(DECLARATIONS[mode]);
}

/** 揭露用的 CSS 宣告字串 */
export function revealDeclaration(): string {
  return toDeclarationText(REVEAL_DECLARATIONS);
}

/**
 * 這個模式有沒有「點一下顯示這一個」的互動。
 *
 * `hide` 沒有：`display: none` 的元素不在版面上，點不到也沒有東西可以點。
 * 想在 hide 模式下看某一頁，用頁面提示上那顆放開整頁的按鈕。
 */
export function isRevealable(mode: HideMode): boolean {
  return mode !== "hide";
}

/**
 * 逐筆掃描用的 inline 套用。
 *
 * 用 inline `!important` 而不是加一張 stylesheet：那是作者樣式裡最強的一層，
 * Google 之後對同一個元素做什麼都蓋不掉。
 */
export function applyInlineHide(el: HTMLElement, mode: HideMode): void {
  for (const [prop, value] of DECLARATIONS[mode]) {
    el.style.setProperty(prop, value, "important");
  }
  el.setAttribute(SCAN_ATTR, "1");
}

/** 還原 applyInlineHide 動過的一切（所有模式的屬性都清，模式中途換過也乾淨） */
export function clearInlineHide(el: HTMLElement): void {
  for (const props of Object.values(DECLARATIONS)) {
    for (const [prop] of props) el.style.removeProperty(prop);
  }
  el.removeAttribute(SCAN_ATTR);
}
