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

# Selector 週檢（每週手動跑，開真 Chrome 打 Google，比對命中數基準線）
pnpm canary          # 唯讀：印報告，真的失效就 exit 1
pnpm canary:update   # 看過報告確認正常後，把這次觀測併進基準線
```

`pnpm canary` **不在 `pnpm test` 裡，也永遠不要放進 CI** —— 見下方「Selector 週檢」。

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
│   │   ├── blockCount.ts  # 讓提示的數字跟得上「捲到才載」的縮圖（MutationObserver + debounce）
│   │   ├── messages.ts    # content script 專用文案（不共用 popup 的 i18n，避免打包整包）
│   │   └── *.test.ts      # selectors / hideStyle / clickReveal / softNav / indicator / resultScanner / blockCount
│   ├── options/           # 獨立設定頁：掛同一個 App.vue，只是 wide=true
│   │   ├── index.html     # meta manifest.open_in_tab → 開在自己的分頁而不是 iframe
│   │   └── main.ts
│   └── popup/             # 點擊圖示彈出的設定頁
│       ├── App.vue            # 主畫面（Vue 3 + Tailwind），popup 與設定頁共用
│       ├── CategoryDetail.vue # 分類詳情頁（編輯標題、管理關鍵字、刪除）
│       ├── KeywordSection.vue # 共用的「標題 + 輸入框 + chip 清單」（3 個呼叫點，可選篩選 / 批次貼上）
│       ├── i18n.ts            # 多語系 messages
│       ├── main.ts            # 首次渲染前同步套用 dark class（防閃爍）
│       ├── style.css          # 360px 掛在 html.sib-popup + body 上（Chrome 量的是 documentElement），設定頁不掛所以不受影響
│       └── index.html
├── composables/
│   ├── blockList.ts       # 純資料層（無 Vue）：型別、storage I/O、matchKeyword / shouldBlock — content + popup 都用
│   ├── blockList.test.ts  # 比對邏輯回歸測試（用真實內建關鍵字清單跑）
│   ├── diagnostics.ts     # 訊息契約 + summarizeDiagnosis（零 import，四個 surface 共用）
│   ├── googleTlds.ts      # 支援網域的單一來源（零 import，Node / popup / 測試共用）
│   ├── googleTlds.test.ts # isGoogleSearchUrl + content script matches 一致性
│   ├── repoConsistency.test.ts # 版本號 / privacy.html 副本 / i18n 鍵的漂移守門
│   └── useBlockList.ts    # popup-only：Vue composable + mutators + parseImport / mergeSettings + PRESET_TEMPLATES
├── canary/                # Selector 週檢：開真 Chrome 走 6 個 Google 頁面，逐格比對命中數
│   ├── pages.ts           # 頁面矩陣（純資料）：每條還活著的 selector 至少被一頁涵蓋
│   ├── report.ts          # 判定與報表（純函式，由 pnpm test 一起守住）
│   ├── report.test.ts
│   ├── probe.ts           # 序列化後丟進頁面執行的計數函式（不能引用外部變數）
│   ├── run.canary.ts      # Playwright 驅動（由 vitest.canary.config.ts 執行）
│   ├── baseline.json      # 觀測史 { max, seen, runs }，不是「上次幾個」
│   └── README.md          # 操作手冊：報告怎麼讀、六種狀態、出現紅燈的修復流程
├── public/icon/           # Extension 圖示 PNG（16/32/48/96/128 px，會被打包進 .crx）
├── assets/icons-source/   # SVG 來源 + build.py（不在版控、不打包；本機備份保留）
├── wxt.config.ts          # WXT 設定檔（manifest 在這）
├── vitest.config.ts       # 測試設定（WxtVitest 提供 @/ alias 與 browser mock）
├── vitest.canary.config.ts # 週檢專用（headed、逾時放寬、不攔 console —— 報告就是它的產出）
├── tailwind.config.js
└── postcss.config.js
```

## 開發 / 測試

1. 跑 `pnpm dev`，WXT 會自動開啟 Chrome 並載入 extension
2. 在 Chrome 開 [google.com/search?q=昆蟲](https://www.google.com/search?q=昆蟲) 測試
3. 點擊瀏覽器右上角 extension 圖示開啟 popup 設定關鍵字
4. 改任何設定都會立刻反映在已開啟的搜尋頁，不需要重新整理

發布前的走查結果與剩下的項目見下方「1.1.0 發布前檢查」。

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
- **頁面提示**：搜尋頁左下角顯示「已隱藏 N 個區塊 · 關鍵字「蛇」」，一鍵「顯示」可在本頁放開圖片（只影響這次載入、不改設定、不寫任何儲存，重新整理即恢復）。若阻擋啟用卻數到 0 個區塊，提示會直接說「沒有找到可隱藏的區塊」—— 在沒有任何遙測的前提下，這是使用者能發現 Google 改版的唯一管道。數字會跟著捲動補上來的縮圖一起更新（Google 的縮圖是捲到才載，原本用兩個固定時間點補數，兩次都發生在使用者開始捲之前）。可於 popup 關閉
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

## 1.1.0 發布前檢查

2026-08-21 用 production build（`.output/chrome-mv3`，載入未封裝項目）在真實 Google 上走過一輪。

已驗過：

- [x] **軟導航（A6）** —— `pushState` 換掉 `q` 之後 1.6 秒內，29 條頁面規則整批移除；換回命中的字又重新注入。這支模組不是多的
- [x] **逐筆結果比對** —— 搜「台北天氣」（query 完全不命中、頁面 CSS 沒作用），掃描器仍以 inline `display:none !important` 擋掉 28 張圖，抓到的 alt 全是蜘蛛相關。`MAX_CONTEXT_CHARS` / `MAX_WALK_UP` 沒有過度隱藏也沒有失效
- [x] **點擊揭露不會誤攔 Google 的點擊** —— 風險最高的那一項。在圖片分頁點一個包在連結裡、祖先有 `jsaction` 的圖磚：只有它解除、其他 205 張仍遮著、網址沒變、**Google 的側邊預覽面板沒被打開**（第一次點擊確實被吞掉）
- [x] **圖片分頁（`udm=2`）的覆蓋** —— 206 張圖 100% 命中；影片分頁 23 張同樣 100%
- [x] **blur / mask 的實際觀感** —— blur 量到 `blur(32px) contrast(0.25) brightness(1.2)` 加 `clip-path: inset(0px)` 確實生效，沒有糊到隔壁標題；mask 目視確認
- [x] **popup 三個分頁與狀態卡** —— 順帶抓到並修掉兩個寬度 bug（見下）

還沒做完：

- [ ] 更新 Chrome Web Store listing 的截圖與版本說明（1.1.0 的畫面與 1.0.2 差很多）
- [ ] **`<video>` 在三種模式下一律 `display: none`** —— 走過的頁面上根本沒有 `<video>` 元素（週檢基準線也顯示這組 selector 從未命中過），所以那條規則到今天仍是純防禦性程式碼
- [ ] **popup 的「檢查是否失效」按鈕、獨立設定頁的實際互動** —— 只在本機用 stub 量過設定頁版面（1280 px、內容 1024 px），沒有真的操作過
- [ ] **提示計數跟上 lazy-load 的修正**（`blockCount.ts`）有單元測試，但還沒在真實 Google 上實測
- [ ] Firefox 只驗到能 build，沒有實際載入過

### 那兩個寬度 bug

兩個都是 1.1.0 自己引入的，症狀一樣（popup 右邊多一塊空白），成因不同：

1. `7371414` 為了不讓新的獨立設定頁被夾成 360 px，把 `html, body { width: 360px }` 改成只有 `body.sib-popup` —— 但 **Chrome 決定 popup 開多寬時量的是 `documentElement`**，於是 html 撐到 popup 的 800 px 上限
2. 夾住 html 之後還多 17 px，那是捲軸：popup 高度上限 600 px，內容一超過就捲，而**根元素的 overflow 會往上傳播成 viewport 捲軸**。在 html 上設一個非 visible 的 overflow 才能切斷傳播，讓 body 自己消化

`repoConsistency.test.ts` 有三條測試釘住這兩件事，以及「設定頁不能掛上那個 class」。

## Selector 週檢（`canary/`）

`selectors.ts` 是整個專案唯一會因為**別人改東西**而壞掉的檔案，而這個產品沒有遙測 ——
Google 改了 DOM 沒有任何自動訊號。`canary/` 就是那個訊號：每週手動跑一次，開真的
Chrome 走過 6 個 Google 頁面，逐條數 selector 命中數，和 `canary/baseline.json` 比對。

```bash
pnpm canary          # 1. 看報告
# 2. 沒有 🔴 →
pnpm canary:update   # 3. 告訴它「這次正常」
```

一次約 40 秒。詳細操作、報告怎麼讀、出現紅燈的修復流程見 `canary/README.md`。

幾個不明顯但 load-bearing 的設計：

- **為什麼要真瀏覽器**：排除清單建立在 `:not(:is(cite img, …))` 上，happy-dom 不支援
  後代組合子而且是靜默失敗。任何在 happy-dom 裡做的命中數斷言測到的是 happy-dom，
  不是這個產品
- **為什麼不能上 CI**：GitHub Actions 是資料中心 IP，Google 幾乎必定回驗證碼。搬上 CI
  不會得到自動化報告，只會得到一份每週都是 ⏭ 略過的報告
- **為什麼比基準線而不是 `expect(count > 0)`**：首次盤點顯示 33 條裡有 23 條在 6 個真實
  頁面上一次都沒命中過。硬門檻會讓每次執行都亮 23 個紅燈，兩週後就沒人看了。真正有
  訊息量的是**變化**
- **為什麼「歸零」本身還不足以判定失效**：Google 不保證同一個查詢每次都顯示同一組模組，
  知識面板的影片區、圖片輪播隔十五分鐘就會不一樣。所以基準線每一格記的是**觀測史**
  `{ max, seen, runs }`，夠可信的一格歸零才報紅燈，否則只報 🟠
- **只有 `canary:update` 會累積觀測史**。如果每次執行都自動累積，一個真的壞掉的 selector
  會因為連續幾週都是 0 而讓穩定度一路降到門檻以下，然後自己變成 `dead` 不再報警 ——
  那正是「靜默把機制關掉」的失敗模式

第一次跑就抓到一條：`div[jsname="tX7jT"]`（影片卡容器）從 3/3 命中掉到 0。另開真頁面
查證 `q=貓`：那個容器一個都不存在，但同一頁的影片區塊還在，且已被 `[jscontroller="rTuANe"]`
與 `div[data-attrid*="Video"]` 接住 —— Google 換掉的是容器名，被擋的東西沒變少。已移除該條。

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

- Google CSS 選擇器會隨 Google DOM 改版而失效，需持續觀察並更新 `entrypoints/content/selectors.ts` 中的 selector。**部分失效**（一條死掉、其他還活著）現在由 `pnpm canary` 逐格比對涵蓋 —— 但那是每週手動跑的，真的壞掉到你發現之間仍有最多一週的空窗
- **週檢只涵蓋 `DEFAULT_SETTINGS.blockTypes`（33 條）**。`relatedQuestions` / `knowledgePanel` 那 7 條預設關閉、沒有基準線，壞了不會有人知道
- **`<video>` 那條規則沒有任何實測**。三種模式下一律 `display: none` 的邏輯有單元測試，但真實頁面上從來沒出現過 `<video>` 元素（週檢基準線也是 0 命中），所以它到今天仍是純防禦性程式碼
- `blur` / `mask` 下圖片仍然會下載 —— 那是「保留版面」的必然代價，popup 的說明有講明
- content script 內無使用者可見字串，i18n 暫不需要；若未來加 toast / banner 再加
- 切換 popup 語言時，內建分類的 label / keywords 不會跟著切換（首次安裝就 seed 為單一 locale 的 string）— 這是儲存設計選擇，不是 bug
