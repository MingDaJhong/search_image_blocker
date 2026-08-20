/**
 * 跨檔案一致性的守門測試。
 *
 * 這裡每一條原本都是 CLAUDE.md 裡的一句「記得同步」。註解不會在忘記的時候
 * 響，測試會 —— 跟 googleTlds.test.ts 用測試釘住手寫 `matches` 字面量是同一招。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { messages } from '@/entrypoints/popup/i18n'

const read = (relative: string) =>
  readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')

describe('版本號單一來源', () => {
  it('package.json 與 wxt.config.ts 的 version 一致', () => {
    // 兩邊各寫一次，遲早會漂移 —— 而漂移的後果是上架的 zip 版本號跟 repo 對不上
    const pkg = JSON.parse(read('package.json')) as { version: string }
    const manifest = read('wxt.config.ts').match(/version:\s*'([^']+)'/)
    expect(manifest, '在 wxt.config.ts 找不到 version').not.toBeNull()
    expect(manifest![1]).toBe(pkg.version)
  })
})

describe('隱私權政策的兩份副本', () => {
  it('repo 根目錄的 privacy.html 與 entrypoints/privacy/index.html 完全相同', () => {
    // 根目錄那份是 GitHub Pages 服務的來源（Chrome Web Store listing 填的網址），
    // extension 內那份是 popup footer 連的。漂移的結果是使用者看到的政策
    // 跟審查看到的政策不一樣。同步用 `pnpm sync:privacy`。
    expect(read('privacy.html')).toBe(read('entrypoints/privacy/index.html'))
  })
})

describe('i18n 兩個語系的鍵一致', () => {
  it('zh-TW 與 en 有完全相同的 key', () => {
    // `Messages` 型別是 `(typeof messages)[Locale]`，少一個 key 只會讓型別
    // 變成 union 而在使用處報一個很難讀的錯，早點在這裡講清楚
    const zh = Object.keys(messages['zh-TW']).sort()
    const en = Object.keys(messages.en).sort()
    expect(en).toEqual(zh)
  })

  it('沒有空字串文案', () => {
    for (const [locale, table] of Object.entries(messages)) {
      for (const [key, value] of Object.entries(table)) {
        if (typeof value === 'string') {
          expect(value.trim(), `${locale}.${key}`).not.toBe('')
        }
      }
    }
  })
})

describe('保留命令名稱依 manifest 版本切換', () => {
  it('wxt.config.ts 同時處理 MV3 與 MV2 的「開啟 popup」命令', () => {
    // MV3 是 `_execute_action`，MV2（Firefox 目標）是 `_execute_browser_action`。
    // WXT 會自動把 action → browser_action，但**不會**改 commands 的鍵名，
    // 寫死 MV3 那個名字的話 Firefox 上按快捷鍵不會開 popup，而且 AMO linter 會抱怨。
    const config = read('wxt.config.ts')
    expect(config, 'MV3 的保留名稱不見了').toContain('_execute_action')
    expect(config, 'MV2 的保留名稱不見了 —— Firefox 上快捷鍵會失效').toContain(
      '_execute_browser_action',
    )
    expect(config, 'commands 應該依 manifestVersion 切換鍵名').toMatch(
      /manifestVersion\s*===\s*3/,
    )
  })
})

describe('快捷鍵描述有雙語', () => {
  it('manifest 用到的 __MSG_*__ token 在兩個 _locales 都有定義', () => {
    const config = read('wxt.config.ts')
    const tokens = new Set(
      [...config.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]),
    )
    expect(tokens.size).toBeGreaterThan(0)
    for (const locale of ['zh_TW', 'en']) {
      const table = JSON.parse(read(`public/_locales/${locale}/messages.json`))
      for (const token of tokens) {
        expect(table, `${locale} 缺少 ${token}`).toHaveProperty(token)
      }
    }
  })
})
