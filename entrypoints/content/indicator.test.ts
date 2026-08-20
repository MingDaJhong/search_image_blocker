// @vitest-environment happy-dom
/**
 * 頁面提示的狀態機測試。
 *
 * 這個元件的契約是三件事，每一件對應一個狀態：
 *   1. 有擋到東西 → 說明擋了幾個、為什麼
 *   2. 使用者按了「顯示」→ 說明現在是顯示狀態、怎麼恢復
 *   3. 阻擋啟用但一個都沒擋到 → 這是 selector 失效的訊號，要講出來
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIndicator, type IndicatorState } from './indicator'

/**
 * shadow root 是 closed 的（Google 的 script 不該讀到使用者的關鍵字），
 * 測試要看內容就攔 attachShadow 把 root 存下來。
 */
let capturedRoot: ShadowRoot | null = null
const realAttachShadow = Element.prototype.attachShadow

beforeEach(() => {
  capturedRoot = null
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    const root = realAttachShadow.call(this, init)
    capturedRoot = root
    return root
  }
})

afterEach(() => {
  Element.prototype.attachShadow = realAttachShadow
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const base: IndicatorState = {
  hiddenCount: 12,
  keyword: '蛇',
  categoryLabel: '爬蟲 / 兩棲類',
  revealed: false,
  locale: 'zh-TW',
}

function render(state: Partial<IndicatorState>, onToggle = () => {}) {
  const indicator = createIndicator(onToggle)
  indicator.update({ ...base, ...state })
  const root = capturedRoot!
  return {
    indicator,
    title: root.querySelector('.title')!.textContent,
    sub: root.querySelector('.sub')!.textContent,
    button: root.querySelector('button') as HTMLButtonElement,
    titleClass: root.querySelector('.title')!.getAttribute('class'),
    icon: root.querySelector('.icon') as HTMLImageElement,
  }
}

describe('狀態 1：正在阻擋', () => {
  it('說明擋了幾個、命中什麼', () => {
    const { title, sub, button } = render({})
    expect(title).toBe('已隱藏 12 個區塊')
    expect(sub).toBe('關鍵字「蛇」· 爬蟲 / 兩棲類')
    expect(button.textContent).toBe('顯示')
  })

  it('自訂關鍵字沒有分類名', () => {
    expect(render({ categoryLabel: null }).sub).toBe('關鍵字「蛇」')
  })

  it('globalBlock 時說明是全域阻擋', () => {
    expect(render({ keyword: '', categoryLabel: null }).sub).toBe('全域阻擋')
  })

  it('依 locale 切換文案', () => {
    const { title, sub, button } = render({ locale: 'en', categoryLabel: null })
    expect(title).toBe('12 blocks hidden')
    expect(sub).toBe('Keyword "蛇"')
    expect(button.textContent).toBe('Show')
  })

  it('英文單數不會寫成 1 blocks', () => {
    expect(render({ locale: 'en', hiddenCount: 1 }).title).toBe('1 block hidden')
  })
})

describe('狀態 2：使用者按了顯示', () => {
  it('說明現在是顯示狀態，以及怎麼恢復', () => {
    const { title, sub, button } = render({ revealed: true })
    expect(title).toBe('已顯示本頁圖片')
    expect(sub).toBe('重新整理就會恢復隱藏')
    expect(button.textContent).toBe('復原')
  })

  it('按鈕會呼叫 onToggleReveal', () => {
    const onToggle = vi.fn()
    const { button } = render({}, onToggle)
    button.click()
    expect(onToggle).toHaveBeenCalledOnce()
  })
})

describe('狀態 3：阻擋啟用但一個都沒擋到', () => {
  it('直說找不到東西可擋，並提示可能是 Google 改版', () => {
    const { title, sub, titleClass } = render({ hiddenCount: 0 })
    expect(title).toBe('沒有找到可隱藏的區塊')
    expect(sub).toBe('Google 可能改版了，請回報')
    expect(titleClass).toContain('warn') // 標題轉成警示色
  })

  it('正常狀態不是警示色', () => {
    expect(render({}).titleClass).not.toContain('warn')
  })

  it('圖示不隨狀態變色 —— 它是產品識別，不是狀態指示', () => {
    expect(render({}).icon.src).toBe(render({ hiddenCount: 0 }).icon.src)
  })
})

describe('圖示', () => {
  it('圖示有來源', () => {
    // 內嵌成 data URI 是 build 時才發生的（vitest 的 dev transform 看不到），
    // 那一段由 build 產物檢查負責，這裡只確認元件真的有掛上圖
    expect(render({}).icon.src).toBeTruthy()
  })

  it('圖示對輔助技術隱藏 —— 旁邊的文字才是資訊', () => {
    const { icon } = render({})
    expect(icon.alt).toBe('')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('生命週期', () => {
  it('shadow root 是 closed —— 頁面 script 讀不到使用者的關鍵字', () => {
    const host = (() => {
      createIndicator(() => {})
      return document.getElementById('sib-indicator')!
    })()
    expect(host.shadowRoot).toBeNull()
  })

  it('destroy() 會把 host 從頁面移除', () => {
    const indicator = createIndicator(() => {})
    expect(document.getElementById('sib-indicator')).not.toBeNull()
    indicator.destroy()
    expect(document.getElementById('sib-indicator')).toBeNull()
  })

  it('重複建立不會留下兩個', () => {
    createIndicator(() => {})
    createIndicator(() => {})
    expect(document.querySelectorAll('#sib-indicator')).toHaveLength(1)
  })

  it('內容沒變時不重寫 DOM', () => {
    const { indicator, title } = render({})
    const node = capturedRoot!.querySelector('.title')!
    const spy = vi.spyOn(node, 'textContent', 'set')
    indicator.update({ ...base }) // 同樣的狀態
    expect(spy).not.toHaveBeenCalled()
    expect(title).toBe('已隱藏 12 個區塊')
  })
})
