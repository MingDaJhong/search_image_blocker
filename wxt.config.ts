import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Search Image Blocker',
    description: '依關鍵字隱藏 Google 搜尋頁的圖片、影片區塊',
    version: '0.0.1',
    permissions: ['storage'],
    host_permissions: ['https://www.google.com/*', 'https://www.google.com.tw/*'],
    action: {
      default_title: 'Search Image Blocker',
    },
  },
})
