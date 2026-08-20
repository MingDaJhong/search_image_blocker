/**
 * Popup 用：Vue composable + popup-only 的 mutators / 範本 / import / merge。
 *
 * Re-export blockList.ts 全部公開符號，App.vue 與 CategoryDetail.vue 可繼續
 * 從 '@/composables/useBlockList' 導入，無需區分檔案。
 *
 * Content script 應該直接從 '@/composables/blockList' 導入，避免把 Vue runtime
 * 與此處 popup-only 的程式碼打包進注入到每一頁的 content bundle。
 */
import { ref, watch } from 'vue'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  MAX_KEYWORD_LEN,
  MAX_LABEL_LEN,
  detectDefaultLocale,
  detectDefaultTheme,
  isValidKeyword,
  loadSettings,
  normalizeCategories,
  normalizeCategoryOrder,
  normalizeHideMode,
  saveSettings,
  seedDefaultAllowKeywords,
  seedDefaultCategories,
  type BlocklistSettings,
  type Category,
  type DefaultCategory,
  type Locale,
} from './blockList'

export * from './blockList'

export type AddKeywordResult = 'added' | 'duplicate' | 'empty' | 'too_long'

/** 批次貼上的結果統計，供 UI 一句話回報 */
export interface AddManyResult {
  added: number
  duplicate: number
  /** 空白或超過長度上限而被丟掉的 */
  skipped: number
}

/**
 * 把一段貼上的文字切成關鍵字清單。
 *
 * 分隔符同時吃換行、半形／全形逗號、頓號與分號 —— 使用者的來源可能是
 * 一行一個的清單，也可能是從別處複製的 `蜘蛛、蟑螂、蜈蚣`。要求他們先
 * 手動整理成單一格式，等於這個功能只解掉一半的麻煩。
 *
 * 只做切割與去重，長度／重複的判斷仍然交給 addKeyword —— 驗證規則有一份
 * 就好，不要在這裡長出第二套。
 */
export function parseBulkKeywords(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[\n\r,，、;；]+/)) {
    const keyword = raw.trim()
    if (!keyword || seen.has(keyword)) continue
    seen.add(keyword)
    out.push(keyword)
  }
  return out
}

/**
 * 把一批關鍵字灌進任何一個 `add` mutator，回傳統計。
 *
 * 拿 `add` 當參數而不是綁死某一份清單：自訂關鍵字、例外關鍵字、分類關鍵字
 * 三個呼叫點共用同一套邏輯（跟 KeywordSection.vue 的設計理由一樣）。
 */
export function addManyKeywords(
  text: string,
  add: (keyword: string) => AddKeywordResult,
): AddManyResult {
  const result: AddManyResult = { added: 0, duplicate: 0, skipped: 0 }
  for (const keyword of parseBulkKeywords(text)) {
    const outcome = add(keyword)
    if (outcome === 'added') result.added++
    else if (outcome === 'duplicate') result.duplicate++
    else result.skipped++
  }
  return result
}

/**
 * 預設範本：使用者可主動透過「+ 範本」按鈕加入，不會自動 seed。
 * 移出 DEFAULT_CATEGORIES 是為了降低 Chrome Web Store 審查風險
 * （血腥/醫療關鍵字 list 不再是首次安裝就啟用的策展內容）。
 */
export const PRESET_TEMPLATES: DefaultCategory[] = [
  {
    id: 'gore',
    label: { 'zh-TW': '血腥 / 暴力', en: 'Gore / Violence' },
    keywords: {
      'zh-TW': [
        '血腥', '血跡', '屍體', '屍塊', '解剖', '驗屍',
        '暴力', '兇殺', '謀殺', '虐殺', '酷刑',
        '死亡現場', '車禍現場', '命案現場',
        '斷肢', '截肢', '內臟', '器官摘除',
      ],
      en: [
        'gore', 'gory', 'blood gore', 'bloody', 'corpse', 'dead body',
        'autopsy', 'gruesome', 'mutilation', 'dismemberment',
        'decapitation', 'beheading', 'massacre', 'carnage',
        'torture', 'brutal violence', 'graphic violence', 'death scene',
        'crime scene', 'accident scene', 'severed',
      ],
    },
  },
  {
    id: 'medical',
    label: { 'zh-TW': '醫療 / 傷口', en: 'Medical / Wounds' },
    keywords: {
      'zh-TW': [
        '傷口', '潰瘍', '膿', '化膿', '膿包', '膿瘡', '結痂',
        '手術', '開刀', '縫合', '開放性傷口',
        '皮膚病', '濕疹', '牛皮癬', '汗皰疹', '香港腳', '癬',
        '青春痘', '粉刺', '黑頭', '酒糟鼻',
        '腫瘤', '癌症', '癤瘡', '疣', '肉芽',
        '壞疽', '壞死', '潰爛', '蜂窩性組織炎',
      ],
      en: [
        'wound', 'open wound', 'ulcer', 'pus', 'abscess',
        'boil', 'cyst', 'blister', 'scab', 'gangrene',
        'surgery', 'surgical incision', 'suture', 'stitches',
        'skin disease', 'eczema', 'psoriasis', 'rash', 'ringworm',
        'acne', 'pimple', 'blackhead', 'rosacea', 'wart',
        'tumor', 'carcinoma', 'melanoma', 'necrosis', 'cellulitis',
        'infection', 'festering', 'amputation',
      ],
    },
  },
]

/**
 * Vue composable：響應式設定 + 自動儲存
 */
export function useBlockList() {
  const settings = ref<BlocklistSettings>({
    ...DEFAULT_SETTINGS,
    blockTypes: { ...DEFAULT_SETTINGS.blockTypes },
    keywords: [...DEFAULT_SETTINGS.keywords],
    allowKeywords: [...DEFAULT_SETTINGS.allowKeywords],
    enabledCategories: [...DEFAULT_SETTINGS.enabledCategories],
    categoryOrder: [],
    customCategories: [],
  })
  const loaded = ref(false)
  const saveError = ref(false)

  loadSettings().then((s) => {
    settings.value = s
    loaded.value = true
  })

  watch(
    settings,
    (val) => {
      if (!loaded.value) return
      saveSettings(val).then((ok) => {
        saveError.value = !ok
      })
    },
    { deep: true, flush: 'sync' },
  )

  function addKeyword(keyword: string): AddKeywordResult {
    const trimmed = keyword.trim()
    if (!trimmed) return 'empty'
    if (trimmed.length > MAX_KEYWORD_LEN) return 'too_long'
    if (settings.value.keywords.includes(trimmed)) return 'duplicate'
    settings.value.keywords.push(trimmed)
    return 'added'
  }

  function removeKeyword(keyword: string) {
    settings.value.keywords = settings.value.keywords.filter((k) => k !== keyword)
  }

  function addAllowKeyword(keyword: string): AddKeywordResult {
    const trimmed = keyword.trim()
    if (!trimmed) return 'empty'
    if (trimmed.length > MAX_KEYWORD_LEN) return 'too_long'
    if (settings.value.allowKeywords.includes(trimmed)) return 'duplicate'
    settings.value.allowKeywords.push(trimmed)
    return 'added'
  }

  function removeAllowKeyword(keyword: string) {
    settings.value.allowKeywords = settings.value.allowKeywords.filter((k) => k !== keyword)
  }

  function addCategory(label: string): string {
    const trimmed = label.trim()
    if (!trimmed || trimmed.length > MAX_LABEL_LEN) return ''
    const id = `cat_${Date.now()}`
    settings.value.customCategories.push({ id, label: trimmed, keywords: [] })
    settings.value.categoryOrder.push(id)
    settings.value.enabledCategories.push(id)
    return id
  }

  function addCategoryFromPreset(presetId: string): string {
    const preset = PRESET_TEMPLATES.find((t) => t.id === presetId)
    if (!preset) return ''
    if (settings.value.customCategories.some((c) => c.id === preset.id)) return preset.id
    const locale = settings.value.locale
    settings.value.customCategories.push({
      id: preset.id,
      label: preset.label[locale],
      keywords: [...preset.keywords[locale]],
    })
    settings.value.categoryOrder.push(preset.id)
    settings.value.enabledCategories.push(preset.id)
    return preset.id
  }

  /**
   * 還原使用者誤刪的內建分類（insects / reptiles / parasites）。
   * 跟 addCategoryFromPreset 對稱，但讀的是 DEFAULT_CATEGORIES。
   */
  function addCategoryFromDefault(defaultId: string): string {
    const def = DEFAULT_CATEGORIES.find((d) => d.id === defaultId)
    if (!def) return ''
    if (settings.value.customCategories.some((c) => c.id === def.id)) return def.id
    const locale = settings.value.locale
    settings.value.customCategories.push({
      id: def.id,
      label: def.label[locale],
      keywords: [...def.keywords[locale]],
    })
    settings.value.categoryOrder.push(def.id)
    settings.value.enabledCategories.push(def.id)
    return def.id
  }

  function removeCategory(id: string) {
    settings.value.customCategories = settings.value.customCategories.filter((c) => c.id !== id)
    settings.value.categoryOrder = settings.value.categoryOrder.filter((i) => i !== id)
    settings.value.enabledCategories = settings.value.enabledCategories.filter((i) => i !== id)
  }

  function setCatLabel(id: string, label: string) {
    const cat = settings.value.customCategories.find((c) => c.id === id)
    if (!cat) return
    const trimmed = label.trim()
    if (trimmed && trimmed.length <= MAX_LABEL_LEN) cat.label = trimmed
  }

  function addCatKeyword(id: string, keyword: string): AddKeywordResult {
    const cat = settings.value.customCategories.find((c) => c.id === id)
    if (!cat) return 'empty'
    const trimmed = keyword.trim()
    if (!trimmed) return 'empty'
    if (trimmed.length > MAX_KEYWORD_LEN) return 'too_long'
    if (cat.keywords.includes(trimmed)) return 'duplicate'
    cat.keywords.push(trimmed)
    return 'added'
  }

  function removeCatKeyword(id: string, keyword: string) {
    const cat = settings.value.customCategories.find((c) => c.id === id)
    if (!cat) return
    cat.keywords = cat.keywords.filter((k) => k !== keyword)
  }

  return {
    settings,
    loaded,
    saveError,
    addKeyword,
    removeKeyword,
    addAllowKeyword,
    removeAllowKeyword,
    addCategory,
    addCategoryFromPreset,
    addCategoryFromDefault,
    removeCategory,
    setCatLabel,
    addCatKeyword,
    removeCatKeyword,
  }
}

/**
 * 解析並正規化匯入的 JSON 字串，成功回傳 BlocklistSettings，失敗回傳 null。
 * 接受 { version: 1, settings: {...} } 包裝格式，或裸的設定物件（向後相容）。
 */
export function parseImport(jsonStr: string): BlocklistSettings | null {
  try {
    const data = JSON.parse(jsonStr) as Record<string, unknown>
    if (!data || typeof data !== 'object') return null

    const raw = (
      data.version === 1 && data.settings && typeof data.settings === 'object'
        ? data.settings
        : data
    ) as Record<string, unknown>

    const locale: Locale =
      raw.locale === 'zh-TW' || raw.locale === 'en' ? raw.locale : detectDefaultLocale()

    let categories = normalizeCategories(raw.customCategories)
    if (categories.length === 0) {
      categories = seedDefaultCategories(locale)
    }
    const categoryIds = categories.map((c) => c.id)
    const enabledCategories = Array.isArray(raw.enabledCategories)
      ? (raw.enabledCategories as unknown[]).filter((id): id is string => typeof id === 'string')
      : [...DEFAULT_SETTINGS.enabledCategories]

    return {
      paused: typeof raw.paused === 'boolean' ? raw.paused : false,
      globalBlock: typeof raw.globalBlock === 'boolean' ? raw.globalBlock : DEFAULT_SETTINGS.globalBlock,
      hideMode: normalizeHideMode(raw.hideMode),
      blockTypes: {
        ...DEFAULT_SETTINGS.blockTypes,
        ...(raw.blockTypes && typeof raw.blockTypes === 'object'
          ? (raw.blockTypes as Partial<BlocklistSettings['blockTypes']>)
          : {}),
      },
      keywords: Array.isArray(raw.keywords)
        ? (raw.keywords as unknown[]).filter(isValidKeyword)
        : [...DEFAULT_SETTINGS.keywords],
      // 與 loadSettings 同一套遷移規則：舊版備份檔沒有這個欄位 → 帶入內建例外
      allowKeywords: Array.isArray(raw.allowKeywords)
        ? (raw.allowKeywords as unknown[]).filter(isValidKeyword)
        : seedDefaultAllowKeywords(locale),
      enabledCategories,
      categoryOrder: normalizeCategoryOrder(raw.categoryOrder, categoryIds),
      customCategories: categories,
      perResultBlock:
        typeof raw.perResultBlock === 'boolean'
          ? raw.perResultBlock
          : DEFAULT_SETTINGS.perResultBlock,
      pageIndicator:
        typeof raw.pageIndicator === 'boolean' ? raw.pageIndicator : DEFAULT_SETTINGS.pageIndicator,
      locale,
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : detectDefaultTheme(),
    }
  } catch {
    return null
  }
}

/**
 * 把 imported 設定合併到 current 上：
 * - 自訂關鍵字 / 例外關鍵字 / 啟用分類：取聯集（去重）
 * - customCategories：以 id 為 key 合併；同 id 者保留現有 label，keywords 取聯集
 * - categoryOrder：保留現有順序，新增 id 補在尾端
 * - paused / globalBlock / hideMode / blockTypes / perResultBlock / pageIndicator / locale / theme：保留現有
 *
 * 設計理念：使用者匯入別人分享的關鍵字組合時，「個人偏好（語系、主題、UI 開關）」
 * 應該維持不變，只把對方的「黑名單內容」融入。
 */
export function mergeSettings(
  current: BlocklistSettings,
  imported: BlocklistSettings,
): BlocklistSettings {
  const keywords = Array.from(new Set([...current.keywords, ...imported.keywords]))
  const allowKeywords = Array.from(
    new Set([...current.allowKeywords, ...imported.allowKeywords]),
  )

  const byId = new Map<string, Category>()
  for (const c of current.customCategories) {
    byId.set(c.id, { ...c, keywords: [...c.keywords] })
  }
  for (const c of imported.customCategories) {
    const existing = byId.get(c.id)
    if (existing) {
      existing.keywords = Array.from(new Set([...existing.keywords, ...c.keywords]))
    } else {
      byId.set(c.id, { ...c, keywords: [...c.keywords] })
    }
  }
  const customCategories = Array.from(byId.values())

  const currentIds = new Set(current.categoryOrder)
  const newIds = customCategories.map((c) => c.id).filter((id) => !currentIds.has(id))
  const categoryOrder = [
    ...current.categoryOrder.filter((id) => byId.has(id)),
    ...newIds,
  ]

  const enabledCategories = Array.from(
    new Set([...current.enabledCategories, ...imported.enabledCategories]),
  ).filter((id) => byId.has(id))

  return {
    paused: current.paused,
    globalBlock: current.globalBlock,
    hideMode: current.hideMode,
    blockTypes: { ...current.blockTypes },
    keywords,
    allowKeywords,
    customCategories,
    categoryOrder,
    enabledCategories,
    perResultBlock: current.perResultBlock,
    pageIndicator: current.pageIndicator,
    locale: current.locale,
    theme: current.theme,
  }
}
