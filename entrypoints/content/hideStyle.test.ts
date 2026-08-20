// @vitest-environment happy-dom
/**
 * 遮蔽方式的守門測試。
 *
 * 這裡真正在測的是三件會無聲出錯的事：
 *   1. `hide` 的行為和舊版一字不差 —— 那是絕大多數既有使用者的設定
 *   2. `mask` 有鋪不透明底色（沒有的話透明 PNG 會留下剪影，見 hideStyle.ts）
 *   3. inline 套用／還原是對稱的，中途換模式也不會留下殘留屬性
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  REVEAL_ATTR,
  SCAN_ATTR,
  applyInlineHide,
  clearInlineHide,
  hideDeclaration,
  isRevealable,
  revealDeclaration,
} from './hideStyle'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CSS 宣告', () => {
  it('hide 就是舊版的行為，一字不差', () => {
    expect(hideDeclaration('hide')).toBe('display: none !important;')
  })

  it('blur / mask 都不含 display —— 它們的重點就是保留版面', () => {
    expect(hideDeclaration('blur')).not.toContain('display')
    expect(hideDeclaration('mask')).not.toContain('display')
  })

  it('mask 一定要有不透明底色，否則透明 PNG 會留下剪影', () => {
    // contrast(0) 把每個通道壓成固定值、但不動 alpha。少了這層底色，
    // 一張去背的蜘蛛 PNG 會變成一個灰色蜘蛛剪影 —— 比沒遮更糟
    expect(hideDeclaration('mask')).toContain('inset 0 0 0 9999px')
    expect(hideDeclaration('mask')).toContain('contrast(0)')
  })

  it('每一條宣告都帶 !important', () => {
    for (const mode of ['hide', 'blur', 'mask'] as const) {
      for (const decl of hideDeclaration(mode).split(';').filter((d) => d.trim())) {
        expect(decl).toContain('!important')
      }
    }
  })

  it('blur 一定要 clip-path，否則模糊會溢出到旁邊的結果標題上', () => {
    // filter: blur() 會把繪製範圍往外擴。實測綠色暈開了將近一個縮圖的寬度，
    // 糊在鄰接的文字上 —— 那是使用者會回報成「這個擴充功能把 Google 弄壞了」的樣子
    expect(hideDeclaration('blur')).toContain('clip-path: inset(0) !important;')
  })

  it('blur 不只放大半徑，還要壓對比 —— 只放大的話形狀仍然認得出來', () => {
    expect(hideDeclaration('blur')).toContain('contrast(')
  })

  it('抵銷規則清掉 filter / box-shadow / clip-path，但不動 display', () => {
    expect(revealDeclaration()).toContain('filter: none !important;')
    expect(revealDeclaration()).toContain('box-shadow: none !important;')
    expect(revealDeclaration()).toContain('clip-path: none !important;')
    expect(revealDeclaration()).not.toContain('display')
  })
})

describe('isRevealable', () => {
  it('只有 blur / mask 能點開', () => {
    expect(isRevealable('hide')).toBe(false)
    expect(isRevealable('blur')).toBe(true)
    expect(isRevealable('mask')).toBe(true)
  })
})

describe('inline 套用 / 還原', () => {
  function img() {
    const el = document.createElement('img')
    document.body.append(el)
    return el
  }

  it('hide 用 inline !important —— 那是作者樣式裡最強的一層', () => {
    const el = img()
    applyInlineHide(el, 'hide')
    expect(el.style.display).toBe('none')
    expect(el.style.getPropertyPriority('display')).toBe('important')
  })

  it('套用時留下掃描標記，讓點擊委派找得到它', () => {
    const el = img()
    applyInlineHide(el, 'mask')
    expect(el.getAttribute(SCAN_ATTR)).toBe('1')
  })

  it('還原是完全對稱的，屬性與標記都清乾淨', () => {
    const el = img()
    applyInlineHide(el, 'mask')
    clearInlineHide(el)
    expect(el.getAttribute('style') ?? '').toBe('')
    expect(el.hasAttribute(SCAN_ATTR)).toBe(false)
  })

  it('中途換模式不會留下前一種模式的殘留屬性', () => {
    // 使用者從 mask 切到 hide 時，box-shadow / filter 若沒清掉，
    // 之後放開遮蔽的那一張圖會帶著半條遮罩
    const el = img()
    applyInlineHide(el, 'blur')
    clearInlineHide(el)
    applyInlineHide(el, 'hide')
    expect(el.style.boxShadow).toBe('')
    expect(el.style.filter).toBe('')
    expect(el.style.clipPath).toBe('')
    expect(el.style.display).toBe('none')
  })
})

describe('屬性名稱', () => {
  it('兩個標記名稱不能撞在一起', () => {
    // 撞在一起的話「已被點開」與「被掃描隱藏」會互相消滅
    expect(SCAN_ATTR).not.toBe(REVEAL_ATTR)
  })
})
