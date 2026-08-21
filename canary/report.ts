/**
 * 週檢結果的判讀 —— 純函式，不碰 Playwright、不碰檔案系統，所以能被
 * `pnpm test` 一起守住。
 *
 * ## 為什麼是「和基準線比」而不是「assert > 0」
 *
 * 2026-08-21 的首次盤點：預設開啟的 33 條 selector 裡有 23 條在 6 個真實頁面上
 * 一次都沒命中過。寫死 `expect(count > 0)` 會讓每一次執行都亮 23 個紅燈 ——
 * 兩週後就沒有人會再看這份報告，而那等於這套機制從來沒存在過。
 *
 * ## 為什麼「命中數歸零」還不足以判定失效
 *
 * 第一版就是這樣寫的，第二次執行就誤報了：`div[data-attrid*="Video"] img`
 * （5 → 0）和 `g-scrolling-carousel`（1 → 0）掉到 0，但 selector 一個字都沒變。
 * 原因是 Google **不保證**同一個查詢每次都顯示同一組模組 —— 知識面板的影片區、
 * 圖片輪播是否出現，同一個查詢隔十五分鐘就會不一樣。
 *
 * 所以基準線不能只記「上次幾個」，還要記「觀測過幾次、其中幾次有」。一格要能
 * 硬性判定失效，必須先夠可信：
 *   - 穩定度（seen / runs）達 STABLE_RATIO，**而且**
 *   - 命中數大到不可能是內容浮動（max >= HIGH_CONFIDENCE_MIN），
 *     或者已經累積夠多次觀測（runs >= MIN_RUNS_FOR_HARD_FAIL）
 * 不夠可信的一格掉到 0 只報 `flaky`，不讓指令失敗。
 *
 * 代價很明確：新的一格要累積幾次 `canary:update` 才會開始硬性把關。那是誠實的
 * —— 只觀測過一次的東西，本來就還不知道它是穩定的還是偶發的。
 */

/** 單一 (page, selector) 的觀測史 */
export interface Cell {
  /** 歷次觀測到的最大命中數 */
  max: number;
  /** 有命中（>0）的次數 */
  seen: number;
  /** 觀測總次數 */
  runs: number;
}

export type CellTable = Record<string, Record<string, Cell>>;

export interface Baseline {
  version: 2;
  ranAt: string;
  /** 累積執行次數，只有 `canary:update` 會加 */
  runs: number;
  cells: CellTable;
  roots: Record<string, Record<string, boolean>>;
  autocomplete: { listbox: number; options: number } | null;
}

/** 這一次執行看到的東西 */
export interface CanaryRun {
  ranAt: string;
  /** 沒能取得資料的頁面（驗證碼、逾時）—— 這些頁不參與判定 */
  skipped: Record<string, string>;
  /** `null` 代表該 selector 在真 Chrome 裡語法就解析不了 */
  counts: Record<string, Record<string, number | null>>;
  roots: Record<string, Record<string, boolean>>;
  autocomplete: { listbox: number; options: number } | null;
}

export type Verdict =
  /** 命中數與基準線相當 */
  | "ok"
  /** 夠可信的一格掉到 0 —— 這才是 selector 失效的訊號，會讓指令失敗 */
  | "regression"
  /** 掉到 0，但這一格的觀測史還不足以排除「Google 這次沒顯示那個模組」 */
  | "flaky"
  /** 掉得很多但還沒歸零 */
  | "degraded"
  /** 從來沒命中過 —— 不是這次壞的 */
  | "dead"
  /** 過去沒命中、這次有 */
  | "revived"
  /** 基準線沒有這一格（新增的 selector 或新增的頁面） */
  | "new";

/**
 * 掉到基準線最大值的幾成以下算 degraded。
 *
 * 0.3 是刻意寬鬆的：同一個查詢的結果數本來就會浮動，抓太緊只會製造假紅燈，
 * 而假紅燈的代價是整份報告被忽略。真正要抓的是歸零。
 */
export const DEGRADE_RATIO = 0.3;

/** 一格要有這個比例的執行都命中，才算「穩定存在」 */
export const STABLE_RATIO = 0.8;

/**
 * 命中數到這個量級，歸零就不可能是內容浮動。
 *
 * `#search img` 從 212 掉到 0 不需要等三週的觀測史來佐證；但
 * `g-scrolling-carousel` 從 1 掉到 0 完全可能只是這次沒有輪播。
 */
export const HIGH_CONFIDENCE_MIN = 10;

/** 命中數不大的一格，要累積這麼多次觀測才有資格硬性判定失效 */
export const MIN_RUNS_FOR_HARD_FAIL = 3;

/** 這一格的「上次有幾個」是否可信到能拿來當紅燈依據 */
export function isTrustworthy(cell: Cell): boolean {
  if (cell.seen === 0 || cell.runs === 0) return false;
  if (cell.seen / cell.runs < STABLE_RATIO) return false;
  return cell.max >= HIGH_CONFIDENCE_MIN || cell.runs >= MIN_RUNS_FOR_HARD_FAIL;
}

export function judge(cell: Cell | undefined, current: number | null): Verdict {
  // 真 Chrome 都解析不了 —— 這跟內容浮動無關，一定是我們自己寫壞了
  if (current === null) return "regression";
  if (!cell) return current > 0 ? "new" : "dead";
  if (cell.seen === 0) return current > 0 ? "revived" : "dead";
  if (current === 0) return isTrustworthy(cell) ? "regression" : "flaky";
  if (current < cell.max * DEGRADE_RATIO) return "degraded";
  return "ok";
}

export interface Finding {
  page: string;
  selector: string;
  cell: Cell | undefined;
  current: number | null;
  verdict: Verdict;
}

/**
 * 逐格比對。**逐格而不是只看總數**，這是整套機制唯一比現有 dev 稽核多出來的
 * 東西：總數 >0 只證明「還有東西在擋」，一條 selector 靜默失效而其他還在命中
 * 的情況（README 列為 known gap）只有逐格才看得到。
 */
export function compare(run: CanaryRun, baseline: CellTable): Finding[] {
  const findings: Finding[] = [];
  for (const [page, row] of Object.entries(run.counts)) {
    for (const [selector, current] of Object.entries(row)) {
      const cell = baseline[page]?.[selector];
      findings.push({ page, selector, cell, current, verdict: judge(cell, current) });
    }
  }
  return findings;
}

/**
 * 把這次觀測併進基準線。
 *
 * **只有 `canary:update` 會呼叫它**，`pnpm canary` 是唯讀的。這件事是刻意的：
 * 如果每次執行都自動累積，一個真的壞掉的 selector 會因為連續幾週都是 0 而讓
 * `seen / runs` 一路降到門檻以下，然後自己變成 `dead` 不再報警 —— 那正是
 * 「靜默把機制關掉」的失敗模式。跑 update 等於你看過報告、確認這次是正常的。
 *
 * 被略過的頁面（驗證碼）保留舊資料原封不動：沒問到不是證據。
 */
export function mergeBaseline(prev: Baseline | null, run: CanaryRun): Baseline {
  const cells: CellTable = {};
  for (const [page, row] of Object.entries(prev?.cells ?? {})) {
    cells[page] = { ...row };
  }

  for (const [page, row] of Object.entries(run.counts)) {
    const target = (cells[page] ??= {});
    for (const [selector, current] of Object.entries(row)) {
      const n = current ?? 0;
      const before = target[selector];
      target[selector] = before
        ? { max: Math.max(before.max, n), seen: before.seen + (n > 0 ? 1 : 0), runs: before.runs + 1 }
        : { max: n, seen: n > 0 ? 1 : 0, runs: 1 };
    }
  }

  return {
    version: 2,
    ranAt: run.ranAt,
    runs: (prev?.runs ?? 0) + 1,
    cells,
    roots: { ...(prev?.roots ?? {}), ...run.roots },
    autocomplete: run.autocomplete ?? prev?.autocomplete ?? null,
  };
}

/**
 * 把舊格式（v1：只有 counts，沒有觀測史）讀成 v2。
 *
 * 單次觀測一律當成 runs=1 —— 也就是「還不夠格硬性判定失效」，除非命中數本身
 * 就大到毋須佐證。這正是第一版誤報的那兩格會被降級成 flaky 的原因。
 */
export function migrateBaseline(raw: unknown): Baseline | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version === 2) return obj as unknown as Baseline;

  const counts = obj.counts as Record<string, Record<string, number | null>> | undefined;
  if (!counts) return null;

  const cells: CellTable = {};
  for (const [page, row] of Object.entries(counts)) {
    cells[page] = {};
    for (const [selector, n] of Object.entries(row)) {
      const v = n ?? 0;
      cells[page][selector] = { max: v, seen: v > 0 ? 1 : 0, runs: 1 };
    }
  }
  return {
    version: 2,
    ranAt: typeof obj.ranAt === "string" ? obj.ranAt : "unknown",
    runs: 1,
    cells,
    roots: (obj.roots as Baseline["roots"]) ?? {},
    autocomplete: (obj.autocomplete as Baseline["autocomplete"]) ?? null,
  };
}

/**
 * 基準線裡有、這次卻整頁沒跑到的格子。
 *
 * 被 skip 的頁面（驗證碼）不算 —— 那是「沒問到」，不是「壞了」。把兩者混為
 * 一談會讓使用者在 Google 擋人的那一週收到一份全紅的假報告。
 */
export function missingPages(run: CanaryRun, baseline: CellTable): string[] {
  return Object.keys(baseline).filter(
    (page) => !(page in run.counts) && !(page in run.skipped),
  );
}

/** 只有 regression 會讓 `pnpm canary` 以非 0 結束 */
export function regressions(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.verdict === "regression");
}

/** 一條 selector 跨所有頁面的最佳命中 —— 回答「它到底還活著嗎」 */
export function bestPerSelector(counts: CanaryRun["counts"]): Record<string, number> {
  const best: Record<string, number> = {};
  for (const row of Object.values(counts)) {
    for (const [selector, n] of Object.entries(row)) {
      best[selector] = Math.max(best[selector] ?? 0, n ?? 0);
    }
  }
  return best;
}

const MARK: Record<Verdict, string> = {
  ok: "  ",
  regression: "🔴",
  flaky: "🟠",
  degraded: "🟡",
  dead: "⚪",
  revived: "🟢",
  new: "🆕",
};

const BLURB: Partial<Record<Verdict, string>> = {
  regression: "夠可信的一格歸零 —— selector 很可能真的失效了",
  flaky: "歸零，但觀測史還不足以排除「Google 這次沒顯示那個模組」；確認正常就跑 canary:update",
  degraded: "掉了很多但還有命中",
  revived: "過去沒命中、這次有",
  new: "基準線沒有這一格",
};

/** 終端報表。dead 預設摺疊 —— 上百格長期 0 的雜訊會淹掉唯一重要的那一行 */
export function formatReport(
  run: CanaryRun,
  findings: Finding[],
  showDead = false,
  baselineRuns = 0,
): string {
  const lines: string[] = [];
  lines.push(`Google SERP selector 週檢 — ${run.ranAt}（基準線累積 ${baselineRuns} 次觀測）`);

  for (const [page, reason] of Object.entries(run.skipped)) {
    lines.push(`  ⏭  ${page}: 略過（${reason}）`);
  }

  const byVerdict = (v: Verdict) => findings.filter((f) => f.verdict === v);
  const interesting: Verdict[] = ["regression", "flaky", "degraded", "revived", "new"];

  for (const v of interesting) {
    const rows = byVerdict(v);
    if (!rows.length) continue;
    lines.push("");
    lines.push(`${MARK[v]} ${v} (${rows.length})${BLURB[v] ? ` — ${BLURB[v]}` : ""}`);
    for (const f of rows) {
      lines.push(`    [${f.page}] ${f.selector}`);
      const history = f.cell ? `過去 ${f.cell.seen}/${f.cell.runs} 次命中，最多 ${f.cell.max}` : "無紀錄";
      lines.push(`        ${history} → 這次 ${f.current ?? "語法錯誤"}`);
    }
  }

  const dead = byVerdict("dead");
  if (dead.length) {
    lines.push("");
    if (showDead) {
      lines.push(`⚪ dead (${dead.length}) — 從來沒命中過`);
      for (const f of dead) lines.push(`    [${f.page}] ${f.selector}`);
    } else {
      lines.push(`⚪ dead: ${dead.length} 格（從來沒命中過，CANARY_DEAD=1 展開）`);
    }
  }

  lines.push("");
  lines.push(
    `合計 ${findings.length} 格：${byVerdict("ok").length} 正常 · ` +
      `${byVerdict("regression").length} 失效 · ${byVerdict("flaky").length} 待確認 · ` +
      `${byVerdict("degraded").length} 下滑 · ${dead.length} 長期未命中`,
  );

  /**
   * 掃描根與 autocomplete 一律印出來，正常時也印。
   *
   * 只在異常時才出現的檢查項，看起來和「根本沒檢查」一模一樣 —— 而這份報告
   * 每週只被掃一眼，讀的人需要看到它確實問過這兩件事。
   */
  const pagesWithRoots = Object.entries(run.roots);
  const brokenRoots = pagesWithRoots.flatMap(([page, roots]) =>
    Object.entries(roots).filter(([, ok]) => !ok).map(([sel]) => `[${page}] ${sel}`),
  );
  if (brokenRoots.length) {
    lines.push(`  ⚠ 掃描根不存在：${brokenRoots.join(", ")}`);
  } else if (pagesWithRoots.length) {
    lines.push(`  掃描根：#search / #rcnt / #center_col 在 ${pagesWithRoots.length} 頁全部存在`);
  }

  if (run.autocomplete === null) {
    lines.push(`  ⚠ autocomplete：沒能觸發下拉，這次沒檢查到`);
  } else if (run.autocomplete.listbox === 0) {
    lines.push(`  ⚠ autocomplete：找不到 [role="listbox"] —— 下拉選單阻擋已失效`);
  } else {
    lines.push(
      `  autocomplete：listbox ${run.autocomplete.listbox} · option ${run.autocomplete.options}`,
    );
  }

  return lines.join("\n");
}
