import { ref, watch } from 'vue'
import { browser } from 'wxt/browser'

export type Locale = 'zh-TW' | 'en'
export type Theme = 'light' | 'dark'

export interface BlocklistSettings {
  /** 暫停所有封鎖（不改任何設定，只是暫時停用） */
  paused: boolean
  /** 啟用全域阻擋（不論關鍵字都隱藏） */
  globalBlock: boolean
  /** 要隱藏哪些區塊類型 */
  blockTypes: {
    images: boolean
    videos: boolean
    relatedQuestions: boolean
    knowledgePanel: boolean
    /** 搜尋框 autocomplete 下拉建議裡的縮圖 */
    searchPreview: boolean
  }
  /** 使用者自訂的觸發關鍵字 */
  keywords: string[]
  /** 已啟用的分類包 ID */
  enabledCategories: string[]
  /** 分類包顯示順序（ID 陣列，可被使用者拖曳改變） */
  categoryOrder: string[]
  /** 所有觸發分類（內建預設與使用者新增都存這裡，可自由刪除） */
  customCategories: Category[]
  /** popup 顯示語系 */
  locale: Locale
  /** popup 主題 */
  theme: Theme
}

export interface Category {
  id: string
  label: string
  keywords: string[]
}

/** 內建預設分類（僅作為首次安裝的 seed 資料，不作為執行時判斷依據） */
interface DefaultCategory {
  id: string
  label: Record<Locale, string>
  keywords: Record<Locale, string[]>
}

const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    id: 'insects',
    label: { 'zh-TW': '昆蟲 / 節肢動物', en: 'Insects / Arthropods' },
    keywords: {
      'zh-TW': [
        '昆蟲', '蟲', '蝴蝶', '蛾', '飛蛾',
        '蜘蛛', '蜜蜂', '黃蜂', '虎頭蜂', '胡蜂',
        '螞蟻', '白蟻', '蟑螂', '蜈蚣', '馬陸',
        '蠍子', '甲蟲', '瓢蟲', '蟬', '螳螂',
        '蒼蠅', '蚊子', '跳蚤', '蝨子', '塵蟎',
        '毛毛蟲', '蛆', '蚯蚓', '水蛭', '蝸牛', '蛞蝓',
      ],
      en: [
        'insect', 'bug', 'spider', 'cockroach', 'centipede',
        'beetle', 'wasp', 'mosquito', 'maggot', 'larva',
        'butterfly', 'moth', 'bee', 'hornet', 'ant',
        'termite', 'flea', 'louse', 'mite', 'dust mite',
        'caterpillar', 'worm', 'earthworm', 'leech', 'snail',
        'slug', 'scorpion', 'mantis', 'cicada', 'millipede',
        'earwig', 'tick', 'weevil', 'locust', 'aphid',
      ],
    },
  },
  {
    id: 'reptiles',
    label: { 'zh-TW': '爬蟲 / 兩棲類', en: 'Reptiles / Amphibians' },
    keywords: {
      'zh-TW': [
        '蛇', '蟒蛇', '眼鏡蛇', '響尾蛇', '毒蛇', '青竹絲', '百步蛇',
        '蜥蜴', '壁虎', '變色龍', '鬣蜥', '科莫多龍',
        '青蛙', '蟾蜍', '蝌蚪', '蠑螈', '山椒魚',
        '鱷魚', '烏龜', '甲魚', '海龜',
      ],
      en: [
        'snake', 'cobra', 'python', 'rattlesnake', 'viper',
        'boa', 'mamba', 'cottonmouth', 'copperhead', 'anaconda',
        'lizard', 'gecko', 'chameleon', 'iguana', 'komodo',
        'frog', 'toad', 'tadpole', 'salamander', 'newt',
        'crocodile', 'alligator', 'caiman', 'turtle', 'tortoise',
      ],
    },
  },
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
        'gore', 'gory', 'blood', 'bloody', 'corpse', 'dead body',
        'autopsy', 'gruesome', 'mutilation', 'dismemberment',
        'decapitation', 'beheading', 'massacre', 'carnage',
        'torture', 'brutal', 'graphic violence', 'death scene',
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
  {
    id: 'parasites',
    label: { 'zh-TW': '寄生蟲', en: 'Parasites' },
    keywords: {
      'zh-TW': [
        '寄生蟲', '蛔蟲', '蟯蟲', '絛蟲', '鉤蟲',
        '線蟲', '吸蟲', '蟯蟲感染', '蟲卵', '幼蟲',
        '疥瘡', '蠕形蟎', '弓蟲', '梨形鞭毛蟲',
      ],
      en: [
        'parasite', 'tapeworm', 'roundworm', 'hookworm', 'pinworm',
        'threadworm', 'fluke', 'nematode', 'heartworm',
        'intestinal worm', 'parasitic infection', 'infestation',
        'scabies', 'demodex', 'toxoplasma', 'giardia',
        'parasite eggs', 'worm infestation',
      ],
    },
  },
]

export const STORAGE_KEY = 'sib_settings'

function detectDefaultTheme(): Theme {
  if (typeof matchMedia === 'undefined') return 'light'
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function detectDefaultLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-TW'
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en'
}

/** 從 DEFAULT_CATEGORIES 依指定 locale seed 出初始 categories */
function seedDefaultCategories(locale: Locale): Category[] {
  return DEFAULT_CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label[locale],
    keywords: [...cat.keywords[locale]],
  }))
}

function normalizeCategories(stored: unknown): Category[] {
  if (!Array.isArray(stored)) return []
  return stored
    .filter(
      (c): c is Category =>
        c !== null &&
        typeof c === 'object' &&
        typeof (c as Record<string, unknown>).id === 'string' &&
        typeof (c as Record<string, unknown>).label === 'string' &&
        Array.isArray((c as Record<string, unknown>).keywords),
    )
    .map((c) => ({
      id: c.id,
      label: c.label,
      keywords: (c.keywords as unknown[]).filter((k): k is string => typeof k === 'string'),
    }))
}

/**
 * 把 stored 的順序與現有 categories 對齊：
 * 過濾掉已刪除的 ID，把新增的補在最後。
 */
function normalizeCategoryOrder(stored: unknown, categoryIds: string[]): string[] {
  const idSet = new Set(categoryIds)
  const fromStored = Array.isArray(stored)
    ? stored.filter((s): s is string => typeof s === 'string' && idSet.has(s))
    : []
  const seen = new Set(fromStored)
  for (const id of categoryIds) {
    if (!seen.has(id)) fromStored.push(id)
  }
  return fromStored
}

export const DEFAULT_SETTINGS: BlocklistSettings = {
  paused: false,
  globalBlock: false,
  blockTypes: {
    images: true,
    videos: true,
    relatedQuestions: false,
    knowledgePanel: false,
    searchPreview: true,
  },
  keywords: [],
  enabledCategories: ['insects'],
  categoryOrder: [],
  customCategories: [],
  locale: 'zh-TW',
  theme: 'light',
}

/**
 * 從 chrome.storage 讀取設定。
 *
 * 首次安裝（或 customCategories 為空的舊版本遷移）時，依偵測到的 locale
 * 從 DEFAULT_CATEGORIES seed 出初始分類。舊版 categoryOverrides 若存在也
 * 一併套用（label/keywords 覆蓋），確保現有使用者自訂不遺失。
 */
export async function loadSettings(): Promise<BlocklistSettings> {
  try {
    const result = await browser.storage.sync.get(STORAGE_KEY)
    const raw = (result[STORAGE_KEY] ?? {}) as Record<string, unknown>

    const locale: Locale =
      raw.locale === 'zh-TW' || raw.locale === 'en' ? raw.locale : detectDefaultLocale()

    let categories = normalizeCategories(raw.customCategories)

    if (categories.length === 0) {
      // 首次安裝或舊版遷移：seed 預設分類並套用舊 categoryOverrides
      const overrides = readLegacyOverrides(raw.categoryOverrides)
      categories = seedDefaultCategories(locale).map((cat) => {
        const ov = overrides[cat.id]
        return {
          id: cat.id,
          label: ov?.label ?? cat.label,
          keywords: ov?.keywords ?? cat.keywords,
        }
      })
    }

    const categoryIds = categories.map((c) => c.id)
    const enabledCategories = Array.isArray(raw.enabledCategories)
      ? (raw.enabledCategories as unknown[]).filter((id): id is string => typeof id === 'string')
      : [...DEFAULT_SETTINGS.enabledCategories]

    return {
      paused: typeof raw.paused === 'boolean' ? raw.paused : false,
      globalBlock: typeof raw.globalBlock === 'boolean' ? raw.globalBlock : DEFAULT_SETTINGS.globalBlock,
      blockTypes: {
        ...DEFAULT_SETTINGS.blockTypes,
        ...(raw.blockTypes && typeof raw.blockTypes === 'object'
          ? (raw.blockTypes as Partial<BlocklistSettings['blockTypes']>)
          : {}),
      },
      keywords: Array.isArray(raw.keywords)
        ? (raw.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
        : [...DEFAULT_SETTINGS.keywords],
      enabledCategories,
      categoryOrder: normalizeCategoryOrder(raw.categoryOrder, categoryIds),
      customCategories: categories,
      locale,
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : detectDefaultTheme(),
    }
  } catch (e) {
    console.error('[SIB] Failed to load settings:', e)
    const locale = detectDefaultLocale()
    const categories = seedDefaultCategories(locale)
    return {
      ...DEFAULT_SETTINGS,
      keywords: [...DEFAULT_SETTINGS.keywords],
      enabledCategories: [...DEFAULT_SETTINGS.enabledCategories],
      categoryOrder: categories.map((c) => c.id),
      customCategories: categories,
      locale,
      theme: detectDefaultTheme(),
    }
  }
}

/** 讀取舊版 categoryOverrides，僅用於遷移 */
function readLegacyOverrides(
  stored: unknown,
): Record<string, { label?: string; keywords?: string[] }> {
  const out: Record<string, { label?: string; keywords?: string[] }> = {}
  if (!stored || typeof stored !== 'object') return out
  for (const [id, raw] of Object.entries(stored as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as { label?: unknown; keywords?: unknown }
    const entry: { label?: string; keywords?: string[] } = {}
    if (typeof r.label === 'string') entry.label = r.label
    if (Array.isArray(r.keywords)) {
      entry.keywords = r.keywords.filter((k): k is string => typeof k === 'string')
    }
    if (entry.label !== undefined || entry.keywords !== undefined) out[id] = entry
  }
  return out
}

/**
 * 儲存設定到 chrome.storage。
 * 透過 JSON 來回拆掉 Vue 的 reactive Proxy，避免 structured clone 把陣列
 * 降級成 {0:..., 1:...} 物件。
 */
export async function saveSettings(settings: BlocklistSettings): Promise<boolean> {
  const plain = JSON.parse(JSON.stringify(settings)) as BlocklistSettings
  try {
    await browser.storage.sync.set({ [STORAGE_KEY]: plain })
    return true
  } catch (e) {
    console.error('[SIB] Failed to save settings (quota exceeded?):', e)
    return false
  }
}

/**
 * Vue composable：響應式設定 + 自動儲存
 */
export function useBlockList() {
  const settings = ref<BlocklistSettings>({
    ...DEFAULT_SETTINGS,
    blockTypes: { ...DEFAULT_SETTINGS.blockTypes },
    keywords: [...DEFAULT_SETTINGS.keywords],
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

  function addKeyword(keyword: string) {
    const trimmed = keyword.trim()
    if (!trimmed) return
    if (settings.value.keywords.includes(trimmed)) return
    settings.value.keywords.push(trimmed)
  }

  function removeKeyword(keyword: string) {
    settings.value.keywords = settings.value.keywords.filter((k) => k !== keyword)
  }

  function addCategory(label: string): string {
    const trimmed = label.trim()
    if (!trimmed) return ''
    const id = `cat_${Date.now()}`
    settings.value.customCategories.push({ id, label: trimmed, keywords: [] })
    settings.value.categoryOrder.push(id)
    settings.value.enabledCategories.push(id)
    return id
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
    if (trimmed) cat.label = trimmed
  }

  function addCatKeyword(id: string, keyword: string) {
    const cat = settings.value.customCategories.find((c) => c.id === id)
    if (!cat) return
    const trimmed = keyword.trim()
    if (!trimmed || cat.keywords.includes(trimmed)) return
    cat.keywords.push(trimmed)
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
    addCategory,
    removeCategory,
    setCatLabel,
    addCatKeyword,
    removeCatKeyword,
  }
}

/**
 * 判斷搜尋關鍵字是否命中黑名單
 */
export function shouldBlock(query: string, settings: BlocklistSettings): boolean {
  if (settings.paused) return false
  if (settings.globalBlock) return true
  const lower = query.toLowerCase()
  if (settings.keywords.some((k) => lower.includes(k.toLowerCase()))) return true
  for (const catId of settings.enabledCategories) {
    const cat = settings.customCategories.find((c) => c.id === catId)
    if (cat && cat.keywords.some((k) => lower.includes(k.toLowerCase()))) return true
  }
  return false
}

/**
 * 回傳第一個命中的關鍵字與其分類名稱（供 UI 顯示阻擋原因）。
 * globalBlock 時 keyword 為空字串、categoryLabel 為 null。
 * 自訂關鍵字命中時 categoryLabel 為 null。
 * 未命中時回傳 null。
 */
export function findBlockMatch(
  query: string,
  settings: BlocklistSettings,
): { keyword: string; categoryLabel: string | null } | null {
  if (!shouldBlock(query, settings)) return null
  if (settings.globalBlock) return { keyword: '', categoryLabel: null }
  const lower = query.toLowerCase()
  for (const k of settings.keywords) {
    if (lower.includes(k.toLowerCase())) return { keyword: k, categoryLabel: null }
  }
  for (const catId of settings.enabledCategories) {
    const cat = settings.customCategories.find((c) => c.id === catId)
    if (!cat) continue
    for (const k of cat.keywords) {
      if (lower.includes(k.toLowerCase())) return { keyword: k, categoryLabel: cat.label }
    }
  }
  return null
}
