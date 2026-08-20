// @vitest-environment happy-dom
/**
 * Selector 清單的守門測試。
 *
 * 這是整個專案最脆弱的檔案 —— Google 會定期改 DOM，而修 selector 通常是在
 * 「使用者回報壞掉了」的壓力下進行的。這裡把兩件會無聲失效的事情變成紅燈。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/composables/blockList'
import {
  INITIAL_HIDE_BLOCK_TYPES,
  buildBlockCSS,
  buildInitialHideCSS,
  collectAllSelectors,
  collectAlwaysHideSelectors,
  collectBlockSelectors,
  countBlockedElements,
  findRevealTarget,
} from './selectors'

const ALL_ON: (typeof DEFAULT_SETTINGS)['blockTypes'] = {
  images: true,
  thumbnails: true,
  videos: true,
  relatedQuestions: true,
  knowledgePanel: true,
  searchPreview: true,
  imageFilterBar: true,
}

describe('selector 語法', () => {
  it('每一個 selector 都是瀏覽器解析得出來的合法 CSS', () => {
    const invalid: string[] = []
    for (const sel of collectAllSelectors(ALL_ON)) {
      try {
        document.querySelectorAll(sel)
      } catch {
        invalid.push(sel)
      }
    }
    expect(invalid).toEqual([])
  })

  it('沒有重複的 selector', () => {
    const all = collectAllSelectors(ALL_ON)
    expect(all.length).toBe(new Set(all).size)
  })
})

describe('CSS 產出', () => {
  it('一個 selector 一條 rule，不用逗號併成一條', () => {
    // CSS 規範：selector 清單裡只要有一個無效，整條 rule 會被丟掉。
    // 併成一條的話，一個 typo 就會讓所有阻擋全滅。
    const css = buildBlockCSS({ ...DEFAULT_SETTINGS, blockTypes: ALL_ON })
    const rules = css.split('\n').filter(Boolean)
    expect(rules.length).toBe(collectAllSelectors(ALL_ON).length)
    for (const rule of rules) {
      expect(rule).toMatch(/\{ display: none !important; \}$/)
    }
  })

  it('全部關閉時產出空字串，不會留下空 rule', () => {
    const noneOn = Object.fromEntries(
      Object.keys(ALL_ON).map((k) => [k, false]),
    ) as typeof ALL_ON
    expect(buildBlockCSS({ ...DEFAULT_SETTINGS, blockTypes: noneOn })).toBe('')
  })

  it('開場遮蔽用 visibility 而非 display（保留版面、移除時不 reflow）', () => {
    expect(buildInitialHideCSS()).toContain('visibility: hidden !important;')
    expect(buildInitialHideCSS()).not.toContain('display: none')
  })
})

describe('開場遮蔽的涵蓋範圍', () => {
  /**
   * A2 的核心不變量。document_start 到 loadSettings() 回來之間如果有任何
   * 預設會擋的區塊沒被遮住，使用者就會看到那一瞬間的圖片 —— 對一個為了
   * 恐懼症存在的產品，那就是產品承諾失效。
   *
   * 修復前這條會紅：開場遮蔽漏掉了預設開啟的 thumbnails（`#search img` /
   * `#rcnt img`）與大部分影片卡容器。
   */
  it('必須涵蓋預設設定會擋的每一個 selector', () => {
    const covered = new Set(collectBlockSelectors(INITIAL_HIDE_BLOCK_TYPES))
    const missing = collectBlockSelectors(DEFAULT_SETTINGS.blockTypes).filter(
      (sel) => !covered.has(sel),
    )
    expect(missing).toEqual([])
  })

  it('所有會夾帶圖片的區塊類型都要開著', () => {
    expect(INITIAL_HIDE_BLOCK_TYPES.images).toBe(true)
    expect(INITIAL_HIDE_BLOCK_TYPES.thumbnails).toBe(true)
    expect(INITIAL_HIDE_BLOCK_TYPES.videos).toBe(true)
    expect(INITIAL_HIDE_BLOCK_TYPES.imageFilterBar).toBe(true)
  })

  it('文字區塊不遮 —— 遮了每次搜尋都閃一下，卻擋不到任何圖片', () => {
    // 知識面板裡的圖片由 thumbnails 的 `#rcnt img` 涵蓋，不需要整個右欄蒙起來
    expect(INITIAL_HIDE_BLOCK_TYPES.relatedQuestions).toBe(false)
    expect(INITIAL_HIDE_BLOCK_TYPES.knowledgePanel).toBe(false)
    expect(collectBlockSelectors(INITIAL_HIDE_BLOCK_TYPES)).not.toContain('#rhs')
  })
})

describe('countBlockedElements', () => {
  /**
   * ⚠️ happy-dom 不支援 `:not()` 裡的後代選擇器，而且是**靜默忽略**不是報錯：
   * `#search img:not(cite img)` 在它裡面會把 favicon 一起回傳，真實 Chrome 不會
   * （Selectors L4，Chrome 88 起支援）。
   *
   * 所以這裡的 fixture 刻意不放 favicon / 影片卡 —— 不要寫任何依賴那個排除語意的
   * 斷言，否則測的是 happy-dom 的行為而不是產品的行為。
   */
  function fakeSerp(): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML = `
      <div id="rcnt">
        <div id="search">
          <img src="thumb-a">
          <img src="thumb-b">
        </div>
      </div>
      <g-scrolling-carousel></g-scrolling-carousel>
    `
    document.body.append(root)
    return root
  }

  it('selector 重疊時不會重複計算', () => {
    const root = fakeSerp()
    // `#search img` 與 `#rcnt img` 命中同一批元素。
    // 若是把各 selector 的 length 相加，這裡會得到 5 而不是 3
    // （縮圖 2 × 兩個 selector + 輪播 1）。
    expect(countBlockedElements(root, DEFAULT_SETTINGS.blockTypes)).toBe(3)
    root.remove()
  })

  it('只開 thumbnails 時只數縮圖', () => {
    const root = fakeSerp()
    const onlyThumbs = {
      ...DEFAULT_SETTINGS.blockTypes,
      images: false,
      videos: false,
      imageFilterBar: false,
    }
    expect(countBlockedElements(root, onlyThumbs)).toBe(2)
    root.remove()
  })

  it('沒有任何命中時回傳 0 —— 這就是 selector 失效的訊號', () => {
    const empty = document.createElement('div')
    document.body.append(empty)
    expect(countBlockedElements(empty, DEFAULT_SETTINGS.blockTypes)).toBe(0)
    empty.remove()
  })

  it('全部關閉時回傳 0，不會誤數', () => {
    const root = fakeSerp()
    const noneOn = Object.fromEntries(
      Object.keys(ALL_ON).map((k) => [k, false]),
    ) as typeof ALL_ON
    expect(countBlockedElements(root, noneOn)).toBe(0)
    root.remove()
  })
})

describe('遮蔽方式（B2）', () => {
  const withMode = (hideMode: (typeof DEFAULT_SETTINGS)['hideMode']) => ({
    ...DEFAULT_SETTINGS,
    hideMode,
    blockTypes: ALL_ON,
  })

  it('blur 保留版面 —— 不能出現 display: none', () => {
    const css = buildBlockCSS(withMode('blur'))
    expect(css).toContain('filter: blur(')
    // <video> 那組例外還是 display:none，所以只檢查「可遮的那批」不含它
    for (const sel of collectBlockSelectors(ALL_ON)) {
      const rule = css.split('\n').find((r) => r.startsWith(`${sel} {`))
      expect(rule).not.toContain('display: none')
    }
  })

  it('mask 先鋪一層不透明底色再壓平，避免透明 PNG 留下剪影', () => {
    const css = buildBlockCSS(withMode('mask'))
    // contrast(0) 只動顏色不動 alpha：沒有底色的話，透明背景的 PNG 會留下
    // 一個灰色剪影 —— 而剪影正是恐懼症使用者最不能看的東西
    expect(css).toContain('box-shadow: inset 0 0 0 9999px #000 !important;')
    expect(css).toContain('filter: contrast(0) brightness(1.6) !important;')
  })

  it.each(['blur', 'mask'] as const)('%s 會附上「已點開」的抵銷規則', (mode) => {
    const css = buildBlockCSS(withMode(mode))
    const revealRules = css
      .split('\n')
      .filter((r) => r.includes('[data-sib-reveal]'))
    // 每一個可遮的 selector 都要有自己的抵銷規則：
    // 只寫一條 `[data-sib-reveal]` specificity 會輸給 `#search img`，點了沒反應
    expect(revealRules).toHaveLength(collectBlockSelectors(ALL_ON).length)
    for (const rule of revealRules) {
      expect(rule).toContain('filter: none !important;')
      expect(rule).toContain('box-shadow: none !important;')
      expect(rule).toContain('clip-path: none !important;')
    }
  })

  it('hide 模式不產生抵銷規則 —— display:none 的元素點不到', () => {
    expect(buildBlockCSS(withMode('hide'))).not.toContain('[data-sib-reveal]')
  })

  it.each(['hide', 'blur', 'mask'] as const)(
    '%s 模式下 <video> 一律 display:none（否則 hover 會播、還會出聲）',
    (mode) => {
      const css = buildBlockCSS(withMode(mode))
      const videoSelectors = collectAlwaysHideSelectors(ALL_ON)
      expect(videoSelectors.length).toBeGreaterThan(0)
      for (const sel of videoSelectors) {
        expect(css).toContain(`${sel} { display: none !important; }`)
      }
    },
  )

  it('videos 關掉時就沒有「一律隱藏」的 selector', () => {
    expect(collectAlwaysHideSelectors({ ...ALL_ON, videos: false })).toEqual([])
  })

  it('開場遮蔽仍然不看 hideMode —— 它跑在 storage 回應之前', () => {
    // visibility: hidden 是三種模式的共同上界，遮得比任何一種都多
    expect(buildInitialHideCSS()).toContain('visibility: hidden !important;')
    expect(buildInitialHideCSS()).not.toContain('filter')
  })
})

describe('findRevealTarget', () => {
  function serp(html: string) {
    const root = document.createElement('div')
    root.id = 'search'
    root.innerHTML = html
    document.body.append(root)
    return root
  }

  it('點在圖上時挑最深的命中 —— 點開的範圍愈小愈好', () => {
    const root = serp('<g-scrolling-carousel><span><img id="t"></span></g-scrolling-carousel>')
    const img = document.getElementById('t')!
    // 這張圖同時符合 `#search img` 與祖先的 `g-scrolling-carousel`，
    // 挑輪播的話點一張圖會把整條輪播放開
    expect(findRevealTarget(img, DEFAULT_SETTINGS.blockTypes)?.id).toBe('t')
    root.remove()
  })

  it('已經點開過的元素回傳 null，讓那一下正常傳下去（可以真的點進結果）', () => {
    const root = serp('<img id="t" data-sib-reveal="1">')
    const img = document.getElementById('t')!
    expect(findRevealTarget(img, DEFAULT_SETTINGS.blockTypes)).toBeNull()
    root.remove()
  })

  it('點在沒被遮的東西上回傳 null', () => {
    const root = serp('<h3 id="title">家中常見的蜘蛛</h3>')
    const title = document.getElementById('title')!
    expect(findRevealTarget(title, DEFAULT_SETTINGS.blockTypes)).toBeNull()
    root.remove()
  })

  it('不會把「一律隱藏」的 <video> 當成可點開的目標', () => {
    const root = serp('<video-voyager><video id="v"></video></video-voyager>')
    const video = document.getElementById('v')!
    expect(findRevealTarget(video, DEFAULT_SETTINGS.blockTypes)).toBeNull()
    root.remove()
  })
})
