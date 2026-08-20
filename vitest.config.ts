import { defineConfig } from 'vitest/config'
import { WxtVitest } from 'wxt/testing'

// WxtVitest 幫我們接好 `@/` alias 與 `wxt/browser` → fake-browser 的 mock，
// 純函式（shouldBlock / matchKeyword）與需要 storage 的 loadSettings 都能測。
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['{composables,entrypoints}/**/*.test.ts'],
  },
})
