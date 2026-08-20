/**
 * Content script ↔ popup / background 之間的訊息契約，以及診斷結果的判讀。
 *
 * 這個檔案刻意**不 import 任何東西**（跟 googleTlds.ts 同樣的理由）：它同時被
 * content script、popup、background 與測試載入，多一個 `wxt/browser` 就會讓
 * 純函式測試被迫拉進整個 polyfill。
 *
 * ## 為什麼要有「使用者可觸發的診斷」（B8）
 *
 * 這個產品完全沒有遙測，那是它的隱私主張、不打算改。代價是 Google 改 DOM
 * 讓 selector 全部失效時，我們無從得知 —— 使用者只會覺得「這個擴充功能壞了」
 * 然後移除。頁面提示上的「已隱藏 0 個區塊」是第一道訊號，但那要剛好在
 * 被擋的頁面上才看得到；這顆按鈕讓使用者能主動問一次、拿到一句能回報的話。
 */

/** 命令 / popup → content script */
export const TOGGLE_REVEAL_MESSAGE = "sib:toggle-reveal";
export const DIAGNOSE_MESSAGE = "sib:diagnose";

export interface DiagnosisReport {
  /** content script 看到的搜尋字串 */
  query: string;
  paused: boolean;
  /** 這個查詢本身命中黑名單（也就是頁面層級封鎖生效） */
  queryBlocked: boolean;
  /** 封鎖 selector 在這一頁實際命中的元素數 */
  cssMatches: number;
  /** 逐筆比對目前隱藏的圖片數 */
  scannerMatches: number;
  /** 使用者是否已在本頁按下「顯示」 */
  revealed: boolean;
}

export type DiagnosisVerdict =
  /** 問不到 content script：不是搜尋頁、或分頁是擴充功能安裝前就開著的 */
  | "unreachable"
  /** 封鎖被暫停，這一頁本來就不該有動作 */
  | "paused"
  /** 這一頁沒有任何東西該被擋 —— 不是壞掉，只是沒事做 */
  | "idle"
  /** 有擋到東西，運作正常 */
  | "ok"
  /** 該擋卻一個都沒命中 —— 這就是 selector 失效的訊號 */
  | "broken";

/**
 * 把一份報告讀成一句結論。
 *
 * 關鍵是把「沒事做」跟「壞掉」分開：只有在「這個查詢確實命中黑名單」的前提下，
 * 命中 0 個元素才是失效訊號。少了這個前提，使用者在任何一頁按下按鈕都會被
 * 告知擴充功能壞了 —— 那比沒有這顆按鈕更糟。
 */
export function summarizeDiagnosis(
  report: DiagnosisReport | null,
): DiagnosisVerdict {
  if (!report) return "unreachable";
  if (report.paused) return "paused";
  if (report.queryBlocked) {
    return report.cssMatches > 0 ? "ok" : "broken";
  }
  return report.scannerMatches > 0 ? "ok" : "idle";
}
