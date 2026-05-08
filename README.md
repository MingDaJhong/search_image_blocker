# Search Image Blocker

依關鍵字隱藏 Google 搜尋頁的圖片橫幅、影片卡片等視覺干擾的 Chrome Extension。

技術棧：**WXT + Vue 3 + TypeScript + TailwindCSS**

## 快速開始

```bash
# 安裝依賴（推薦使用 pnpm，npm / yarn 也可以）
pnpm install

# 開發模式（會自動開啟 Chrome 並載入 extension）
pnpm dev

# 建置正式版
pnpm build

# 打包成 zip 準備上架
pnpm zip
```

## 專案結構

```
.
├── entrypoints/
│   ├── content/           # Content script（注入 google.com）
│   │   └── index.ts       # CSS 隱藏 + autocomplete MutationObserver
│   └── popup/             # 點擊圖示彈出的設定頁
│       ├── App.vue            # 主畫面（Vue 3 + Tailwind）
│       ├── CategoryDetail.vue # 分類詳情頁（編輯標題、管理關鍵字、刪除）
│       ├── i18n.ts            # 多語系 messages
│       ├── main.ts            # 首次渲染前同步套用 dark class（防閃爍）
│       ├── style.css
│       └── index.html
├── composables/
│   └── useBlockList.ts    # 共用邏輯：設定型別、chrome.storage I/O、shouldBlock
├── public/icon/           # Extension 圖示（16/32/48/96/128 px + SVG）
├── wxt.config.ts          # WXT 設定檔（manifest 在這）
├── tailwind.config.js
└── postcss.config.js
```

## 開發 / 測試

1. 跑 `pnpm dev`，WXT 會自動開啟 Chrome 並載入 extension
2. 在 Chrome 開 [google.com/search?q=昆蟲](https://www.google.com/search?q=昆蟲) 測試
3. 點擊瀏覽器右上角 extension 圖示開啟 popup 設定關鍵字
4. 修改後重新整理搜尋頁即可看到效果

## 功能說明

- **總開關（暫停）**：popup 右上選單可一鍵暫停／繼續，content script 真正卸載 CSS 與 observer，不留任何殘餘成本
- **設定即時生效**：修改任何選項立刻反映在現有頁面，無需重新整理
- **全域阻擋**：不論搜尋什麼都隱藏圖片
- **區塊類型**：勾選要隱藏的區塊（圖片橫幅、搜尋結果縮圖、影片、搜尋建議縮圖、相關問題、知識面板）
- **觸發分類**：內建 3 個策展關鍵字包預設啟用（昆蟲、爬蟲、寄生蟲），勾選即用；支援拖曳排序
- **預設範本**：「血腥／暴力」與「醫療／傷口」改為使用者主動加入的 `+ 範本` chips，避免首次安裝就 ship 敏感關鍵字列表
- **自訂分類**：可新增、重新命名、刪除分類，並在詳情頁管理該分類的關鍵字
- **自訂關鍵字**：全域自訂關鍵字，搜尋字串 substring 比對
- **阻擋狀態顯示**：popup 偵測目前 active tab 的搜尋字串，顯示觸發了哪個關鍵字 / 分類
- **autocomplete 智慧處理**：搜尋建議下拉用 MutationObserver 逐 option 評估，不會把無關的 suggestion 縮圖一起擋掉；右側知識預覽則用搜尋框輸入字 + 任一 option 命中當訊號
- **多語系**：popup 支援繁體中文 / English 切換（首次安裝跟 `navigator.language`）
- **深色模式**：popup 支援淺色 / 深色切換（首次安裝跟系統偏好，防閃爍）
- **設定同步**：使用 `chrome.storage.sync`，跨裝置自動同步
- **匯入 / 匯出設定**：popup 選單提供 JSON 下載 / 上傳，方便備份與跨機遷移
- **儲存配額顯示**：footer 即時顯示已使用 KB / 100KB 進度條，70% 轉黃、90% 轉紅
- **輸入驗證**：新增關鍵字 / 分類時，空白與重複會即時 inline 提示，2.5 秒後自動消失

## 上架前完善計畫

依優先級排列，可逐條勾選實作。

### P0 — 上架前必做

- [x] **修改設定即時生效**：content script 透過單一 `applyState()` 處理 boot 與 `browser.storage.onChanged`，動態更新 `sib-block-style` 並重新 attach / disconnect autocomplete observer；footer 不再有「需要重新整理」提示
- [x] **總開關 / 暫停按鈕**：`BlocklistSettings.paused`，paused 時 `applyState` 早退、移除所有 CSS、disconnect observer、清掉 inline `visibility:hidden`。Popup header 選單有 toggle + 暫停 banner
- [x] **拆分圖片相關 selector**：`blockTypes.images`（圖片橫幅）與 `blockTypes.thumbnails`（搜尋結果縮圖）已拆成兩個獨立選項
- [x] **預設分類審查風險**：採第三選項「從程式碼移除改成『+ 範本』按鈕」— `gore`、`medical` 移到 `PRESET_TEMPLATES`，不再 auto-seed，使用者於 popup 主動加入
- [x] **隱私權政策頁面**：`entrypoints/privacy/index.html` 已建立並由 popup footer 連結
- [ ] **隱私權政策外部 URL**：把 `entrypoints/privacy/index.html` 內容也部署到 GitHub Pages，給 Chrome Web Store listing 填外部 URL 用
- [ ] 至少一張螢幕截圖（1280x800 或 640x400）
- [ ] Chrome Web Store listing：詳細描述、簡短描述、分類
- [ ] 註冊 Chrome Web Store Developer 帳號（一次性 $5 USD）

### P1 — 強烈建議

- [x] **匯入 / 匯出設定**：popup 選單下載 `sib-settings-YYYY-MM-DD.json`，上傳時走 `parseImport()` 做 schema 正規化，成功 / 失敗都有 banner 回饋
- [x] **儲存配額用量顯示**：`chrome.storage.sync.getBytesInUse()` 在 popup footer 顯示 `X.X / 100 KB` 進度條，70% 轉黃、90% 轉紅
- [ ] **關鍵字 enable / disable**：把 `keywords: string[]` 升級為 `{ text: string, enabled: boolean }[]`，搭配 `loadSettings` 的 normalize 做舊資料遷移。**這項基本取代了 regex 的需求** — 大部分使用者真正要的不是 regex，而是「我這個關鍵字暫時不想生效」
- [x] **輸入驗證 + 重複回饋**：`addKeyword` / `addCatKeyword` 回傳 `'added' | 'duplicate' | 'empty'`，UI 收到非 `'added'` 時 input 邊框轉紅並顯示對應提示文案，2.5 秒後自動消失
- [x] **autocomplete observer 效能**：`requestAnimationFrame` debounce 合併同 frame mutation；listbox 不存在時提早返回；觀察根縮小到搜尋框 `<form>`
- [ ] **「還原預設分類」按鈕**：`DEFAULT_CATEGORIES` 已在程式碼中，使用者誤刪後給一鍵恢復入口

### P2 — Nice to have

- [ ] **搜尋頁阻擋回饋**：`browser.action.setBadgeText` 顯示阻擋數量，或頁面角落 toast「已隱藏 X 個區塊」（可關），同時方便除錯 selector 失效
- [ ] **「精確匹配」開關**：每個關鍵字一個 ☑ 精確匹配選項，解決「蛇」誤命「蛇皮包」「蛇麼」，比 regex 友善
- [x] **i18n 拆檔**：`messages` 已抽到 `entrypoints/popup/i18n.ts`，`Messages` 型別由 `(typeof messages)[Locale]` 推出，App.vue 不再內嵌字串表
- [ ] **純函式測試**：vitest 加 `shouldBlock` / `findBlockMatch` / `normalizeCategoryOrder` / `readLegacyOverrides` 的回歸測試
- [ ] **鍵盤快捷鍵**：用 manifest `commands` 欄位允許快速開啟 popup
- [ ] **三態主題**（auto / light / dark）— 目前只有 binary
- [x] **autocomplete observer 範圍**：已縮小到搜尋框 `<form>`（找不到才退回 `documentElement`），減少 DOM 監聽成本

### 安全性檢查

- [x] Vue text interpolation `{{ }}` 自動 escape，沒有 `v-html` 使用
- [x] 權限最小化：只有 `storage` + 限定 `google.com` / `google.com.tw` host
- [x] `loadSettings` 有逐欄位 type guard，stored 內容 prototype pollution 不會穿過
- [x] CSS selector 全為 hardcoded，沒有來自使用者輸入的字串
- [x] 沒有使用 regex，無 ReDoS 風險
- [x] 完整 icon（16/32/48/96/128 px）
- [ ] 使用者輸入長度上限（同 P1「輸入驗證」項）
- [ ] 確認 `wxt zip` 產出不含 `.DS_Store` 或系統垃圾檔（`.gitignore` 有，但 build flow 不一定會自動過濾）

## Known issues / 長期維護

- Google CSS 選擇器會隨 Google DOM 改版而失效，需持續觀察並更新 `entrypoints/content/index.ts` 中的 selector
- content script 內無使用者可見字串，i18n 暫不需要；若未來加 toast / banner 再加
- 切換 popup 語言時，內建分類的 label / keywords 不會跟著切換（首次安裝就 seed 為單一 locale 的 string）— 這是儲存設計選擇，不是 bug
