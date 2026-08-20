import { defineConfig } from 'wxt'
import { GOOGLE_HOST_PERMISSIONS } from './composables/googleTlds'

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({
    build: {
      // 頁面提示的圖示要被內嵌成 data URI，不能變成 emit 出來的檔案 ——
      // 後者需要列進 web_accessible_resources，等於讓 google.com 可以探測
      // 這個擴充功能是否安裝。預設上限 4 KB 對 48px 圖示（3.9 KB）太貼邊，
      // 日後重算圖示稍微變大就會靜默翻轉這個取捨。
      assetsInlineLimit: 8192,
    },
  }),
  runner: {
    startUrls: ['https://www.google.com/search?q=蝴蝶'],
  },
  manifest: {
    // 名稱與描述走 _locales/{zh_TW,en}/messages.json，
    // CWS 與 chrome://extensions 會依使用者語系顯示對應翻譯
    default_locale: 'zh_TW',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    version: '1.0.2',
    permissions: ['storage'],
    host_permissions: GOOGLE_HOST_PERMISSIONS,
    action: {
      default_title: '__MSG_extName__',
    },
  },
})
