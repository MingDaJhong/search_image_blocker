// @vitest-environment happy-dom
/**
 * popup 本機快取的回歸測試。
 *
 * 這層快取存在的唯一理由是「開啟 popup 會空一下」：`chrome.storage.sync` 只有
 * async API，畫面得等它回來才長得出來。三個不變量各對應一個真的會回來的 bug：
 *
 * 1. 快取命中時 `loaded` 必須**同步**就是 true —— 只要有人把它改回「等 storage
 *    回來才 true」，第一個 frame 又會變回「載入中…」，閃動就整個回來了。
 * 2. 讀回來的快取要走 normalizeSettings —— 快取檔可能是舊版本寫的，缺欄位得自己
 *    補齊，不能把 undefined 丟給 UI。
 * 3. 快取與 storage 內容一致時**不可以寫回 storage**。`chrome.storage.sync` 有
 *    每小時 1800 次的寫入上限，讓「每次開 popup」都花掉一次配額，重度使用者
 *    會撞到 MAX_WRITE_OPERATIONS_PER_HOUR，然後真正的設定變更反而存不進去。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { fakeBrowser } from 'wxt/testing'
import { DEFAULT_SETTINGS, STORAGE_KEY, loadSettings, saveSettings } from './blockList'
import { useBlockList } from './useBlockList'

const CACHE_KEY = 'sib_settings_cache'

/** 等 useBlockList 裡那個 loadSettings().then 跑完 */
async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

beforeEach(() => {
  fakeBrowser.reset()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('快取命中時 popup 不必等 storage', () => {
  it('loaded 在 useBlockList() 回傳的當下就是 true', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, keywords: ['蜘蛛'] }))
    const { loaded, settings } = useBlockList()
    // 沒有 await：這正是「第一個 frame 就有內容」的定義
    expect(loaded.value).toBe(true)
    expect(settings.value.keywords).toContain('蜘蛛')
  })

  it('沒有快取時維持原本行為：先 false，storage 回來才 true', async () => {
    const { loaded } = useBlockList()
    expect(loaded.value).toBe(false)
    await flush()
    expect(loaded.value).toBe(true)
  })

  it('壞掉的快取不會讓 popup 整個掛掉，只是退回 async 路徑', async () => {
    localStorage.setItem(CACHE_KEY, '{ 這不是 JSON')
    const { loaded, settings } = useBlockList()
    expect(loaded.value).toBe(false)
    await flush()
    expect(loaded.value).toBe(true)
    expect(Array.isArray(settings.value.keywords)).toBe(true)
  })

  it('殘缺的舊版快取會被補齊，不會把 undefined 交給 UI', () => {
    // 只有 keywords 一個欄位，其餘全缺 —— 模擬未來新增欄位後讀到舊快取
    localStorage.setItem(CACHE_KEY, JSON.stringify({ keywords: ['蜘蛛'] }))
    const { settings } = useBlockList()
    expect(settings.value.hideMode).toBe(DEFAULT_SETTINGS.hideMode)
    expect(Array.isArray(settings.value.allowKeywords)).toBe(true)
    expect(Array.isArray(settings.value.customCategories)).toBe(true)
    expect(settings.value.customCategories.length).toBeGreaterThan(0)
    expect(typeof settings.value.perResultBlock).toBe('boolean')
  })
})

describe('對帳不能變成一次多餘的 storage 寫入', () => {
  it('快取與 storage 一致時，開 popup 完全不寫 storage', async () => {
    const stored = await loadSettings()
    await saveSettings(stored)
    localStorage.setItem(CACHE_KEY, JSON.stringify(stored))

    const setSpy = vi.spyOn(fakeBrowser.storage.sync, 'set')
    useBlockList()
    await flush()
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('storage 比快取新時會採用 storage 的值，但仍然不寫回去', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, keywords: ['舊的'] }))
    await fakeBrowser.storage.sync.set({
      [STORAGE_KEY]: { ...DEFAULT_SETTINGS, keywords: ['另一台裝置加的'] },
    })

    const setSpy = vi.spyOn(fakeBrowser.storage.sync, 'set')
    const { settings } = useBlockList()
    expect(settings.value.keywords).toEqual(['舊的'])
    await flush()
    expect(settings.value.keywords).toEqual(['另一台裝置加的'])
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('使用者真的改了設定時照常寫入，並同步更新快取', async () => {
    const { addKeyword } = useBlockList()
    await flush()

    const setSpy = vi.spyOn(fakeBrowser.storage.sync, 'set')
    expect(addKeyword('蜈蚣')).toBe('added')
    expect(setSpy).toHaveBeenCalledTimes(1)

    const cached = JSON.parse(localStorage.getItem(CACHE_KEY)!)
    expect(cached.keywords).toContain('蜈蚣')
  })
})
