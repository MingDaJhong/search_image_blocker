/**
 * 支援的 Google 地區網域 —— 這裡是唯一來源。
 *
 * 這個檔案刻意**不 import 任何東西**。它同時被三種環境載入：
 *   1. Node（`wxt.config.ts` 產生 host_permissions）
 *   2. Popup（判斷目前分頁是不是 Google 搜尋頁）
 *   3. 測試
 * 只要多一個 import（例如 `wxt/browser`）就會在 Node 端炸掉。
 *
 * Content script 的 `matches` 沒辦法從這裡產生 —— WXT 在 build 時是靜態分析
 * 那個陣列，不會求值 `.map()`。所以那邊仍是手寫字面量，改由
 * `composables/googleTlds.test.ts` 斷言兩者一致，把「記得同步」變成會失敗的測試。
 */
export const GOOGLE_TLDS = [
  'com',
  'com.tw',
  'com.hk',
  'co.jp',
  'co.kr',
  'com.sg',
  'co.uk',
  'com.au',
  'ca',
  'co.in',
  'de',
  'fr',
  'es',
  'it',
  'com.br',
  'com.mx',
] as const

/** manifest 的 host_permissions */
export const GOOGLE_HOST_PERMISSIONS = GOOGLE_TLDS.map((tld) => `https://www.google.${tld}/*`)

/** content script 的 matches（測試用來比對手寫字面量） */
export const GOOGLE_SEARCH_MATCHES = GOOGLE_TLDS.map(
  (tld) => `https://www.google.${tld}/search*`,
)

const SEARCH_HOSTS: ReadonlySet<string> = new Set(
  GOOGLE_TLDS.map((tld) => `www.google.${tld}`),
)

/**
 * 這個 URL 是不是我們有注入 content script 的 Google 搜尋頁。
 *
 * 用 hostname 完全比對，不是 `includes('google.com')` —— 後者會漏掉
 * `google.co.jp` / `.co.kr` / `.co.uk` / `.ca` / `.co.in` / `.de` / `.fr` /
 * `.es` / `.it` 這 9 個網域（它們的字串裡沒有 `google.com`），
 * 同時又會誤收 `google.com.evil.example` 這種。
 */
export function isGoogleSearchUrl(url: URL): boolean {
  return SEARCH_HOSTS.has(url.hostname) && url.pathname === '/search'
}
