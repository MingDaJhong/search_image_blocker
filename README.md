# Search Image Blocker

依關鍵字隱藏 Google 搜尋頁的圖片橫幅、影片卡片等視覺干擾的 Chrome Extension。

技術棧：**WXT + Vue3 + TypeScript + TailwindCSS**

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
│   │   └── index.ts       # 核心隱藏邏輯
│   └── popup/             # 點擊圖示彈出的設定頁
│       ├── App.vue        # 主 UI（Vue3 + Tailwind）
│       ├── main.ts
│       ├── style.css
│       └── index.html
├── composables/
│   └── useBlocklist.ts    # 共用的 chrome.storage 邏輯
├── public/icon/           # 圖示（待補：16/32/48/96/128 px）
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

- **全域阻擋**：不論搜尋什麼都隱藏圖片
- **區塊類型**：勾選要隱藏的區塊（圖片、影片、相關問題、知識面板）
- **觸發關鍵字**：搜尋字串包含其中任一關鍵字即觸發隱藏
- **設定同步**：使用 `chrome.storage.sync`，跨裝置自動同步

## TODO

- [ ] 補上 icon（16/32/48/96/128 px）放到 `public/icon/`
- [ ] Google CSS 選擇器需要長期維護（Google 會定期更新 DOM 結構）
- [ ] 加入「分類預設關鍵字包」（昆蟲、血腥、醫療等）
- [ ] 加入正則表達式支援
- [ ] i18n 多語系
- [ ] 上架 Chrome Web Store

## 上架前檢查清單

- [ ] 完整 icon（128x128 必備）
- [ ] 至少一張螢幕截圖（1280x800 或 640x400）
- [ ] 隱私權政策頁面（即使沒蒐集資料也建議寫一份）
- [ ] 詳細描述、簡短描述、分類設定
- [ ] 註冊 Chrome Web Store Developer 帳號（一次性 $5 USD）
