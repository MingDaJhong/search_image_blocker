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

# 正確性關卡（兩個都要過）
pnpm compile      # 型別檢查
pnpm test         # 純函式回歸測試
pnpm test:watch   # 開發時 watch 模式

# 更新隱私權政策後同步根目錄那份（GitHub Pages 服務的來源）
pnpm sync:privacy
```

## 專案結構

```
.
├── entrypoints/
│   ├── background.ts      # 只做一件事：把鍵盤快捷鍵轉給 content script
│   ├── content/           # Content script（注入 16 個 Google TLDs）
│   │   ├── index.ts       # 生命週期：開場遮蔽 + applyState + autocomplete MutationObserver + 訊息處理
│   │   ├── selectors.ts   # 所有 Google DOM selector（純函式、零 runtime import）
│   │   ├── hideStyle.ts   # 遮蔽方式（hide / blur / mask）的單一來源，CSS 與 inline 都由它長出來
│   │   ├── clickReveal.ts # 點一下顯示這一個（只有 blur / mask 有）
│   │   ├── softNav.ts     # 軟導航後追蹤 q 的變化（切 udm 分頁 / 篩選 chip）
│   │   ├── indicator.ts   # 頁面左下角封鎖提示（closed shadow DOM）
│   │   ├── resultScanner.ts  # 逐筆結果比對（不依賴任何 Google 屬性）
│   │   ├── messages.ts    # content script 專用文案（不共用 popup 的 i18n，避免打包整包）
│   │   └── *.test.ts      # selectors / hideStyle / clickReveal / softNav / indicator / resultScanner
│   ├── options/           # 獨立設定頁：掛同一個 App.vue，只是 wide=true
│   │   ├── index.html     # meta manifest.open_in_tab → 開在自己的分頁而不是 iframe
│   │   └── main.ts
│   └── popup/             # 點擊圖示彈出的設定頁
│       ├── App.vue            # 主畫面（Vue 3 + Tailwind），popup 與設定頁共用
│       ├── CategoryDetail.vue # 分類詳情頁（編輯標題、管理關鍵字、刪除）
│       ├── KeywordSection.vue # 共用的「標題 + 輸入框 + chip 清單」（3 個呼叫點，可選篩選 / 批次貼上）
│       ├── i18n.ts            # 多語系 messages
│       ├── main.ts            # 首次渲染前同步套用 dark class（防閃爍）
│       ├── style.css          # 360px 掛在 body.sib-popup 上，設定頁才不會被夾住
│       └── index.html
├── composables/
│   ├── blockList.ts       # 純資料層（無 Vue）：型別、storage I/O、matchKeyword / shouldBlock — content + popup 都用
│   ├── blockList.test.ts  # 比對邏輯回歸測試（用真實內建關鍵字清單跑）
│   ├── diagnostics.ts     # 訊息契約 + summarizeDiagnosis（零 import，四個 surface 共用）
│   ├── googleTlds.ts      # 支援網域的單一來源（零 import，Node / popup / 測試共用）
│   ├── googleTlds.test.ts # isGoogleSearchUrl + content script matches 一致性
│   ├── repoConsistency.test.ts # 版本號 / privacy.html 副本 / i18n 鍵的漂移守門
│   └── useBlockList.ts    # popup-only：Vue composable + mutators + parseImport / mergeSettings + PRESET_TEMPLATES
├── public/icon/           # Extension 圖示 PNG（16/32/48/96/128 px，會被打包進 .crx）
├── assets/icons-source/   # SVG 來源 + build.py（不在版控、不打包；本機備份保留）
├── wxt.config.ts          # WXT 設定檔（manifest 在這）
├── vitest.config.ts       # 測試設定（WxtVitest 提供 @/ alias 與 browser mock）
├── tailwind.config.js
└── postcss.config.js
```

## 開發 / 測試

1. 跑 `pnpm dev`，WXT 會自動開啟 Chrome 並載入 extension
2. 在 Chrome 開 [google.com/search?q=昆蟲](https://www.google.com/search?q=昆蟲) 測試
3. 點擊瀏覽器右上角 extension 圖示開啟 popup 設定關鍵字
4. 改任何設定都會立刻反映在已開啟的搜尋頁，不需要重新整理

發布前的完整走查路徑見下方「1.1.0 發布前必做」。

## 功能說明

- **總開關（暫停）**：popup 右上選單可一鍵暫停／繼續，content script 真正卸載 CSS 與 observer，不留任何殘餘成本
- **設定即時生效**：修改任何選項立刻反映在現有頁面，無需重新整理
- **全域阻擋**：不論搜尋什麼都隱藏圖片
- **區塊類型**：勾選要隱藏的區塊，分兩組 —— 「圖片與影片」（搜尋結果縮圖、搜尋建議縮圖、圖片分頁篩選列縮圖、圖片輪播／橫幅、影片卡片，預設全開）與「整塊區域」（相關問題、知識面板，會連文字一起隱藏，預設全關）
- **觸發分類**：內建 3 個策展關鍵字包預設啟用（昆蟲、爬蟲、寄生蟲），勾選即用；支援拖曳排序
- **預設範本**：「血腥／暴力」與「醫療／傷口」改為使用者主動加入的 `+ 範本` chips，避免首次安裝就 ship 敏感關鍵字列表
- **自訂分類**：可新增、重新命名、刪除分類，並在詳情頁管理該分類的關鍵字
- **自訂關鍵字**：全域自訂關鍵字
- **文字系統感知的比對**：拉丁／西里爾／希臘字母關鍵字走「詞邊界 + 簡單複數」比對，中日韓等無詞邊界的語言維持 substring。避免 `moth` 誤中 `mother's day`、`boa` 誤中 `keyboard`、`rash` 誤中 `car crash` 這類讓整頁圖片無故消失的誤判
- **例外關鍵字**：命中就一律放行，優先於自訂關鍵字與分類。首次安裝依語系帶入一份策展清單（zh-TW 26 條、en 31 條），解掉中文沒有詞邊界、比對層改不掉的誤判 —— `蟬聯冠軍`、`蛇年運勢`、`螞蟻上樹`、`鱷魚牌`、`蜘蛛人`、`癌症險` 等不再被誤擋。優先序為 `暫停 > 全域阻擋 > 例外 > 關鍵字／分類`（全域阻擋刻意排在例外之上，它是不該有洞的核彈按鈕）
- **autocomplete 智慧處理**：搜尋建議下拉用 MutationObserver 逐 option 評估，不會把無關的 suggestion 縮圖一起擋掉；右側知識預覽則用搜尋框輸入字 + 任一 option 命中當訊號
- **多語系**：popup 支援繁體中文 / English 切換（首次安裝跟 `navigator.language`）
- **深色模式**：popup 支援淺色 / 深色切換（首次安裝跟系統偏好，防閃爍）
- **設定同步**：使用 `chrome.storage.sync`，跨裝置自動同步
- **匯入 / 匯出設定**：popup 選單提供 JSON 下載 / 上傳，方便備份與跨機遷移；匯入時可選「合併」（把對方的關鍵字 / 分類加進來，保留個人 UI 偏好）或「取代」（清除目前所有設定再套用），避免誤點丟失自訂內容
- **儲存配額顯示**：在「關鍵字」分頁最下方顯示已使用 KB / 100KB 進度條，70% 轉黃、90% 轉紅（它量的就是那幾份關鍵字清單，放在旁邊才有意義）
- **輸入驗證**：新增關鍵字 / 分類時，空白、重複、過長（關鍵字 50 字、分類名稱 30 字）會即時 inline 提示，2.5 秒後自動消失；輸入框同步綁 `maxlength` 從 DOM 層擋住 paste / IME 過長字串
- **逐筆結果比對**：搜尋字沒命中任何關鍵字時，改逐筆判斷每一張圖，只隱藏命中那一張。補的是 query 層級阻擋的盲點 —— 搜「我家牆上這是什麼」時 query 一個關鍵字都不會命中，但結果標題全是「蜘蛛」，那正是最需要保護的時刻。兩個訊號：**圖片自己的 alt / title / aria-label**（含外層連結的），以及**從圖片往上走找到的所屬結果文字**。兩者都**不依賴任何 Google class / jsname**，天生抗 DOM 改版
- **圖片分頁覆蓋**：alt 比對特別重要 —— 圖片分頁（`udm=2`）的圖磚周圍幾乎沒有文字，但 alt 通常是來源頁標題，而那正是這個產品最關鍵的頁面
- **主畫面分三頁**：`方式`（怎麼擋）／`關鍵字`（擋什麼）／`區塊`（擋哪裡）。狀態卡固定在分頁列上方常駐 —— 它是頁面層級的讀數不是設定，三頁都看得到「這一頁怎麼了」，四種狀態：阻擋中 / 已顯示 / 沒被阻擋 / 不在搜尋頁。隱藏數量與命中原因**向 content script 取得**，因為逐筆結果比對是在頁面裡跑的，popup 光看搜尋字算不出來；問不到時只顯示狀態不顯示數字（`0` 的意思是「檢查過、一個都沒擋到」，跟「問不到」不能混為一談）。卡片上的「本頁顯示」與快捷鍵、頁面提示走同一個訊息。隱私權政策常駐於 footer。獨立設定頁不分頁，一次攤開全部（同一份 App.vue，靠 `wide` 切換）
- **頁面提示**：搜尋頁左下角顯示「已隱藏 N 個區塊 · 關鍵字「蛇」」，一鍵「顯示」可在本頁放開圖片（只影響這次載入、不改設定、不寫任何儲存，重新整理即恢復）。若阻擋啟用卻數到 0 個區塊，提示會直接說「沒有找到可隱藏的區塊」—— 在沒有任何遙測的前提下，這是使用者能發現 Google 改版的唯一管道。可於 popup 關閉
- **遮蔽方式（hide / blur / mask）**：`hide` 整塊移除（版面收起、圖片不下載，1.0.x 的行為，也是預設值）；`blur` 保留版面但看不出形狀；`mask` 蓋成純色方塊，連輪廓都不露。blur 與 mask 可以在搜尋頁**點一下被遮住的圖，只顯示那一張**（刻意是點擊而不是 hover —— 對這個族群「滑過去就露出來」比看不到更糟）。`<video>` 在三種模式下一律直接隱藏，否則它會留在版面上、hover 會播、還會出聲
- **鍵盤快捷鍵**：`Alt+Shift+B` 開設定面板、`Alt+Shift+S` 切換本頁顯示 / 復原（可在 `chrome://extensions/shortcuts` 改）。設定頁會列出目前實際的鍵位（讀 `commands.getAll()`，不是寫死 manifest 的建議值）
- **獨立設定頁**：popup 選單「開啟完整設定」。掛的是同一個 `App.vue`，只是把 `wide` 打開 —— 兩欄版面、例外關鍵字直接攤開、關鍵字篩選、批次貼上（換行 / 逗號 / 頓號 / 分號都吃）
- **失效自我診斷**：popup 選單「檢查是否失效」，對搜尋分頁跑一次 selector 命中統計。關鍵是把「這一頁沒事做」和「壞掉」分開 —— 只有在查詢確實命中黑名單、卻一個元素都沒命中時才說是 Google 改版。在完全沒有遙測的前提下，這是使用者能發現並回報的唯一管道
- **軟導航追蹤**：切 udm 分頁或按篩選 chip 時 Google 部分走 pushState，網址的 `q` 換了但 content script 不會重新執行。改成持續追蹤 `q`，變了就重跑判斷（content script 在 isolated world，攔不到頁面自己的 pushState，所以是 `popstate` + 500 ms 字串比較）
- **零閃現開場遮蔽**：`document_start` 就注入「所有可能夾帶圖片的區塊」的 `visibility: hidden`，等設定載入完成再換成正式封鎖 CSS 或整個移除。Google 的 HTML 是串流漸進渲染，設定是非同步讀取，中間那幾毫秒若沒遮住就會閃過圖片 — 對恐懼症產品那就是失效
- **selector 失效隔離**：封鎖 CSS 是「一個 selector 一條 rule」而非逗號併成一條。CSS 規範規定清單裡任一 selector 無效會讓整條 rule 被丟棄，併在一起等於一個 typo 讓阻擋全滅
- **多 TLD 支援**：覆蓋 16 個 Google 地區網域（.com / .com.tw / .com.hk / .co.jp / .co.kr / .com.sg / .co.uk / .com.au / .ca / .co.in / .de / .fr / .es / .it / .com.br / .com.mx）
- **Dev 模式 selector 失效偵測**：`pnpm dev` 模式下 content script 啟動 2 秒後會檢查所有阻擋 selector 是否真的找到元素，全部 0 命中時 `console.warn` 提醒（production build 自動 strip）

## 版本狀態

| | 版本 | 說明 |
| --- | --- | --- |
| 已上架 | `1.0.2` | Chrome Web Store 上目前的版本 |
| 本地 | `1.1.0` | 尚未發布，在 `feat/post-launch-hardening` 分支 |

已完成的功能請看上面的「功能說明」，這裡只記還沒做完、刻意不做、以及發布前一定要做的事。

## 1.1.0 發布前必做

**全部都是「只在合成 DOM 或單機截圖驗過」的東西 —— 這是目前唯一擋在發布前的關卡。**

- [ ] **真實 Google SERP 走一輪**。一條路徑幾乎全覆蓋：
  `pnpm dev` → 搜「蝴蝶」（query 命中）→ 切到圖片分頁（驗軟導航 A6）→ 換成 mask 模式 → 點一張圖（驗點擊揭露）→ 按 `Alt+Shift+S`（驗快捷鍵）→ 搜「像是蛛」（query 不命中但結果命中，驗逐筆比對與 popup／頁面提示的狀態同步）→ 開設定頁 → 按診斷
- [ ] **逐筆比對會不會過度隱藏或完全沒作用**。`MAX_CONTEXT_CHARS`（400）與 `MAX_WALK_UP`（8）是憑合成 DOM 訂的，真實結果容器的文字量可能差很多。兩個都是可調的旋鈕；真的不行也可以把 `perResultBlock` 預設改成關閉（一行）
- [ ] **點擊揭露會不會誤攔 Google 的正常點擊**。用了 `stopImmediatePropagation`，這是風險最高的一項
- [ ] **圖片分頁（`udm=2`）的實際覆蓋**。那是這個產品最關鍵的頁面，而它的容器結構我沒有實測過
- [ ] **blur / mask 的實際觀感**，以及 popup 三個分頁、狀態卡四種狀態的版面
- [ ] 更新 Chrome Web Store listing 的截圖與版本說明（1.1.0 的畫面與 1.0.2 差很多）

## 已評估後決定不做

- **關鍵字逐條 enable / disable**：全域暫停已涵蓋「臨時想搜被擋的詞」；per-keyword toggle 與既有的 add / remove 並存會讓心智模型混亂（同一頁面：分類用 toggle、關鍵字用 toggle 加刪除？）。**例外關鍵字**是更好的方向，已實作 —— 「要擋什麼」和「不要擋什麼」是兩份清單，比每項掛一個三態開關清楚
- **三態主題（auto / light / dark）**：目前是 binary。要做需要一個 `prefers-color-scheme` 監聽器與 `Theme` 的新值，收益相對低
- **本地 AI 影像辨識**：關鍵字永遠擋不到「我家牆上這是什麼」這種查詢，方向是對的，但在 MV3 content script 裡跑模型的成本與 CWS 審查風險不成比例。逐筆結果比對（B3）＋ 圖片說明比對（B4）已經吃掉這個情境的大部分

## 安全性檢查

- [x] Vue text interpolation `{{ }}` 自動 escape，沒有 `v-html` 使用
- [x] **權限最小化**：`permissions` 只有 `storage`；`host_permissions` 限定 16 個 Google 網域。1.1.0 新增的 `commands` / `background` / `options_ui` **都不是 permission**，既有使用者不會被要求重新授權
- [x] **沒有 `web_accessible_resources`**：頁面提示的圖示走 Vite 內嵌 data URI 而不是 `runtime.getURL()`，後者需要把檔案列進 `web_accessible_resources`，等於讓 google.com 可以探測這個擴充功能是否安裝
- [x] `loadSettings` 有逐欄位 type guard，stored 內容 prototype pollution 不會穿過
- [x] CSS selector 全為 hardcoded，沒有來自使用者輸入的字串；`selectors.test.ts` 讓真正的 CSS 引擎解析每一個，語法錯誤會紅
- [x] **無 ReDoS 風險**：`matchKeyword` 用的三個 regex（`WORD_DELIMITED` / `WORD_CHAR` / `PLURAL_SUFFIX`）都是模組層級常數、沒有巢狀量詞，且**不由使用者輸入組成** —— 關鍵字比對走 `indexOf` 加前後字元檢查
- [x] **頁面提示用 closed shadow root**：提示上會顯示使用者的關鍵字（黑名單資料），closed 讓 Google 自己的 script 讀不到
- [x] **「本頁顯示」不持久化**：只活在 content script 這次載入的記憶體裡，不寫任何儲存，所以沒有隱私成本
- [x] 完整 icon（16/32/48/96/128 px）
- [x] 使用者輸入長度上限：`MAX_KEYWORD_LEN = 50` / `MAX_LABEL_LEN = 30`，input 端 `maxlength` 加 composable 端 `'too_long'` 雙層擋；`isValidKeyword` 在每個儲存邊界過濾空字串與過長字串，防損毀的 storage 或惡意匯入檔
- [x] 確認 `wxt zip` 產出不含 `.DS_Store` 或系統垃圾檔：WXT build flow 自動過濾，已用 `unzip -l | grep DS_Store` 驗證

## Known issues / 長期維護

- **點擊揭露沒有鍵盤路徑**：blur / mask 模式下，「點一下顯示這一張」只綁滑鼠點擊。被遮的 `<img>` 本身不可聚焦，要讓它可聚焦就得在 Google 的搜尋結果裡插入額外 tab stop，那對所有鍵盤使用者都是成本。目前的替代路徑是快捷鍵 `Alt+Shift+S`（放開整頁）與頁面提示上的「顯示」按鈕 —— 不是死路，但單張揭露確實只有滑鼠能做

- Google CSS 選擇器會隨 Google DOM 改版而失效，需持續觀察並更新 `entrypoints/content/selectors.ts` 中的 selector
- **`blur` / `mask` 只在合成 fixture 上用真實 CSS 引擎驗過，沒有對真實 Google SERP 跑過**。視覺主張成立（去背 PNG 不留剪影、模糊不溢出），但在實際結果頁上的觀感、以及點擊揭露會不會被 Google 的 `jsaction` 干擾，仍未驗證。`hideStyle.ts` 裡三個常數都是可調的旋鈕
- **A6 的軟導航也還沒對真實 Google 驗過**：udm 分頁 / 篩選 chip 是否真的走 pushState 依 Google 版本而異。500 ms 輪詢讓兩種情況都正確，但若軟導航根本不發生，這支模組就是多的
- `blur` / `mask` 下圖片仍然會下載 —— 那是「保留版面」的必然代價，popup 的說明有講明
- content script 內無使用者可見字串，i18n 暫不需要；若未來加 toast / banner 再加
- 切換 popup 語言時，內建分類的 label / keywords 不會跟著切換（首次安裝就 seed 為單一 locale 的 string）— 這是儲存設計選擇，不是 bug
