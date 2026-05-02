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
      // 「圖片」分頁的圖片網格容器（保險起見）
      'div[data-attrid*="image"]',
      // 知識面板裡的圖片
      'g-img',
      // 結果項目中的縮圖（部分情境）
      'div[role="heading"] ~ div img[src*="encrypted"]'
    )
  }

  if (settings.blockTypes.videos) {
    selectors.push(
      // YouTube / 影片卡片
      'video-voyager',
      'div[data-attrid*="VideoObject"]',
      'div[jsname][data-hveid] a[href*="youtube.com"]'
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
