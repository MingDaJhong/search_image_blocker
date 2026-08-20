// @vitest-environment happy-dom
/**
 * 點擊揭露的行為測試。
 *
 * 這個功能只有兩個會出錯的地方，兩個都在這裡釘住：
 *   1. 遮罩幾乎都疊在結果連結上 —— 不攔掉第一下就直接跳走，使用者根本
 *      看不到自己剛揭露的內容
 *   2. 已經揭露過的元素不能再攔，否則那張圖永遠點不進去
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealOnClick } from './clickReveal'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function setup(html: string) {
  document.body.innerHTML = html
  const revealed: HTMLElement[] = []
  const revealer = revealOnClick({
    find: (target) => {
      const el = target.closest('[data-masked]')
      return el instanceof HTMLElement && !revealed.includes(el) ? el : null
    },
    reveal: (el) => revealed.push(el),
  })
  return { revealer, revealed }
}

describe('revealOnClick', () => {
  it('點在遮罩上會揭露它', () => {
    const { revealer, revealed } = setup('<img id="t" data-masked>')
    document.getElementById('t')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    expect(revealed).toHaveLength(1)
    revealer.disconnect()
  })

  it('第一下攔掉導覽 —— 不然點開的瞬間就跳走了', () => {
    const { revealer } = setup('<a href="/x"><img id="t" data-masked></a>')
    const nav = vi.fn()
    document.querySelector('a')!.addEventListener('click', nav)
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('t')!.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(nav).not.toHaveBeenCalled()
    revealer.disconnect()
  })

  it('第二下正常放行 —— 已經揭露過的圖要能真的點進結果', () => {
    const { revealer } = setup('<a href="/x"><img id="t" data-masked></a>')
    const nav = vi.fn()
    document.querySelector('a')!.addEventListener('click', nav)
    const img = document.getElementById('t')!
    img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const second = new MouseEvent('click', { bubbles: true, cancelable: true })
    img.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
    expect(nav).toHaveBeenCalledOnce()
    revealer.disconnect()
  })

  it('點在沒被遮的東西上完全不干涉', () => {
    const { revealer, revealed } = setup('<h3 id="title">標題</h3><a href="/x">連結</a>')
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('title')!.dispatchEvent(ev)
    expect(revealed).toHaveLength(0)
    expect(ev.defaultPrevented).toBe(false)
    revealer.disconnect()
  })

  it('中鍵 / 右鍵不攔 —— 開新分頁與右鍵選單要照原樣運作', () => {
    const { revealer, revealed } = setup('<img id="t" data-masked>')
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 })
    document.getElementById('t')!.dispatchEvent(ev)
    expect(revealed).toHaveLength(0)
    expect(ev.defaultPrevented).toBe(false)
    revealer.disconnect()
  })

  it('disconnect() 之後不再攔任何點擊', () => {
    const { revealer, revealed } = setup('<img id="t" data-masked>')
    revealer.disconnect()
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('t')!.dispatchEvent(ev)
    expect(revealed).toHaveLength(0)
    expect(ev.defaultPrevented).toBe(false)
  })
})
