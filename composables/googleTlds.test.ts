/**
 * TLD 清單的守門測試。
 *
 * 兩件事：
 *   1. `isGoogleSearchUrl` 對 16 個網域都成立（舊的 `hostname.includes('google.com')`
 *      漏掉其中 9 個，那 9 個地區的使用者永遠看不到 popup 的阻擋來源提示）
 *   2. content script 的 `matches` 字面量與這份清單一致 —— WXT 是靜態分析那個
 *      陣列、不會求值 `.map()`，所以沒辦法從常數產生，只能改用測試釘住。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_HOST_PERMISSIONS,
  GOOGLE_SEARCH_MATCHES,
  GOOGLE_TLDS,
  isGoogleSearchUrl,
} from './googleTlds'

describe('isGoogleSearchUrl', () => {
  it.each(GOOGLE_TLDS.map((tld) => [tld]))('接受 google.%s 的搜尋頁', (tld) => {
    expect(isGoogleSearchUrl(new URL(`https://www.google.${tld}/search?q=x`))).toBe(true)
  })

  /**
   * 這 9 個網域的字串裡不含 `google.com`，正是舊寫法漏掉的那批。
   * 單獨列出來，是為了讓這個 bug 有一條指名道姓的回歸測試。
   */
  it.each([
    'www.google.co.jp',
    'www.google.co.kr',
    'www.google.co.uk',
    'www.google.ca',
    'www.google.co.in',
    'www.google.de',
    'www.google.fr',
    'www.google.es',
    'www.google.it',
  ])('%s —— 舊的 includes("google.com") 會漏掉', (host) => {
    expect(host.includes('google.com')).toBe(false) // 證明舊寫法確實會漏
    expect(isGoogleSearchUrl(new URL(`https://${host}/search?q=x`))).toBe(true)
  })

  it.each([
    ['https://www.google.com/', '非 /search 路徑'],
    ['https://www.google.com/maps', '非 /search 路徑'],
    ['https://mail.google.com/search', '非搜尋子網域'],
    ['https://www.google.com.evil.example/search', 'lookalike 網域'],
    ['https://www.google.pl/search', '不在支援清單內'],
    ['https://example.com/search', '完全無關'],
  ])('拒絕 %s（%s）', (href) => {
    expect(isGoogleSearchUrl(new URL(href))).toBe(false)
  })
})

describe('清單一致性', () => {
  it('content script 的 matches 字面量與 GOOGLE_SEARCH_MATCHES 一致', () => {
    const src = readFileSync(new URL('../entrypoints/content/index.ts', import.meta.url), 'utf8')
    const block = src.match(/matches:\s*\[([\s\S]*?)\]/)
    expect(block, '在 content script 找不到 matches 陣列').not.toBeNull()
    const literal = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect(literal).toEqual(GOOGLE_SEARCH_MATCHES)
  })

  it('host_permissions 與 matches 覆蓋同一組網域', () => {
    expect(GOOGLE_HOST_PERMISSIONS).toHaveLength(GOOGLE_SEARCH_MATCHES.length)
    expect(GOOGLE_HOST_PERMISSIONS.map((p) => new URL(p).hostname)).toEqual(
      GOOGLE_SEARCH_MATCHES.map((m) => new URL(m).hostname),
    )
  })

  it('沒有重複的 TLD', () => {
    expect(GOOGLE_TLDS.length).toBe(new Set(GOOGLE_TLDS).size)
  })
})
