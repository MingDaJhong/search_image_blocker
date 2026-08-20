/**
 * 頁面左下角的封鎖提示。
 *
 * 在這之前，阻擋是完全無聲的：圖片消失、沒有任何說明、想看某一頁只能開 popup
 * 按全域暫停（然後還要記得關回來）。一個小標籤同時解掉三件事：
 *
 *   1. **解釋** —— 「已隱藏 12 個區塊 · 關鍵字「蛇」」，使用者知道發生什麼事，
 *      也馬上知道該去調哪個關鍵字
 *   2. **逃生口** —— 「顯示」只影響當前頁面，不改設定、不寫任何儲存
 *      （所以也沒有隱私成本），重新整理就恢復
 *   3. **失效偵測** —— 阻擋啟用但數到 0，就是 Google 換了 DOM。在沒有任何
 *      遙測的前提下，這是唯一能讓使用者發現並回報的管道
 *
 * 用 closed shadow root：Google 的 CSS 進不來、我們的樣式也出不去，
 * 頁面上的 script 也讀不到裡面的內容。
 */
import type { Locale } from "@/composables/blockList";
import { contentMessages } from "./messages";
// 用 48px 來源顯示在 20px，retina 上才不會糊。3.9 KB，低於
// wxt.config.ts 設定的 assetsInlineLimit（8 KB）所以會被內嵌成 data URI。
// 刻意不用 browser.runtime.getURL()：那需要把圖示列進 web_accessible_resources，
// 等於讓 google.com 可以探測這個擴充功能是否安裝。多幾 KB 換掉一個指紋面，划算。
import iconUrl from "../../public/icon/48.png";

const HOST_ID = "sib-indicator";

export interface IndicatorState {
  /** 目前實際被隱藏的元素數量 */
  hiddenCount: number;
  /** 命中的關鍵字；空字串代表 globalBlock */
  keyword: string;
  categoryLabel: string | null;
  /** 使用者是否已在本頁按下「顯示」 */
  revealed: boolean;
  locale: Locale;
}

export interface Indicator {
  update(state: IndicatorState): void;
  destroy(): void;
}

const STYLE = `
  :host { all: initial; }
  .pill {
    position: fixed;
    bottom: 16px;
    left: 16px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(320px, calc(100vw - 32px));
    padding: 8px 10px 8px 12px;
    border-radius: 10px;
    background: rgba(24, 27, 33, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
    color: #f3f4f6;
    font: 400 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI",
      "Noto Sans TC", sans-serif;
    animation: sib-in 140ms ease-out;
  }
  @keyframes sib-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pill { animation: none; }
  }
  .icon {
    flex: none;
    width: 20px;
    height: 20px;
    display: block;
    border-radius: 4px;
  }
  .text { min-width: 0; }
  .title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* selector 可能失效時，用標題轉色示警（圖示是產品識別，不該變色） */
  .title.warn { color: #fbbf24; }
  .sub {
    color: #9ca3af;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  button {
    flex: none;
    font: inherit;
    font-size: 11px;
    color: #dbeafe;
    background: rgba(255, 255, 255, 0.09);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 6px;
    padding: 4px 9px;
    cursor: pointer;
  }
  button:hover { background: rgba(255, 255, 255, 0.16); }
  button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
`;

/**
 * 建立提示元素。回傳的 `update()` 可重複呼叫，內容變了才動 DOM。
 * `onToggleReveal` 由呼叫端負責實際加/移除封鎖 CSS。
 */
export function createIndicator(onToggleReveal: () => void): Indicator {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = STYLE;

  const pill = document.createElement("div");
  pill.className = "pill";
  pill.setAttribute("role", "status");

  const icon = document.createElement("img");
  icon.className = "icon";
  icon.src = iconUrl;
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");

  const text = document.createElement("div");
  text.className = "text";
  const title = document.createElement("div");
  title.className = "title";
  const sub = document.createElement("div");
  sub.className = "sub";
  text.append(title, sub);

  const button = document.createElement("button");
  button.type = "button";
  button.addEventListener("click", onToggleReveal);

  pill.append(icon, text, button);
  shadow.append(style, pill);
  (document.body ?? document.documentElement).appendChild(host);

  let last = "";

  return {
    update(state) {
      const t = contentMessages[state.locale];
      const found = state.hiddenCount > 0;

      const next = JSON.stringify(state);
      if (next === last) return; // 內容沒變就不動 DOM
      last = next;

      if (state.revealed) {
        title.textContent = t.revealedLabel;
        sub.textContent = t.revealedHint;
        button.textContent = t.restoreBtn;
        button.setAttribute("aria-label", t.restoreBtnAria);
      } else if (found) {
        title.textContent = t.hiddenCount(state.hiddenCount);
        sub.textContent = t.reason(state.keyword, state.categoryLabel);
        button.textContent = t.revealBtn;
        button.setAttribute("aria-label", t.revealBtnAria);
      } else {
        // 阻擋啟用卻一個都沒命中 —— selector 大概失效了
        title.textContent = t.nothingFound;
        sub.textContent = t.nothingFoundHint;
        button.textContent = t.revealBtn;
        button.setAttribute("aria-label", t.revealBtnAria);
      }
      title.className = found || state.revealed ? "title" : "title warn";
    },
    destroy() {
      host.remove();
    },
  };
}
