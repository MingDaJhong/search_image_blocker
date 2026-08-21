/**
 * 週檢主程式：開一個真的 Chrome，走過 CANARY_PAGES，逐條數 selector 命中數，
 * 和 `canary/baseline.json` 比對。
 *
 * ## 為什麼不能放進 CI
 *
 * GitHub Actions 的 IP 是資料中心 IP，Google 幾乎必定回驗證碼。這支程式碼
 * 刻意設計成「在你自己的機器、用你自己的 Chrome、每週手動跑一次」——
 * 低頻、真實 profile、headed，就是它不會被擋的原因。把它搬上 CI 不會得到
 * 一份自動化報告，只會得到一份每週都是 ⏭ 略過的報告。
 *
 * ## 為什麼用 vitest 當 runner
 *
 * 專案裡沒有 ts-node / tsx，而這支程式需要 `import` 產品的 `selectors.ts`
 * 才能保證測到的**就是實際出貨的那份清單**（複製一份 selector 到腳本裡，
 * 兩邊遲早會 drift，而 drift 的方向一定是「腳本測著已經被刪掉的東西」）。
 * vitest 已經在專案裡、已經接好 `@/` alias，多裝一個 runner 換不到東西。
 *
 * 用法：
 *   pnpm canary                # 比對基準線
 *   pnpm canary:update         # 把這次結果寫成新基準線
 *   CANARY_DEAD=1 pnpm canary  # 展開長期未命中的那 29 格
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_SETTINGS } from "@/composables/blockList";
import { collectAllSelectors } from "@/entrypoints/content/selectors";
import { AUTOCOMPLETE_PROBE, CANARY_PAGES } from "./pages";
import { ROOT_SELECTORS, probeAutocomplete, probePage, type ProbeResult } from "./probe";
import {
  compare,
  formatReport,
  mergeBaseline,
  migrateBaseline,
  missingPages,
  regressions,
  type Baseline,
  type CanaryRun,
} from "./report";

const ROOT = resolve(import.meta.dirname, "..");
const BASELINE_PATH = resolve(ROOT, "canary/baseline.json");
/** 複製出來的 profile：留著 consent cookie 與搜尋偏好，別指向你日常用的 profile
 * （Chrome 會鎖住正在使用中的 user-data-dir，而且測試不該碰你的實際瀏覽資料） */
const PROFILE_DIR = resolve(ROOT, ".canary-profile");

const UPDATE = process.env.CANARY_UPDATE === "1";
const SHOW_DEAD = process.env.CANARY_DEAD === "1";

/**
 * 用**預設開啟**的 blockTypes，不是全開。
 *
 * 全開會把 relatedQuestions / knowledgePanel 兩組拉進基準線，但那兩個預設是
 * 關的 —— 它們壞掉不影響任何一個沒去改設定的使用者。基準線應該反映真實出貨
 * 的設定，否則紅燈的嚴重性會被稀釋。
 */
const SELECTORS = collectAllSelectors(DEFAULT_SETTINGS.blockTypes);

let context: BrowserContext | null = null;
let run: CanaryRun;

/** 每頁之間隨機停一下：連續等距的請求是最容易被判成機器人的訊號 */
const jitter = () => new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));

/**
 * 讓 lazy-load 的縮圖真的載進來再數。
 *
 * 圖片分頁的縮圖是捲到才載的：不捲直接數，命中數會隨當下視窗高度浮動，基準線
 * 就變成噪音。捲一趟再回頂讓每次執行落在同一個狀態。
 */
async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("#search, #rcnt, #center_col, #captcha-form", {
    timeout: 15_000,
  }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 1800));
  await page.waitForTimeout(1800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
}

beforeAll(async () => {
  mkdirSync(PROFILE_DIR, { recursive: true });
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    // 用系統安裝的 Chrome，不是 Playwright 自帶的 Chromium：後者的 UA 與
    // 指紋更容易被 Google 認出來，而我們要的正是「和你平常看到的同一個頁面」
    channel: "chrome",
    headless: false,
    viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized"],
  });

  const page = context.pages()[0] ?? (await context.newPage());
  const counts: CanaryRun["counts"] = {};
  const roots: CanaryRun["roots"] = {};
  const skipped: Record<string, string> = {};
  let autocomplete: CanaryRun["autocomplete"] = null;

  for (const entry of CANARY_PAGES) {
    let result: ProbeResult;
    try {
      await page.goto(entry.url, { waitUntil: "commit", timeout: 30_000 });
      await settle(page);
      result = await page.evaluate(probePage, {
        selectors: SELECTORS,
        roots: [...ROOT_SELECTORS],
      });
    } catch (err) {
      skipped[entry.id] = `導覽失敗：${(err as Error).message.split("\n")[0]}`;
      continue;
    }

    if (result.abort) {
      skipped[entry.id] = result.abort;
      continue;
    }

    counts[entry.id] = result.counts;
    roots[entry.id] = result.roots;

    if (entry.id === AUTOCOMPLETE_PROBE.pageId) {
      try {
        const box = page.locator('textarea[name="q"], input[name="q"]').first();
        await box.click({ timeout: 5_000 });
        await box.fill("");
        // 逐字打，Google 的建議是靠 keystroke 觸發的，fill() 不會讓它出現
        await box.pressSequentially(AUTOCOMPLETE_PROBE.typed, { delay: 140 });
        await page.waitForTimeout(1600);
        autocomplete = await page.evaluate(probeAutocomplete);
      } catch {
        autocomplete = null;
      }
    }

    await jitter();
  }

  run = { ranAt: new Date().toISOString().slice(0, 10), skipped, counts, roots, autocomplete };
}, 300_000);

afterAll(async () => {
  await context?.close();
});

it("Google SERP 的 selector 命中數沒有相對基準線失效", () => {
  let prev: Baseline | null = null;
  try {
    prev = migrateBaseline(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));
  } catch {
    /* 第一次執行 */
  }

  const findings = compare(run, prev?.cells ?? {});
  console.log("\n" + formatReport(run, findings, SHOW_DEAD, prev?.runs ?? 0) + "\n");

  const gone = missingPages(run, prev?.cells ?? {});
  if (gone.length) console.log(`⚠ 基準線有、這次沒跑到的頁面：${gone.join(", ")}`);

  // 全部頁面都被擋 = 沒問到，不是壞了。判成失敗只會訓練你忽略這份報告。
  if (Object.keys(run.counts).length === 0) {
    console.log("⏭ 沒有任何一頁取得資料（多半是驗證碼或 consent 畫面）");
    console.log("   請用 .canary-profile 開一次 Google、手動通過畫面後再跑一次");
    // 這裡刻意不寫基準線：一份全空的基準線會讓下一次執行把所有東西
    // 判成 'new'，等於靜默把這套機制關掉
    expect(Object.keys(run.skipped)).toEqual([]);
    return;
  }

  if (UPDATE || !prev) {
    const next = mergeBaseline(prev, run);
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(
      prev
        ? `✅ 觀測已併入基準線（累積 ${next.runs} 次）`
        : "✅ 第一次執行，已建立基準線",
    );
    return;
  }

  const bad = regressions(findings);
  if (bad.length) {
    console.log("確認 Google 只是這次沒顯示那些模組的話，跑 pnpm canary:update 把觀測併進基準線");
  }
  expect(
    bad.map(
      (f) =>
        `[${f.page}] ${f.selector} (過去 ${f.cell?.seen}/${f.cell?.runs} 次命中，最多 ${f.cell?.max} → 這次 ${f.current ?? "語法錯誤"})`,
    ),
  ).toEqual([]);
});
