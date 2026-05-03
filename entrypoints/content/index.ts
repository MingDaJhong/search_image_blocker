import { defineContentScript } from 'wxt/sandbox'
import { loadSettings, shouldBlock, type BlocklistSettings } from '@/composables/useBlocklist'

export default defineContentScript({
  matches: ['https://www.google.com/search*', 'https://www.google.com.tw/search*'],
  runAt: 'document_start',
  async main() {
    const url = new URL(location.href)
    const query = url.searchParams.get('q') ?? ''

    // 先注入隱藏 CSS（避免閃爍）
    const styleEl = injectInitialHideStyle()

    const settings = await loadSettings()
    const blocked = shouldBlock(query, settings)

    if (!blocked) {
      // 不命中關鍵字 → 移除預設隱藏
      styleEl.remove()
      return
    }

    console.log('[SIB] Blocking visual blocks for query:', query)
    applyBlockingRules(settings, styleEl)
    observeFutureNodes(settings)
  },
})

/**
 * 在 document_start 階段先注入「全部隱藏」的暫時 CSS，
 * 等讀完設定後再決定要保留還是移除，避免使用者看到圖片閃過。
 */
function injectInitialHideStyle(): HTMLStyleElement {
  const style = document.createElement('style')
  style.id = 'sib-initial-hide'
  style.textContent = `
    /* 暫時通殺所有圖片橫幅、影片卡 — 等 settings 載入後再決定 */
    g-scrolling-carousel,
    div[data-attrid*="kc:/"][data-attrid*="image"],
    div[jsname][data-hveid] g-scrolling-carousel { 
      visibility: hidden !important; 
    }
  `
  ;(document.head || document.documentElement).appendChild(style)
  return style
}

/**
 * 套用「實際」要隱藏的 CSS 規則
 */
function applyBlockingRules(settings: BlocklistSettings, oldStyle: HTMLStyleElement) {
  const selectors: string[] = []

  if (settings.blockTypes.images) {
    selectors.push(
      // 圖片橫幅 / 圖片輪播
      'g-scrolling-carousel',
      // 「圖片」分頁的圖片網格容器
      'div[data-attrid*="image"]',
      // 知識面板裡的圖片
      'g-img',
      // 知識圖譜上方的合成大圖（昆蟲案例就是這個）
      'div[data-attrid="kc:/local:hero image"]',
      'div[data-attrid$="hero image"]',
      'div[jsname="HiaYvf"]',
      // 圖片區塊容器
      'div[data-tts-text]',
      // 縮圖（搜尋結果項目中的圖片）
      '#search img',
      '#rcnt img'
    )
  }

  if (settings.blockTypes.videos) {
    selectors.push(
      // YouTube / 影片卡片
      'video-voyager',
      'div[data-attrid*="VideoObject"]',
      'div[jsname][data-hveid] a[href*="youtube.com"]',
      // 影片區塊（含縮圖卡）
      'div[data-vido]',
      'div[jsname="UWckNb"][href*="youtube.com"]',
      'a[href*="youtube.com/watch"]'
    )
  }

  if (settings.blockTypes.relatedQuestions) {
    // 「相關問題」區塊
    selectors.push('div[jsname="N760b"]', 'div[data-initq]')
  }

  if (settings.blockTypes.knowledgePanel) {
    // 右側知識面板
    selectors.push('div[data-attrid="kc:/"]', '#rhs')
  }

  const css = selectors.length
    ? `${selectors.join(',\n')} { display: none !important; }`
    : ''

  const style = document.createElement('style')
  style.id = 'sib-block-style'
  style.textContent = css
  ;(document.head || document.documentElement).appendChild(style)

  oldStyle.remove()
}

/**
 * Google 結果是漸進式渲染，後續注入的 DOM 也要處理。
 * 用 MutationObserver 監聽即可（純 CSS 規則理論上會自動套用，
 * 但保留 observer 以便未來想加 JS 邏輯，例如數量統計）
 */
function observeFutureNodes(_settings: BlocklistSettings) {
  const observer = new MutationObserver(() => {
    // 預留位置：未來可在這裡做更精細的判斷
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}
