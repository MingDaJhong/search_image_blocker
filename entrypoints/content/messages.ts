/**
 * Content script 專用的文案。
 *
 * 刻意不共用 `entrypoints/popup/i18n.ts`：那份表有 60 幾個條目，而且是單一
 * 物件字面量，import 進來會整包被打進注入到每一頁的 content bundle。
 * 這裡只留頁面提示真正會用到的幾句。
 */
import type { Locale } from "@/composables/blockList";

export const contentMessages = {
  "zh-TW": {
    hiddenCount: (n: number) => `已隱藏 ${n} 個區塊`,
    reason: (keyword: string, category: string | null) =>
      !keyword
        ? "全域阻擋"
        : category
          ? `關鍵字「${keyword}」· ${category}`
          : `關鍵字「${keyword}」`,
    revealBtn: "顯示",
    revealBtnAria: "在這個頁面顯示被隱藏的圖片（不會改變設定）",
    revealedLabel: "已顯示本頁圖片",
    revealedHint: "重新整理就會恢復隱藏",
    restoreBtn: "復原",
    restoreBtnAria: "重新隱藏這個頁面的圖片",
    nothingFound: "沒有找到可隱藏的區塊",
    nothingFoundHint: "Google 可能改版了，請回報",
  },
  en: {
    hiddenCount: (n: number) => `${n} block${n === 1 ? "" : "s"} hidden`,
    reason: (keyword: string, category: string | null) =>
      !keyword
        ? "Block all is on"
        : category
          ? `Keyword "${keyword}" · ${category}`
          : `Keyword "${keyword}"`,
    revealBtn: "Show",
    revealBtnAria: "Show hidden images on this page (does not change settings)",
    revealedLabel: "Images shown on this page",
    revealedHint: "Reload to hide them again",
    restoreBtn: "Undo",
    restoreBtnAria: "Hide images on this page again",
    nothingFound: "Nothing found to hide",
    nothingFoundHint: "Google may have changed its layout — please report it",
  },
} as const;

export type ContentMessages = (typeof contentMessages)[Locale];
