/**
 * 讓頁面提示上那個數字跟得上延遲載入的縮圖。
 *
 * ## 原本為什麼不這樣做
 *
 * 這裡本來是 `onDomReady` 之後補兩次 `setTimeout`（1 秒、3 秒），註解寫得很明白：
 * 「這只是個資訊性標籤，不值得為了它在每一次 DOM 變動上付出成本」。那個權衡在
 * 「圖片隨頁面一起進來」的前提下是對的。
 *
 * 但 Google 的縮圖是**捲到才載**的。實測影片分頁：提示寫「已隱藏 10 個區塊」，
 * 捲過一趟之後實際被遮的是 23 張 —— 兩次補數都發生在使用者開始捲之前，固定
 * 時間點永遠追不上一個由捲動觸發的行為。
 *
 * ## 為什麼值得改
 *
 * 數字低估本身不影響遮蔽。但這個數字同時是這個產品**唯一**的 selector 失效
 * 訊號（沒有遙測，「已隱藏 0 個區塊」是使用者唯一會看到的壞掉提示）。一個
 * 已知會少報的數字，會讓那個訊號也跟著不可信。
 *
 * ## 成本
 *
 * 跟 resultScanner 同一套：MutationObserver + 300 ms debounce，觀察範圍也是
 * 同一組結果容器。兩者永遠不會同時存在 —— 逐筆掃描只在 query 沒命中時跑，
 * 這個只在 query 命中（頁面 CSS 生效）時掛 —— 所以總成本仍是一個 observer。
 * 重算之後 `indicator.update()` 自己會 diff，數字沒變就不寫 DOM。
 */
import { RESULT_ROOT_SELECTOR } from "./selectors";

/** 與 resultScanner 對齊：Google 頻繁改動時不空轉 */
const DEBOUNCE_MS = 300;

export interface BlockCountWatcher {
  disconnect(): void;
}

/**
 * 觀察結果區的 DOM 變動，安定後呼叫 `onChange`（由呼叫端去重算並更新提示）。
 *
 * 找不到已知的結果容器就退回 `document.body` —— 跟 resultScanner 的
 * `resultRoots()` 同樣的理由：漏掉整片結果區的代價，比多觀察一點大得多。
 */
export function watchBlockedCount(onChange: () => void): BlockCountWatcher {
  let disposed = false;
  let timer = 0;

  function schedule() {
    if (disposed || timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      if (!disposed) onChange();
    }, DEBOUNCE_MS);
  }

  const observer = new MutationObserver(schedule);
  const known = document.querySelectorAll(RESULT_ROOT_SELECTOR);
  const roots: Element[] = known.length > 0 ? [...known] : document.body ? [document.body] : [];
  for (const root of roots) {
    observer.observe(root, { childList: true, subtree: true });
  }

  return {
    disconnect() {
      disposed = true;
      observer.disconnect();
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
    },
  };
}
