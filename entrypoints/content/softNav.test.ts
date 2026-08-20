// @vitest-environment happy-dom
/**
 * 軟導航追蹤（A6）。
 *
 * 為什麼要 poll 而不是掛 pushState hook：content script 跑在 isolated world，
 * `history` 是它自己那份 wrapper，頁面自己呼叫的 pushState patch 不到。
 * 這裡測的是「該觸發時觸發、不該觸發時安靜」的邊界，以及 disconnect 是否乾淨。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSearchQuery, watchSearchQuery } from './softNav'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('readSearchQuery', () => {
  it('取出 q', () => {
    expect(readSearchQuery('https://www.google.com/search?q=%E8%9D%B6&udm=2')).toBe('蝶')
  })

  it('沒有 q 時是空字串', () => {
    expect(readSearchQuery('https://www.google.com/search')).toBe('')
  })

  it('網址不合法時也不能丟例外 —— 這條路上丟出去就整個 content script 掛了', () => {
    expect(readSearchQuery('not a url')).toBe('')
  })
})

describe('watchSearchQuery', () => {
  it('q 換掉時通知一次', () => {
    let href = 'https://www.google.com/search?q=%E8%9D%B4%E8%9C%98'
    const onChange = vi.fn()
    const watcher = watchSearchQuery(onChange, {
      readQuery: () => readSearchQuery(href),
      intervalMs: 100,
    })
    href = 'https://www.google.com/search?q=%E8%9D%B4%E8%9C%98&udm=2'
    vi.advanceTimersByTime(100)
    expect(onChange).not.toHaveBeenCalled() // q 沒變，只是多了 udm

    href = 'https://www.google.com/search?q=%E5%8F%B0%E5%8C%97'
    vi.advanceTimersByTime(100)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('台北')
    watcher.disconnect()
  })

  it('同一個值不會重複觸發，即使 tick 很多次', () => {
    const onChange = vi.fn()
    let q = 'a'
    const watcher = watchSearchQuery(onChange, {
      readQuery: () => q,
      intervalMs: 50,
    })
    q = 'b'
    vi.advanceTimersByTime(500)
    expect(onChange).toHaveBeenCalledOnce()
    watcher.disconnect()
  })

  it('popstate 讓上一頁 / 下一頁即時反應，不用等下一次 tick', () => {
    let q = 'a'
    const onChange = vi.fn()
    const watcher = watchSearchQuery(onChange, {
      readQuery: () => q,
      intervalMs: 10_000,
    })
    q = 'b'
    window.dispatchEvent(new Event('popstate'))
    expect(onChange).toHaveBeenCalledWith('b')
    watcher.disconnect()
  })

  it('disconnect() 之後計時器與 popstate 都不再作用', () => {
    let q = 'a'
    const onChange = vi.fn()
    const watcher = watchSearchQuery(onChange, {
      readQuery: () => q,
      intervalMs: 50,
    })
    watcher.disconnect()
    q = 'b'
    vi.advanceTimersByTime(500)
    window.dispatchEvent(new Event('popstate'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
