import { defineConfig } from 'wxt'

// 與 entrypoints/content/index.ts 的 matches 同步維護
const GOOGLE_TLDS = [
  'com', 'com.tw', 'com.hk', 'co.jp', 'co.kr', 'com.sg',
  'co.uk', 'com.au', 'ca', 'co.in',
  'de', 'fr', 'es', 'it', 'com.br', 'com.mx',
]

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  runner: {
    startUrls: ['https://www.google.com/search?q=蝴蝶'],
  },
  manifest: {
    name: 'Search Image Blocker',
    description: '依關鍵字隱藏 Google 搜尋頁的圖片、影片區塊',
    version: '0.0.1',
    permissions: ['storage'],
    host_permissions: GOOGLE_TLDS.map((tld) => `https://www.google.${tld}/*`),
    action: {
      default_title: 'Search Image Blocker',
    },
  },
})
