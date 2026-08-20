/**
 * 「點一下顯示這一個」的事件層。
 *
 * blur / mask 兩種模式的重點就是這個互動：使用者知道那裡有東西、由自己決定
 * 要不要看。揭露必須是明確的主動行為 —— 刻意不做 hover 揭露，對這個族群
 * 「滑過去就露出來」比看不到更糟。
 *
 * 只負責事件管線，「什麼算被遮住」與「怎麼揭露」都由呼叫端給：
 * 頁面 CSS 遮的元素靠屬性選擇器抵銷，逐筆掃描遮的元素靠清掉 inline style，
 * 兩條路徑的判斷邏輯都不該長在這裡。
 */

/** 揭露監聽的控制握把 */
export interface ClickRevealer {
  disconnect(): void;
}

export interface ClickRevealOptions {
  /** 從點擊目標往上找「現在正被遮住、且可以點開」的元素；沒有就回傳 null */
  find(target: Element): HTMLElement | null;
  /** 實際把它揭露 */
  reveal(el: HTMLElement): void;
}

export function revealOnClick(opts: ClickRevealOptions): ClickRevealer {
  let disposed = false;

  function onClick(ev: MouseEvent) {
    // 只吃主鍵：中鍵開新分頁、右鍵選單都應該照原樣運作
    if (disposed || ev.button !== 0) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;

    const el = opts.find(target);
    if (!el) return;

    // 遮罩幾乎都疊在結果連結上，不攔的話第一下就直接跳走了 ——
    // 使用者根本看不到自己剛揭露的內容。攔掉之後第二下才是正常的點擊
    // （那時 find() 已經找不到它，事件會照常傳下去）。
    ev.preventDefault();
    ev.stopImmediatePropagation();
    opts.reveal(el);
  }

  // capture 階段：Google 的 jsaction handler 綁在內層元素上，
  // 冒泡階段才攔已經來不及了
  document.addEventListener("click", onClick, true);

  return {
    disconnect() {
      disposed = true;
      document.removeEventListener("click", onClick, true);
    },
  };
}
