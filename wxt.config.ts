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
    // 名稱與描述走 _locales/{zh_TW,en}/messages.json，
    // CWS 與 chrome://extensions 會依使用者語系顯示對應翻譯
    default_locale: 'zh_TW',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    version: '1.0.0',
    permissions: ['storage'],
    host_permissions: GOOGLE_TLDS.map((tld) => `https://www.google.${tld}/*`),
    action: {
      default_title: '__MSG_extName__',
    },
  },
})
