import { defineConfig } from 'vitest/config'
import { WxtVitest } from 'wxt/testing'

/**
 * 週檢專用 config，和 `vitest.config.ts` 分開的唯一理由：它會開真的瀏覽器打
 * Google，絕不能被 `pnpm test` 順手跑到。所以是 include 不同，不是環境不同。
 *
 * 仍然需要 `WxtVitest()`：canary 要 import 產品的 `DEFAULT_SETTINGS`（才能用
 * 「實際出貨的 blockTypes」建基準線），而 `blockList.ts` 為了 storage I/O 會
 * import `wxt/browser` —— 那支 polyfill 在 Node 裡是直接 throw 的。
 * 這裡被 mock 掉的只有 `wxt/browser`，Playwright 開的是真 Chrome，不受影響。
 */
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['canary/**/*.canary.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    // 一個真瀏覽器、一組 Google 頁面 —— 併行執行只會同時觸發驗證碼
    fileParallelism: false,
    /**
     * 沒有這一行，整份週檢報告會消失。
     *
     * vitest 預設會攔截 console，而**通過**的測試的輸出不會被印出來 —— 但
     * 這支「測試」的產出就是那份報告，斷言只是附帶的紅綠燈。攔截開著的話，
     * 一次正常執行看到的只有 "1 passed"，逐條命中數全部被吃掉。
     */
    disableConsoleIntercept: true,
  },
})
