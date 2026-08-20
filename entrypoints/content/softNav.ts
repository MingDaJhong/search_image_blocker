/**
 * 追蹤搜尋字串的變化（A6）。
 *
 * `applyState()` 用的 query 原本是 boot 時讀一次就固定在 closure 裡。Google 新版
 * 切換 udm 分頁（網頁／圖片／影片）或按篩選 chip 有部分是走 pushState 的軟導航：
 * 網址的 `q` 換了、結果整批換掉，但 content script 不會重新執行 —— 於是
 * 「搜尋『蝴蝶』後切到圖片分頁」這種最需要保護的路徑上，判斷依據是過期的。
 *
 * ## 為什麼要 poll
 *
 * content script 跑在 isolated world，`history` 是它自己那份 wrapper —— 頁面
 * 自己呼叫的 `pushState()` 不會經過我們，patch 也 patch 不到。`popstate` 只在
 * 上一頁／下一頁時才發，涵蓋不了 Google 主動推的那一種。
 *
 * 所以：`popstate` 負責讓上一頁／下一頁即時反應，計時器負責兜住其餘情況。
 * 每次 tick 只是讀一次 `location.href` 跟字串比較，一秒兩次的成本可以忽略；
 * 而漏掉一次軟導航的代價是使用者看到一整頁沒被遮的圖。
 */

/** 預設輪詢間隔。最壞情況下慢半秒才套用，而不是永遠不套用 */
const DEFAULT_INTERVAL_MS = 500;

export interface QueryWatcher {
  disconnect(): void;
}

/** 從一個網址取出搜尋字串；取不到（含網址不合法）一律當成空字串 */
export function readSearchQuery(href: string): string {
  try {
    return new URL(href).searchParams.get("q") ?? "";
  } catch {
    return "";
  }
}

/**
 * 開始追蹤。`onChange` 只在 `q` 真的變了的時候呼叫，同一個值不會重複觸發。
 *
 * `readQuery` 可以注入，讓測試不必真的操作 location。
 */
export function watchSearchQuery(
  onChange: (query: string) => void,
  opts: { readQuery?: () => string; intervalMs?: number } = {},
): QueryWatcher {
  const readQuery = opts.readQuery ?? (() => readSearchQuery(location.href));
  let last = readQuery();
  let disposed = false;

  function check() {
    if (disposed) return;
    const next = readQuery();
    if (next === last) return;
    last = next;
    onChange(next);
  }

  window.addEventListener("popstate", check);
  const timer = window.setInterval(check, opts.intervalMs ?? DEFAULT_INTERVAL_MS);

  return {
    disconnect() {
      disposed = true;
      window.removeEventListener("popstate", check);
      clearInterval(timer);
    },
  };
}
