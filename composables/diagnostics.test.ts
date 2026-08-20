/**
 * 診斷結論的判讀（B8）。
 *
 * 這支函式唯一會犯的錯就是把「這一頁沒事做」講成「擴充功能壞了」。
 * 那比沒有這顆按鈕更糟 —— 使用者會在任何一頁按下去然後去移除擴充功能。
 */
import { describe, expect, it } from 'vitest'
import {
  hiddenCountOf,
  summarizeDiagnosis,
  summarizePageStatus,
  type DiagnosisReport,
} from './diagnostics'

const base: DiagnosisReport = {
  query: '蜘蛛',
  paused: false,
  queryBlocked: true,
  cssMatches: 12,
  scannerMatches: 0,
  scannerMatch: null,
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

describe('summarizePageStatus', () => {
  const on = { onSearchPage: true, queryBlocked: false, queryAllowed: false }

  it('不在搜尋頁 → offsite', () => {
    expect(
      summarizePageStatus({ ...on, onSearchPage: false, report: null }),
    ).toBe('offsite')
  })

  /**
   * 這是實際發生過的 bug：搜「像是蛛」，query 一個關鍵字都不命中，
   * 但逐筆結果比對擋掉 52 張圖。popup 只看 query 比對就會說「沒有被阻擋」，
   * 而頁面左下角的提示同時寫著「已隱藏 52 個區塊」—— 兩邊互相打臉。
   */
  it('query 沒命中、但逐筆比對擋到東西 → blocked', () => {
    expect(
      summarizePageStatus({
        ...on,
        report: { ...base, queryBlocked: false, cssMatches: 0, scannerMatches: 52 },
      }),
    ).toBe('blocked')
  })

  it('query 命中時看的是 CSS 命中數', () => {
    expect(
      summarizePageStatus({
        ...on,
        queryBlocked: true,
        report: { ...base, queryBlocked: true, cssMatches: 9, scannerMatches: 0 },
      }),
    ).toBe('blocked')
  })

  it('問不到 content script 時退回 query 比對', () => {
    expect(summarizePageStatus({ ...on, queryBlocked: true, report: null })).toBe(
      'blocked',
    )
    expect(summarizePageStatus({ ...on, queryAllowed: true, report: null })).toBe(
      'allowed',
    )
  })

  it('例外放行 → allowed', () => {
    expect(
      summarizePageStatus({
        ...on,
        queryAllowed: true,
        report: { ...base, queryBlocked: false, cssMatches: 0, scannerMatches: 0 },
      }),
    ).toBe('allowed')
  })

  it('什麼都沒發生 → idle（不是壞掉）', () => {
    expect(
      summarizePageStatus({
        ...on,
        report: { ...base, queryBlocked: false, cssMatches: 0, scannerMatches: 0 },
      }),
    ).toBe('idle')
  })
})

describe('hiddenCountOf', () => {
  it('query 命中看 CSS、沒命中看逐筆', () => {
    expect(hiddenCountOf({ ...base, queryBlocked: true, cssMatches: 9, scannerMatches: 3 })).toBe(9)
    expect(hiddenCountOf({ ...base, queryBlocked: false, cssMatches: 9, scannerMatches: 3 })).toBe(3)
  })

  it('問不到就是 null —— 不能編一個 0 出來', () => {
    // 0 的意思是「檢查過，一個都沒擋到」，那是 selector 失效的訊號；
    // null 的意思是「問不到」。狀態卡靠這個差別決定要不要顯示數字。
    expect(hiddenCountOf(null)).toBeNull()
  })
})
