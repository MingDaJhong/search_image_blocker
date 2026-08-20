// @vitest-environment happy-dom
/**
 * 逐筆結果比對的測試。
 *
 * 這個功能的正確性全在「從圖片往上找到它所屬那一筆結果的文字」這個啟發式上，
 * 而它刻意不依賴任何 Google 屬性（那些會被改掉）。所以這裡測的是行為邊界：
 * 逐層往上收集、文字多到抓過頭時停手、走到結果區邊界就停。
 *
 * ⚠️ happy-dom 不支援 `:not()` 裡的後代選擇器（見 CLAUDE.md），
 * 所以 fixture 不放 favicon，也不要寫依賴那個排除語意的斷言。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, seedDefaultCategories } from '@/composables/blockList'
import { collectImageLabels, collectResultContexts, scanResults } from './resultScanner'

const settings = {
  ...DEFAULT_SETTINGS,
  customCategories: seedDefaultCategories('zh-TW'),
  enabledCategories: ['insects', 'reptiles'],
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('collectResultContexts', () => {
  function build(html: string) {
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.append(root)
    return { root, img: root.querySelector('img')! }
  }

  it('由近而遠收集各層祖先的文字', () => {
    const { root, img } = build(`
      <article>
        <h3>家中常見的蜘蛛種類</h3>
        <div><span><img></span></div>
      </article>
    `)
    const contexts = collectResultContexts(img, root)
    // 最近的祖先在前，逐層往外
    expect(contexts.at(-1)).toContain('蜘蛛')
  })

  it('短的中文標題也收得到 —— 不設字數門檻，避免對 CJK 有偏見', () => {
    // 「家中常見的蜘蛛種類」9 個字，資訊完整；同樣內容的英文要 25 字以上。
    // 舊版用單一字數門檻（12）會直接跳過這一層，中文使用者就少一層保護。
    const { root, img } = build('<div><img>家中常見的蜘蛛種類</div>')
    expect(collectResultContexts(img, root)).toEqual(['家中常見的蜘蛛種類'])
  })

  it('文字多到顯然抓過頭時就停，不再往上收', () => {
    // 超過 400 字代表爬到整份結果列表了。這時寧可不擋 ——
    // 否則頁面任一處出現關鍵字就會擋掉全部圖片，退化成 query 層級阻擋
    const { root, img } = build(`<div><span><img></span>${'字'.repeat(500)}</div>`)
    expect(collectResultContexts(img, root)).toEqual([])
  })

  it('跳過沒有文字的層', () => {
    const { root, img } = build('<div><span><img></span>蜘蛛</div>')
    expect(collectResultContexts(img, root)).toEqual(['蜘蛛'])
  })

  it('巢狀容器文字相同時不重複收', () => {
    const { root, img } = build('<div><section><article><img>蜘蛛圖鑑</article></section></div>')
    expect(collectResultContexts(img, root)).toEqual(['蜘蛛圖鑑'])
  })

  it('走到 root 就停，不會爬出結果區', () => {
    const root = document.createElement('div')
    root.textContent = '這段文字在 root 上，不該被當成單筆結果的內容'
    const inner = document.createElement('span')
    const img = document.createElement('img')
    inner.append(img)
    root.append(inner)
    document.body.append(root)
    expect(collectResultContexts(img, root)).toEqual([])
  })
})

describe('collectImageLabels', () => {
  function imgFrom(html: string): Element {
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.append(root)
    return root.querySelector('img')!
  }

  it('收 alt', () => {
    expect(collectImageLabels(imgFrom('<img alt="人面蜘蛛特寫">'))).toEqual(['人面蜘蛛特寫'])
  })

  it('收 title 與 aria-label', () => {
    expect(
      collectImageLabels(imgFrom('<img title="蜘蛛" aria-label="蜘蛛圖鑑">')),
    ).toEqual(['蜘蛛', '蜘蛛圖鑑'])
  })

  it('收外層連結的 aria-label —— 那常常就是完整的結果標題', () => {
    expect(
      collectImageLabels(imgFrom('<a aria-label="家中常見的蜘蛛"><img alt=""></a>')),
    ).toEqual(['家中常見的蜘蛛'])
  })

  it('去重複、去空白', () => {
    expect(
      collectImageLabels(imgFrom('<a title="蜘蛛"><img alt="蜘蛛" title="  "></a>')),
    ).toEqual(['蜘蛛'])
  })

  it('什麼都沒有時回傳空陣列', () => {
    expect(collectImageLabels(imgFrom('<img>'))).toEqual([])
  })
})

describe('scanResults', () => {
  /** 兩筆結果：一筆講蜘蛛、一筆講天氣 */
  function serp() {
    const el = document.createElement('div')
    el.id = 'search'
    el.innerHTML = `
      <article id="r1">
        <h3>家中常見的蜘蛛種類與處理方式</h3>
        <div><img id="spider-img"></div>
      </article>
      <article id="r2">
        <h3>台北一週天氣預報與降雨機率</h3>
        <div><img id="weather-img"></div>
      </article>
    `
    document.body.append(el)
    return el
  }

  const img = (id: string) =>
    document.getElementById(id) as HTMLImageElement

  it('只隱藏命中那一筆的圖片，不動其他筆', () => {
    serp()
    const scanner = scanResults(() => settings, () => {})
    expect(img('spider-img').style.display).toBe('none')
    expect(img('weather-img').style.display).toBe('')
    expect(scanner.hiddenCount).toBe(1)
    scanner.disconnect()
  })

  it('回報是哪個關鍵字命中的，供頁面提示說明原因', () => {
    serp()
    const scanner = scanResults(() => settings, () => {})
    expect(scanner.firstMatch).toEqual({
      keyword: '蜘蛛',
      categoryLabel: '昆蟲 / 節肢動物',
    })
    scanner.disconnect()
  })

  it('disconnect() 還原所有自己隱藏的圖片', () => {
    serp()
    const scanner = scanResults(() => settings, () => {})
    expect(img('spider-img').style.display).toBe('none')
    scanner.disconnect()
    expect(img('spider-img').style.display).toBe('')
    expect(scanner.hiddenCount).toBe(0)
  })

  it('隱藏數量變化時通知呼叫端（頁面提示才更新得了數字）', () => {
    serp()
    const onChange = vi.fn()
    const scanner = scanResults(() => settings, onChange)
    expect(onChange).toHaveBeenCalledOnce()
    scanner.rescan() // 沒有新東西
    expect(onChange).toHaveBeenCalledOnce()
    scanner.disconnect()
  })

  it('同一張圖不會重複處理', () => {
    serp()
    const scanner = scanResults(() => settings, () => {})
    const spy = vi.spyOn(img('spider-img').style, 'setProperty')
    scanner.rescan()
    scanner.rescan()
    expect(spy).not.toHaveBeenCalled()
    scanner.disconnect()
  })

  it('沒有命中時什麼都不動', () => {
    const el = document.createElement('div')
    el.id = 'search'
    el.innerHTML = `
      <article><h3>台北一週天氣預報與降雨機率</h3><div><img id="w"></div></article>
    `
    document.body.append(el)
    const scanner = scanResults(() => settings, () => {})
    expect(scanner.hiddenCount).toBe(0)
    expect(scanner.firstMatch).toBeNull()
    expect(img('w').style.display).toBe('')
    scanner.disconnect()
  })

  it('尊重例外關鍵字 —— 走的是同一套 shouldBlock', () => {
    const el = document.createElement('div')
    el.id = 'search'
    el.innerHTML = `
      <article><h3>蜘蛛人：無家日 上映時間與票價</h3><div><img id="sm"></div></article>
    `
    document.body.append(el)
    const withException = { ...settings, allowKeywords: ['蜘蛛人'] }
    const scanner = scanResults(() => withException, () => {})
    expect(scanner.hiddenCount).toBe(0)
    expect(img('sm').style.display).toBe('')
    scanner.disconnect()
  })
})


describe('alt 比對（B4）', () => {
  const img = (id: string) => document.getElementById(id) as HTMLImageElement

  function mount(html: string) {
    const el = document.createElement('div')
    el.id = 'search'
    el.innerHTML = html
    document.body.append(el)
  }

  it('周圍文字沒提到、但 alt 有寫的圖也會被擋', () => {
    mount(`
      <article>
        <h3>台北一週天氣預報與降雨機率</h3>
        <div><img id="hidden-spider" alt="人面蜘蛛結網特寫"></div>
      </article>
    `)
    const scanner = scanResults(() => settings, () => {})
    expect(img('hidden-spider').style.display).toBe('none')
    expect(scanner.firstMatch?.keyword).toBe('蜘蛛')
    scanner.disconnect()
  })

  it('圖片分頁那種「幾乎沒有周圍文字、只有 alt」的版面', () => {
    // udm=2 的圖磚就是這個形狀：周圍文字少到 collectResultContexts 幫不上忙，
    // 而那正是這個產品最關鍵的頁面
    mount(`
      <div><a href="/x"><img id="tile-1" alt="蟑螂 生態 圖片"></a></div>
      <div><a href="/y"><img id="tile-2" alt="台北 101 夜景"></a></div>
    `)
    const scanner = scanResults(() => settings, () => {})
    expect(img('tile-1').style.display).toBe('none')
    expect(img('tile-2').style.display).toBe('')
    scanner.disconnect()
  })

  it('alt 無關時不動它', () => {
    mount('<div><img id="ok" alt="台北 101 夜景">台北一週天氣預報</div>')
    const scanner = scanResults(() => settings, () => {})
    expect(img('ok').style.display).toBe('')
    scanner.disconnect()
  })

  it('alt 也走同一套例外關鍵字', () => {
    mount('<div><img id="sm" alt="蜘蛛人 無家日 海報">電影上映資訊與票價</div>')
    const scanner = scanResults(
      () => ({ ...settings, allowKeywords: ['蜘蛛人'] }),
      () => {},
    )
    expect(img('sm').style.display).toBe('')
    scanner.disconnect()
  })
})

describe('掃描範圍 fallback', () => {
  it('找不到任何已知結果容器時退回 body —— 沒掃到就等於沒保護', () => {
    const el = document.createElement('div')
    el.id = 'some-future-google-layout'
    el.innerHTML = '<div><img id="orphan" alt="蜈蚣 咬傷 處理"></div>'
    document.body.append(el)
    const scanner = scanResults(() => settings, () => {})
    expect((document.getElementById('orphan') as HTMLImageElement).style.display).toBe('none')
    scanner.disconnect()
  })
})

describe('遮蔽方式（B2）與單張揭露', () => {
  const img = (id: string) => document.getElementById(id) as HTMLImageElement

  /** a / b 兩筆命中，c 完全無關 */
  function serp() {
    const el = document.createElement('div')
    el.id = 'search'
    el.innerHTML = `
      <article><h3>家中常見的蜘蛛種類</h3><div><img id="a"></div></article>
      <article><h3>蟑螂怎麼處理</h3><div><img id="b"></div></article>
      <article><h3>台北一週天氣預報</h3><div><img id="c"></div></article>
    `
    document.body.append(el)
    return el
  }

  it('跟著 hideMode 走 —— 逐筆判斷是判斷邏輯，不該自己決定長什麼樣', () => {
    serp()
    const scanner = scanResults(() => ({ ...settings, hideMode: 'mask' }), () => {})
    expect(img('a').style.display).toBe('')
    expect(img('a').style.filter).toContain('contrast(0)')
    expect(img('a').style.boxShadow).toContain('inset')
    scanner.disconnect()
  })

  it('隱藏的圖帶掃描標記，點擊委派不必知道任何 selector', () => {
    serp()
    const scanner = scanResults(() => ({ ...settings, hideMode: 'blur' }), () => {})
    expect(img('a').getAttribute('data-sib-scan')).toBe('1')
    expect(img('c').hasAttribute('data-sib-scan')).toBe(false)
    scanner.disconnect()
  })

  it('reveal() 只放開那一張，其他照樣遮著', () => {
    serp()
    const scanner = scanResults(() => ({ ...settings, hideMode: 'mask' }), () => {})
    expect(scanner.hiddenCount).toBe(2)
    expect(scanner.reveal(img('a'))).toBe(true)
    expect(img('a').getAttribute('style') ?? '').toBe('')
    expect(img('b').style.filter).toContain('contrast(0)')
    expect(scanner.hiddenCount).toBe(1)
    scanner.disconnect()
  })

  it('揭露過的圖不會在下一次掃描被蓋回去', () => {
    serp()
    const scanner = scanResults(() => ({ ...settings, hideMode: 'mask' }), () => {})
    scanner.reveal(img('a'))
    scanner.rescan()
    expect(img('a').getAttribute('style') ?? '').toBe('')
    scanner.disconnect()
  })

  it('reveal() 對不是自己遮的元素回傳 false', () => {
    serp()
    const scanner = scanResults(() => settings, () => {})
    expect(scanner.reveal(img('c'))).toBe(false)
    scanner.disconnect()
  })

  it('reveal() 會通知呼叫端 —— 頁面提示的數字要跟著降', () => {
    serp()
    const onChange = vi.fn()
    const scanner = scanResults(() => ({ ...settings, hideMode: 'blur' }), onChange)
    onChange.mockClear()
    scanner.reveal(img('a'))
    expect(onChange).toHaveBeenCalledOnce()
    scanner.disconnect()
  })

  it('disconnect() 在 mask 模式下也還原得乾淨', () => {
    serp()
    const scanner = scanResults(() => ({ ...settings, hideMode: 'mask' }), () => {})
    scanner.disconnect()
    expect(img('a').getAttribute('style') ?? '').toBe('')
    expect(img('a').hasAttribute('data-sib-scan')).toBe(false)
  })
})
