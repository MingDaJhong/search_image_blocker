/**
 * 週檢要走訪的頁面矩陣。
 *
 * 選頁原則：**每一條還活著的 selector 至少要被一頁涵蓋**，否則基準線裡它永遠
 * 是 0，Google 哪天真的把它改掉也看不出差別。2026-08-21 的一次性盤點顯示，
 * 同一條 selector 在不同分頁／不同語系的存活狀況並不一致 —— 例如
 * `g-scrolling-carousel` 只在 `hl=en` 的 google.com 出現、
 * `div[data-attrid*="image"]` 只在圖片分頁出現。少走一頁就會把「還活著」
 * 誤判成「早就死了」。
 *
 * 刻意只用兩個 TLD：DOM 幾乎只隨語系與分頁變，多跑 14 個 TLD 只是多 14 次
 * 打 Google 的機會（也就是多 14 次觸發驗證碼的機會），換不到新資訊。
 */
export interface CanaryPage {
  /** 基準線的鍵；改名等於捨棄該頁的歷史紀錄 */
  id: string;
  url: string;
  /** 這一頁是為了守住哪些東西 —— 之後有人想刪頁時要先讀這行 */
  covers: string;
}

export const CANARY_PAGES: CanaryPage[] = [
  {
    id: "tw-web",
    url: "https://www.google.com.tw/search?q=%E8%9C%98%E8%9B%9B",
    covers: '影片卡 [jscontroller="rTuANe"]、youtube 縮圖、relatedQuestions',
  },
  {
    id: "tw-images",
    url: "https://www.google.com.tw/search?q=%E8%9C%98%E8%9B%9B&udm=2",
    covers: 'div[data-attrid*="image"]、imageFilterBar chip、thumbnails 大量命中',
  },
  {
    id: "tw-video",
    url: "https://www.google.com.tw/search?q=%E8%9C%98%E8%9B%9B&udm=7",
    covers: "影片分頁的 youtube 縮圖（此分頁不用 rTuANe）",
  },
  {
    id: "tw-kp",
    url: "https://www.google.com.tw/search?q=%E8%B2%93",
    covers: "中文知識面板 #rhs",
  },
  {
    id: "com-en-web",
    url: "https://www.google.com/search?q=eiffel+tower&hl=en",
    covers: "g-scrolling-carousel（只在英文版出現）、英文知識面板",
  },
  {
    id: "com-en-images",
    url: "https://www.google.com/search?q=spider&udm=2&hl=en",
    covers: "英文圖片分頁 —— 與 tw-images 對照，分辨「語系差異」與「真的壞了」",
  },
];

/** 打字觸發 autocomplete 的頁面與字串（驗 [role="listbox"] / [role="option"]） */
export const AUTOCOMPLETE_PROBE = {
  pageId: "tw-web",
  typed: "蜘蛛",
} as const;
