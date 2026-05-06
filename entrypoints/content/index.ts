import { defineContentScript } from 'wxt/sandbox'
import { loadSettings, shouldBlock, type BlocklistSettings } from '@/composables/useBlockList'

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

    if (blocked) {
      console.log('[SIB] Blocking visual blocks for query:', query)
      applyBlockingRules(settings, styleEl)
    } else {
      styleEl.remove()
    }

    // autocomplete 縮圖獨立判斷，跟 URL query 解耦：每個 option 用自己的 text
    // 跑一次 shouldBlock，命中才隱藏圖片。所以即使 URL 沒命中關鍵字，使用者
    // 打字打到關鍵字仍會擋；反之 URL 命中但 option 文字無關時也不會誤擋。
    if (settings.blockTypes.searchPreview) {
      observeAutocomplete(settings)
    }
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

  // 注意：searchPreview 不在這裡 — autocomplete 改用 observeAutocomplete()
  // 逐 option 判斷，避免 URL query 命中時把無關的 suggestion 縮圖也擋掉。

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
 * 觀察 autocomplete 下拉，分兩層判斷：
 *
 * 1. 每個 [role="option"] 用自己的 textContent 判斷（左側 suggestion 縮圖）
 * 2. listbox 周邊但「不在 option 裡」的圖片（右側知識預覽面板等），
 *    用搜尋框當前輸入的字串判斷
 *
 * 這樣 q=蟾蜍 + 打字「坤」時不會誤擋坤達；
 * q=蝴蝶 + 打字「昆蟲」時右側昆蟲預覽也會擋掉。
 */
function observeAutocomplete(settings: BlocklistSettings) {
  // 涵蓋常見 Google autocomplete 縮圖寫法：img、Google 自訂 g-img、svg、
  // 以及兩種 inline-style 背景圖（background-image: 或 background: url(...)）
  const IMG_SELECTOR = [
    'img',
    'g-img',
    'svg',
    'picture',
    '[style*="background-image"]',
    '[style*="url("]',
  ].join(', ')

  function getInputValue(): string {
    const el = document.querySelector(
      'textarea[name="q"], input[name="q"]'
    ) as HTMLInputElement | HTMLTextAreaElement | null
    return (el?.value ?? '').trim()
  }

  function processAll() {
    const inputValue = getInputValue()
    const inputBlocked = inputValue ? shouldBlock(inputValue, settings) : false

    // 收集所有 option + 它們的文字，順便算出有沒有任何 option 命中
    const options = Array.from(document.querySelectorAll('[role="option"]'))
    const optionTexts = options.map((o) => (o.textContent ?? '').trim())
    const anyOptionBlocked = optionTexts.some(
      (t) => t && shouldBlock(t, settings)
    )

    // 右側預覽：input 命中 OR 任何 option 命中都擋
    // —— 解決「只打青就跳出青蛙預覽」這類 query 還沒打完就洩漏的情境
    const previewBlocked = inputBlocked || anyOptionBlocked
    const handled = new WeakSet<Element>()

    // 1. 每個 option 用自己的文字判斷
    options.forEach((option, i) => {
      const text = optionTexts[i]
      const block = text ? shouldBlock(text, settings) : false
      option.querySelectorAll(IMG_SELECTOR).forEach((el) => {
        handled.add(el)
        ;(el as HTMLElement).style.visibility = block ? 'hidden' : ''
      })
    })

    // 2. listbox 容器內、option 以外的圖片（右側知識預覽面板）
    document.querySelectorAll('[role="listbox"]').forEach((listbox) => {
      const container = listbox.parentElement ?? listbox
      container.querySelectorAll(IMG_SELECTOR).forEach((el) => {
        if (handled.has(el)) return
        if (el.closest('[role="option"]')) return
        ;(el as HTMLElement).style.visibility = previewBlocked ? 'hidden' : ''
      })
    })
  }

  const observer = new MutationObserver(processAll)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    // 縮圖常常是延遲載入（src/style 之後才填），attribute 變動也要重評
    attributes: true,
    attributeFilter: ['src', 'style', 'data-src'],
  })
  processAll()
}
