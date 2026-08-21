# canary — Google DOM 週檢操作手冊

## 這在解決什麼問題

這個擴充功能靠一份 **CSS selector 清單**（`entrypoints/content/selectors.ts`）
找出 Google 搜尋頁裡的圖片，再把它們遮起來。那份清單寫的是 Google 的 HTML 長相：

```
#search img            ← 「搜尋結果區裡的所有圖片」
[jscontroller="rTuANe"] img   ← 「影片卡裡的圖片」
```

問題是：**Google 會不定期改自己的 HTML，而且不會通知任何人。**
改到的話，我們的 selector 就 match 不到任何東西 → 圖片不再被遮 →
使用者只會覺得「這個擴充功能壞了」然後移除。

這個產品沒有遙測（那是它的隱私主張，不打算改），所以**沒有任何自動訊號**
會告訴你這件事發生了。canary 就是那個訊號。

它做的事很單純：開一個真的 Chrome，走過 6 個 Google 頁面，
**數每一條 selector 還能 match 到幾個元素**，然後跟上次的紀錄比。

> 不需要先跑 `pnpm dev`，canary **刻意不載入擴充功能**。
> 它問的是「Google 的 HTML 裡還有沒有這些元素」——
> 那是 Google 頁面的性質，跟我們的擴充功能有沒有裝完全無關。
> （而且被 `display:none` 遮住的元素仍然留在 DOM 裡，數字根本不會變。）

---

## 兩個指令

| 指令 | 做什麼 | 會改檔案嗎 |
| --- | --- | --- |
| `pnpm canary` | **檢查**。跑完印一份報告；發現真的失效就 exit 1 | ❌ 唯讀 |
| `pnpm canary:update` | 檢查 **＋ 把這次的觀測記進 `baseline.json`** | ✅ 會寫 |

`canary:update` 的語意是：**「我看過報告了，這次的結果是正常的。」**

它不是「清掉紅燈」的按鈕，是「幫我把這次的觀測算進歷史紀錄」。
所以：

- 報告全綠 → 跑 `canary:update`（累積證據，判定會愈來愈準）
- 只有 🟠 / 🟡 而你確認 Google 只是這次沒顯示那個區塊 → 跑 `canary:update`
- 出現 🔴 → **先去修 selector，不要 update**。update 只會把壞掉的狀態記成常態

### 每週的標準流程

```bash
pnpm canary          # 1. 看報告
# 2. 沒有 🔴 → 
pnpm canary:update   # 3. 告訴它「這次正常」
```

一次約 40 秒。會跳出一個 Chrome 視窗，跑完自己關掉，不要去動它。

---

## 報告怎麼看

```
Google SERP selector 週檢 — 2026-08-21（基準線累積 2 次觀測）   ← ①

🟠 flaky (2) — 歸零，但觀測史還不足以排除「Google 這次沒顯示那個模組」   ← ②
    [tw-kp] div[data-attrid*="Video"] img
        過去 1/2 次命中，最多 5 → 這次 0                        ← ③

合計 198 格：28 正常 · 0 失效 · 2 待確認 · 1 下滑 · 167 長期未命中  ← ④
  掃描根：#search / #rcnt / #center_col 在 6 頁全部存在           ← ⑤
  autocomplete：listbox 4 · option 20                            ← ⑥
```

**① 累積幾次觀測** — 這份報告的可信度全看這個數字。
只跑過 1 次的話，很多格還在「不確定它平常是不是這樣」的狀態。
數字愈大，紅燈愈值得當真。每跑一次 `canary:update` 加 1。

**② 分類標題** — 只有需要你注意的類別才會出現。全部正常時這一段是空的。

**③ 每一格的觀測史** — 讀法是
「這個 selector 在 `tw-kp` 這一頁，過去 2 次檢查裡有 1 次 match 到東西，
最多曾經 match 到 5 個，而這次 match 到 0 個」。

**④ 合計** — 「格」= 一個頁面 × 一條 selector。6 頁 × 33 條 = 198 格。

**⑤ 掃描根** — 逐筆結果比對（`resultScanner`）要靠這三個容器找結果區。
三個都不見的話那個功能整個失效。

**⑥ autocomplete** — 搜尋框下拉選單的阻擋靠 `[role="listbox"]` / `[role="option"]`。
數字 >0 就代表結構還在。

### 六種狀態

| 記號 | 狀態 | 意思 | 你要做什麼 |
| --- | --- | --- | --- |
| 🔴 | `regression` | **這條 selector 很可能真的壞了。** 它過去穩定命中、命中數也夠大，這次卻是 0 | **去修 selector**（見下方） |
| 🟠 | `flaky` | 這次是 0，但這一格過去本來就時有時無，或才觀測過一兩次 —— 分不出是壞了還是 Google 這次剛好沒顯示那個區塊 | 通常沒事，跑 `canary:update` 讓它累積判斷依據。連續好幾週都 🟠 才值得去看 |
| 🟡 | `degraded` | 還有命中，但掉到過去最多的 3 成以下 | 記著就好。連續下滑才是訊號 |
| 🟢 | `revived` | 過去沒命中過、這次有了 | 好事。Google 把那個區塊加回來了 |
| 🆕 | `new` | 基準線沒有這一格（你新增了 selector 或新增了頁面） | 跑 `canary:update` 收進來 |
| ⚪ | `dead` | **從來沒命中過。** 不是這次壞的 | 什麼都不用做。預設摺疊成一行 |

> ⚪ 有 167 格是正常的。首次盤點發現 33 條 selector 裡有 23 條從來沒 match 到任何東西
> （舊版 layout 的防禦性 fallback、`<picture>`、`<video>` 等）。
> 它們沒有被刪掉，成本只有幾百 bytes 的 CSS 文字。
> 想看是哪些：`CANARY_DEAD=1 pnpm canary`

### 為什麼 🔴 和 🟠 要分開

因為 **Google 不保證同一個查詢每次都顯示同一組區塊**。
知識面板的影片區、圖片輪播會不會出現，同一個查詢隔十五分鐘就可能不一樣。

所以「命中數掉到 0」這件事本身，還不足以下判斷：

- `#search img` 從 **212** 掉到 0 → 不可能是內容浮動 → 🔴
- `g-scrolling-carousel` 從 **1** 掉到 0 → 完全可能只是這次沒有輪播 → 🟠

判定門檻寫在 `report.ts` 的 `isTrustworthy()`：
穩定度（`seen/runs`）要達 0.8，**而且** 歷來最大命中數 ≥ 10 或已累積 ≥ 3 次觀測。

---

## 出現 🔴 的時候怎麼修

1. 報告會直接告訴你是**哪一頁的哪一條** selector。
2. 手動開那一頁（頁面清單在 `canary/pages.ts`），F12 看那個區塊現在的 HTML 長怎樣。
3. 改 `entrypoints/content/selectors.ts` 裡對應的那一條。
4. `pnpm test` + `pnpm compile`。
5. `pnpm canary` 確認新 selector 有命中。
6. `pnpm canary:update` 把修好的狀態記成新基準。

---

## 其他狀況

**看到 `⏭ 略過（驗證碼 / sorry 頁）`**
Google 覺得你像機器人。這**不是**失效，那些頁不參與判定、也不會被記進觀測史。
過幾小時再跑。連續好幾次都這樣的話，用 `.canary-profile` 手動開一次 Google
正常搜尋幾下，讓那個 profile 看起來像真人在用。

**看到 `⚠ autocomplete：沒能觸發下拉`**
打字沒觸發建議選單。偶爾發生，不影響其他判定。

**第一次在新機器上跑**
會用 `.canary-profile/`（一個獨立的 Chrome profile，不是你日常那個）。
如果卡在 Google 的 consent 同意畫面，手動按過去一次就好，之後會記住。

**為什麼不能放進 CI / GitHub Actions**
CI 的 IP 是資料中心 IP，Google 幾乎必定回驗證碼。
這套東西的設計前提就是「你自己的機器、真實 profile、有畫面、每週一次」。

---

## 檔案

| 檔案 | 是什麼 |
| --- | --- |
| `pages.ts` | 要走訪哪 6 個 Google 頁面 |
| `probe.ts` | 丟進瀏覽器頁面裡執行的計數程式 |
| `report.ts` | 判定規則與報告排版（純函式，被 `pnpm test` 守住） |
| `report.test.ts` | 上面那份判定規則的測試 |
| `run.canary.ts` | 開瀏覽器、跑流程、寫基準線 |
| `baseline.json` | 觀測史。**進版控**，這樣才看得出 Google 是哪一週改的 |
