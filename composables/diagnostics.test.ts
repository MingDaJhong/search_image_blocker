/**
 * 診斷結論的判讀（B8）。
 *
 * 這支函式唯一會犯的錯就是把「這一頁沒事做」講成「擴充功能壞了」。
 * 那比沒有這顆按鈕更糟 —— 使用者會在任何一頁按下去然後去移除擴充功能。
 */
import { describe, expect, it } from 'vitest'
import { summarizeDiagnosis, type DiagnosisReport } from './diagnostics'

const base: DiagnosisReport = {
  query: '蜘蛛',
  paused: false,
  queryBlocked: true,
  cssMatches: 12,
  scannerMatches: 0,
  revealed: false,
}

describe('summarizeDiagnosis', () => {
  it('問不到 content script → unreachable', () => {
    expect(summarizeDiagnosis(null)).toBe('unreachable')
  })

  it('暫停中 → paused（不是壞掉）', () => {
    expect(summarizeDiagnosis({ ...base, paused: true })).toBe('paused')
  })

  it('該擋、也擋到了 → ok', () => {
    expect(summarizeDiagnosis(base)).toBe('ok')
  })

  it('該擋卻一個都沒命中 → broken，這就是 selector 失效的訊號', () => {
    expect(summarizeDiagnosis({ ...base, cssMatches: 0 })).toBe('broken')
  })

  it('查詢沒命中黑名單、逐筆也沒擋到 → idle，不能說成壞掉', () => {
    // 沒有這一條，使用者在任何一頁按下按鈕都會被告知擴充功能壞了
    expect(
      summarizeDiagnosis({
        ...base,
        query: '台北天氣',
        queryBlocked: false,
        cssMatches: 0,
      }),
    ).toBe('idle')
  })

  it('只有逐筆比對擋到東西也算正常運作', () => {
    expect(
      summarizeDiagnosis({
        ...base,
        queryBlocked: false,
        cssMatches: 0,
        scannerMatches: 3,
      }),
    ).toBe('ok')
  })

  it('使用者按了本頁顯示，仍然照 DOM 命中數判斷 —— 顯示不代表壞掉', () => {
    expect(summarizeDiagnosis({ ...base, revealed: true })).toBe('ok')
  })
})
