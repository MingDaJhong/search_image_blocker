/**
 * 在**真實頁面 context** 裡執行的計數函式。
 *
 * 這支函式會被 Playwright 序列化後丟進瀏覽器，所以它不能引用任何外部變數 ——
 * 需要的東西一律從參數進來。回傳值也必須是可結構化複製的純資料。
 *
 * 為什麼一定要在真瀏覽器裡跑：`selectors.ts` 的排除清單整個建立在
 * `:not(:is(cite img, …))` 這種後代組合子上，而 happy-dom 不支援它、
 * 而且是**靜默**回傳錯的結果（CLAUDE.md 有記）。任何在 happy-dom 裡做的
 * 命中數斷言測到的是 happy-dom，不是這個產品。
 */
export interface ProbeResult {
  /** 非空字串代表這一頁沒問到（驗證碼 / 被導走），資料不可用 */
  abort: string | null;
  url: string;
  title: string;
  counts: Record<string, number | null>;
  roots: Record<string, boolean>;
  totalImgs: number;
}

/** 掃描根要逐個回報，不能只看 `RESULT_ROOT_SELECTOR` 整串有沒有命中 —— 三個
 * 裡死掉一個仍然會有 fallback 撐著，但那就是 rotation 開始的第一個徵兆。 */
export const ROOT_SELECTORS = ["#search", "#rcnt", "#center_col"] as const;

export function probePage(args: {
  selectors: string[];
  roots: readonly string[];
}): ProbeResult {
  const bail =
    /sorry|captcha|unusual traffic|before you continue/i.test(document.title) ||
    !!document.querySelector("#captcha-form, form#captcha-form") ||
    location.hostname === "consent.google.com" ||
    location.pathname.startsWith("/sorry");

  if (bail) {
    return {
      abort: location.hostname === "consent.google.com" ? "consent 畫面" : "驗證碼 / sorry 頁",
      url: location.href,
      title: document.title,
      counts: {},
      roots: {},
      totalImgs: 0,
    };
  }

  const counts: Record<string, number | null> = {};
  for (const sel of args.selectors) {
    try {
      counts[sel] = document.querySelectorAll(sel).length;
    } catch {
      // 真 Chrome 都解析不了 —— 比命中 0 更嚴重，report.ts 把 null 判成 regression
      counts[sel] = null;
    }
  }

  const roots: Record<string, boolean> = {};
  for (const r of args.roots) roots[r] = !!document.querySelector(r);

  return {
    abort: null,
    url: location.href,
    title: document.title,
    counts,
    roots,
    totalImgs: document.querySelectorAll("img").length,
  };
}

/** autocomplete 下拉的 ARIA 結構檢查（`observeAutocomplete` 完全靠這兩個角色） */
export function probeAutocomplete(): { listbox: number; options: number } {
  return {
    listbox: document.querySelectorAll('[role="listbox"]').length,
    options: document.querySelectorAll('[role="option"]').length,
  };
}
