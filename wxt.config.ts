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
  manifest: ({ manifestVersion }) => ({
    // 名稱與描述走 _locales/{zh_TW,en}/messages.json，
    // CWS 與 chrome://extensions 會依使用者語系顯示對應翻譯
    default_locale: 'zh_TW',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    version: '1.1.0',
    permissions: ['storage'],
    host_permissions: GOOGLE_HOST_PERMISSIONS,
    action: {
      default_title: '__MSG_extName__',
    },
    // `commands` 是 manifest 欄位、不是 permission —— 加了不會觸發既有使用者
    // 重新授權。描述走 _locales，chrome://extensions/shortcuts 會顯示對應語系。
    commands: {
      // 「開啟 popup」是瀏覽器內建的保留命令，不需要任何 background 程式碼，
      // 但**兩個 manifest 版本的保留名稱不一樣**：MV3 是 `_execute_action`，
      // MV2（Firefox 目標）是 `_execute_browser_action`。
      //
      // WXT 會自動把 `action` 轉成 MV2 的 `browser_action`，但不會改 commands
      // 的鍵名 —— 寫死 `_execute_action` 的話，Firefox 會把它當成一個沒有
      // description 的自訂命令：按下去只會觸發 commands.onCommand（background
      // 不認得就忽略），popup 永遠不會開，而且 AMO 的 linter 也會抱怨。
      [manifestVersion === 3 ? '_execute_action' : '_execute_browser_action']: {
        suggested_key: { default: 'Alt+Shift+B' },
      },
      // 真正會天天按的那一個：在被遮住的搜尋頁上切換「本頁顯示 / 復原」
      'toggle-reveal': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: '__MSG_cmdToggleReveal__',
      },
    },
  }),
})
