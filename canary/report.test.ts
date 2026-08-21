import { describe, expect, it } from 'vitest'
import {
  DEGRADE_RATIO,
  HIGH_CONFIDENCE_MIN,
  MIN_RUNS_FOR_HARD_FAIL,
  bestPerSelector,
  compare,
  formatReport,
  judge,
  mergeBaseline,
  migrateBaseline,
  missingPages,
  regressions,
  type CanaryRun,
  type Cell,
} from './report'

const runOf = (partial: Partial<CanaryRun>): CanaryRun => ({
  ranAt: '2026-08-21',
  skipped: {},
  counts: {},
  roots: {},
  autocomplete: null,
  ...partial,
})

const cell = (max: number, seen = 1, runs = 1): Cell => ({ max, seen, runs })

describe('judge', () => {
  it('命中數大到不可能是內容浮動時，歸零就是失效', () => {
    // #search img 從 212 掉到 0 不需要等三週的觀測史來佐證
    expect(judge(cell(212), 0)).toBe('regression')
  })

  it('命中數小又只觀測過一次時，歸零只算待確認', () => {
    // 這是第一版真的誤報的兩格：Google 不保證同一個查詢每次都顯示同一組模組，
    // 知識面板影片區與圖片輪播隔十五分鐘就可能不見
    expect(judge(cell(5), 0)).toBe('flaky')
    expect(judge(cell(1), 0)).toBe('flaky')
  })

  it('小命中數累積夠多次穩定觀測後，才升級成硬性紅燈', () => {
    const runs = MIN_RUNS_FOR_HARD_FAIL
    expect(judge(cell(5, runs, runs), 0)).toBe('regression')
    expect(judge(cell(5, runs - 1, runs - 1), 0)).toBe('flaky')
  })

  it('時有時無的一格永遠不會硬性判定失效', () => {
    // 觀測十次只出現三次 —— 這一格本來就不穩定，拿它當紅燈依據只會製造假警報
    expect(judge(cell(5, 3, 10), 0)).toBe('flaky')
  })

  it('高命中數但不穩定時，仍然不硬性判定', () => {
    expect(judge(cell(HIGH_CONFIDENCE_MIN * 5, 2, 10), 0)).toBe('flaky')
  })

  it('真瀏覽器解析不了 selector 一律算失效', () => {
    // 語法壞掉跟 Google 顯示什麼無關，一定是我們自己寫壞了
    expect(judge(cell(1), null)).toBe('regression')
    expect(judge(cell(0, 0, 5), null)).toBe('regression')
    expect(judge(undefined, null)).toBe('regression')
  })

  it('從來沒命中過 = 長期未命中，不是這次壞的', () => {
    // 首次盤點：33 條裡 23 條屬於這一類。算成紅燈的話報告永遠是紅的
    expect(judge(cell(0, 0, 4), 0)).toBe('dead')
  })

  it('過去沒命中、這次有 = Google 加回來了', () => {
    expect(judge(cell(0, 0, 4), 3)).toBe('revived')
  })

  it('基準線沒有這一格時，看這次有沒有命中', () => {
    expect(judge(undefined, 5)).toBe('new')
    expect(judge(undefined, 0)).toBe('dead')
  })

  it('掉到門檻以下算 degraded，門檻以上算正常', () => {
    expect(judge(cell(100), Math.floor(100 * DEGRADE_RATIO) - 1)).toBe('degraded')
    expect(judge(cell(100), Math.ceil(100 * DEGRADE_RATIO) + 1)).toBe('ok')
  })

  it('結果數正常浮動不該亮燈', () => {
    // 同一個查詢的 `#search img` 觀測到 15～212，抓太緊只會製造假紅燈
    expect(judge(cell(212), 150)).toBe('ok')
    expect(judge(cell(15), 31)).toBe('ok')
  })
})

describe('compare', () => {
  const baseline = {
    'tw-images': { 'g-img': cell(0, 0, 3), '#search img': cell(206, 3, 3) },
    'tw-web': { 'g-img': cell(0, 0, 3), '#search img': cell(15, 3, 3) },
  }

  it('逐格比對，不是只看總數', () => {
    // 這是整套機制存在的理由：總數 >0 只證明「還有東西在擋」，
    // 一條 selector 靜默失效而其他還命中的情況只有逐格看得到
    const run = runOf({
      counts: {
        'tw-images': { 'g-img': 0, '#search img': 0 },
        'tw-web': { 'g-img': 0, '#search img': 15 },
      },
    })
    const bad = regressions(compare(run, baseline))
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({ page: 'tw-images', selector: '#search img', current: 0 })
  })

  it('沒有任何變化時不產生 regression', () => {
    const run = runOf({
      counts: {
        'tw-images': { 'g-img': 0, '#search img': 206 },
        'tw-web': { 'g-img': 0, '#search img': 15 },
      },
    })
    expect(regressions(compare(run, baseline))).toEqual([])
  })
})

describe('被略過的頁面', () => {
  const baseline = { 'tw-web': { 'g-img': cell(20, 3, 3) }, 'tw-images': { 'g-img': cell(20, 3, 3) } }

  it('驗證碼擋下的頁面不算失效', () => {
    // 「沒問到」和「壞了」混為一談，會讓 Google 擋人的那一週收到一份全紅的假報告
    const run = runOf({ skipped: { 'tw-web': '驗證碼 / sorry 頁', 'tw-images': '驗證碼 / sorry 頁' } })
    expect(regressions(compare(run, baseline))).toEqual([])
    expect(missingPages(run, baseline)).toEqual([])
  })

  it('既沒跑到又沒被略過的頁面要被指出來', () => {
    const run = runOf({ counts: { 'tw-web': { 'g-img': 20 } } })
    expect(missingPages(run, baseline)).toEqual(['tw-images'])
  })
})

describe('mergeBaseline', () => {
  it('累積觀測史：命中次數、總次數、歷來最大值', () => {
    const first = mergeBaseline(null, runOf({ counts: { p: { s: 5 } } }))
    expect(first.cells.p.s).toEqual({ max: 5, seen: 1, runs: 1 })
    expect(first.runs).toBe(1)

    const second = mergeBaseline(first, runOf({ counts: { p: { s: 0 } } }))
    expect(second.cells.p.s).toEqual({ max: 5, seen: 1, runs: 2 })
    expect(second.runs).toBe(2)

    const third = mergeBaseline(second, runOf({ counts: { p: { s: 9 } } }))
    expect(third.cells.p.s).toEqual({ max: 9, seen: 2, runs: 3 })
  })

  it('被略過的頁面保留舊資料，不當成一次觀測', () => {
    // 沒問到不是證據。算成一次「沒命中」會讓穩定度被驗證碼稀釋掉
    const first = mergeBaseline(null, runOf({ counts: { a: { s: 5 }, b: { s: 5 } } }))
    const second = mergeBaseline(first, runOf({ counts: { a: { s: 5 } }, skipped: { b: '驗證碼' } }))
    expect(second.cells.b.s).toEqual({ max: 5, seen: 1, runs: 1 })
    expect(second.cells.a.s).toEqual({ max: 5, seen: 2, runs: 2 })
  })

  it('語法錯誤當成 0 次命中，不會炸掉統計', () => {
    const merged = mergeBaseline(null, runOf({ counts: { p: { s: null } } }))
    expect(merged.cells.p.s).toEqual({ max: 0, seen: 0, runs: 1 })
  })
})

describe('migrateBaseline', () => {
  it('舊格式一律當成單次觀測 —— 也就是還不夠格硬性判定失效', () => {
    const v2 = migrateBaseline({ ranAt: '2026-08-21', counts: { p: { small: 5, big: 212, none: 0 } } })
    expect(v2?.cells.p.small).toEqual({ max: 5, seen: 1, runs: 1 })
    expect(v2?.cells.p.none).toEqual({ max: 0, seen: 0, runs: 1 })
    // 第一版誤報的那一格，遷移後降級成 flaky
    expect(judge(v2!.cells.p.small, 0)).toBe('flaky')
    // 命中數本來就大的那一格不受影響，照樣是紅燈
    expect(judge(v2!.cells.p.big, 0)).toBe('regression')
  })

  it('已經是 v2 就原樣回傳', () => {
    const v2 = { version: 2, ranAt: 'x', runs: 4, cells: {}, roots: {}, autocomplete: null }
    expect(migrateBaseline(v2)).toBe(v2)
  })

  it('壞掉或不認得的內容回 null，而不是拋例外', () => {
    expect(migrateBaseline(null)).toBeNull()
    expect(migrateBaseline({})).toBeNull()
    expect(migrateBaseline('nonsense')).toBeNull()
  })
})

describe('bestPerSelector', () => {
  it('取跨頁最佳命中 —— 一條 selector 只在某個分頁活著是正常的', () => {
    // div[data-attrid*="image"] 在一般分頁 0、圖片分頁 100
    const best = bestPerSelector({
      'tw-web': { 'div[data-attrid*="image"]': 0 },
      'tw-images': { 'div[data-attrid*="image"]': 100 },
    })
    expect(best['div[data-attrid*="image"]']).toBe(100)
  })

  it('語法錯誤的格子當 0 處理', () => {
    expect(bestPerSelector({ a: { x: null }, b: { x: 2 } })).toEqual({ x: 2 })
  })
})

describe('formatReport', () => {
  const run = runOf({
    counts: { 'tw-web': { alive: 3, gone: 0, wobbly: 0, longDead: 0 } },
    roots: { 'tw-web': { '#search': true, '#rcnt': false, '#center_col': true } },
    skipped: { 'tw-images': '驗證碼 / sorry 頁' },
    autocomplete: { listbox: 0, options: 0 },
  })
  const findings = compare(run, {
    'tw-web': {
      alive: cell(3, 3, 3),
      gone: cell(50, 3, 3),
      wobbly: cell(2, 1, 1),
      longDead: cell(0, 0, 3),
    },
  })

  it('把硬性失效和待確認分開顯示', () => {
    const out = formatReport(run, findings)
    expect(out).toContain('🔴')
    expect(out).toContain('🟠')
    expect(out).toContain('canary:update')
  })

  it('印出觀測史，不是只印上次的數字', () => {
    // 「過去 3/3 次命中」和「過去 1/1 次命中」對讀報告的人是完全不同的資訊
    expect(formatReport(run, findings)).toContain('過去 3/3 次命中')
  })

  it('預設摺疊長期未命中的格子', () => {
    const out = formatReport(run, findings)
    expect(out).toContain('gone')
    expect(out).not.toContain('    [tw-web] longDead')
    expect(formatReport(run, findings, true)).toContain('[tw-web] longDead')
  })

  it('略過的頁面、消失的掃描根、失效的 autocomplete 都要出現在報表裡', () => {
    const out = formatReport(run, findings)
    expect(out).toContain('tw-images')
    expect(out).toContain('#rcnt')
    expect(out).toContain('listbox')
  })

  it('掃描根與 autocomplete 正常時也要印出來', () => {
    // 只在異常時出現的檢查項，看起來和「根本沒檢查」一樣
    const healthy = runOf({
      counts: { 'tw-web': { alive: 1 } },
      roots: { 'tw-web': { '#search': true, '#rcnt': true, '#center_col': true } },
      autocomplete: { listbox: 4, options: 24 },
    })
    const out = formatReport(healthy, compare(healthy, { 'tw-web': { alive: cell(1, 3, 3) } }))
    expect(out).toContain('掃描根')
    expect(out).toContain('listbox 4')
  })

  it('沒能觸發下拉時要說「沒檢查到」，不能靜默', () => {
    const noAuto = runOf({ counts: { 'tw-web': { alive: 1 } }, autocomplete: null })
    expect(formatReport(noAuto, [])).toContain('沒能觸發下拉')
  })

  it('標題要說明基準線累積了幾次觀測', () => {
    // 報告可信度完全取決於這個數字，藏起來讀的人就無從判斷紅燈該不該當真
    expect(formatReport(run, findings, false, 7)).toContain('累積 7 次觀測')
  })
})
