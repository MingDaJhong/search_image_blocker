import { ref, watch } from 'vue'
import { browser } from 'wxt/browser'

export type Locale = 'zh-TW' | 'en'
export type Theme = 'light' | 'dark'

export interface BlocklistSettings {
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
  /** 已啟用的分類包 ID（對應 CATEGORIES） */
  enabledCategories: string[]
  /** 分類包顯示順序（ID 陣列，可被使用者拖曳改變） */
  categoryOrder: string[]
  /**
   * 使用者對 CATEGORIES 的覆蓋。key 是 category id。
   * - label 一旦設定就忽略 locale（使用者是針對自己的語境改的）。
   * - keywords 若存在就完全取代預設 keywords。
   */
  categoryOverrides: Record<string, CategoryOverride>
  /** popup 顯示語系 */
  locale: Locale
  /** popup 主題 */
  theme: Theme
}

export interface CategoryOverride {
  label?: string
  keywords?: string[]
}

export interface KeywordCategory {
  id: string
  label: Record<Locale, string>
  description: Record<Locale, string>
  keywords: string[]
}

/**
 * 預設策展的分類包。新增分類就加在這裡，popup UI 會自動帶出。
 * 關鍵字比對是 substring（不分大小寫），所以「蟲」會命中「昆蟲」「毛毛蟲」等。
 */
export const CATEGORIES: KeywordCategory[] = [
  {
    id: 'insects',
    label: { 'zh-TW': '昆蟲 / 節肢動物', en: 'Insects / Arthropods' },
    description: { 'zh-TW': '蟲類、蜘蛛、蜈蚣等', en: 'Bugs, spiders, centipedes, etc.' },
    keywords: [
      '昆蟲', '蟲', '蝴蝶', '蛾', '飛蛾',
      '蜘蛛', '蜜蜂', '黃蜂', '虎頭蜂', '胡蜂',
      '螞蟻', '白蟻', '蟑螂', '蜈蚣', '馬陸',
      '蠍子', '甲蟲', '瓢蟲', '蟬', '螳螂',
      '蒼蠅', '蚊子', '跳蚤', '蝨子', '塵蟎',
      '毛毛蟲', '蛆', '蚯蚓', '水蛭', '蝸牛', '蛞蝓',
      'insect', 'bug', 'spider', 'cockroach', 'centipede',
      'beetle', 'wasp', 'mosquito', 'maggot', 'larva',
    ],
  },
  {
    id: 'reptiles',
    label: { 'zh-TW': '爬蟲 / 兩棲類', en: 'Reptiles / Amphibians' },
    description: { 'zh-TW': '蛇、蜥蜴、青蛙等', en: 'Snakes, lizards, frogs, etc.' },
    keywords: [
      '蛇', '蟒蛇', '眼鏡蛇', '響尾蛇', '毒蛇',
      '蜥蜴', '壁虎', '變色龍', '鬣蜥',
      '青蛙', '蟾蜍', '蝌蚪',
      '鱷魚', '烏龜', '甲魚',
      'snake', 'cobra', 'python', 'lizard', 'gecko',
      'frog', 'toad', 'crocodile',
    ],
  },
  {
    id: 'gore',
    label: { 'zh-TW': '血腥 / 暴力', en: 'Gore / Violence' },
    description: { 'zh-TW': '血腥、屍體、戰爭等', en: 'Blood, corpses, war, etc.' },
    keywords: [
      '血腥', '屍體', '屍塊', '解剖',
      '戰爭', '暴力', '兇殺', '謀殺',
      '酷刑', '死亡', '車禍現場',
      'gore', 'blood', 'corpse', 'autopsy', 'gruesome',
    ],
  },
  {
    id: 'medical',
    label: { 'zh-TW': '醫療 / 傷口', en: 'Medical / Wounds' },
    description: { 'zh-TW': '傷口、皮膚病、手術等', en: 'Wounds, skin conditions, surgery, etc.' },
    keywords: [
      '傷口', '潰瘍', '膿', '化膿', '結痂',
      '手術', '開刀', '縫合', '注射',
      '皮膚病', '濕疹', '牛皮癬', '汗皰疹', '香港腳',
      '青春痘', '粉刺', '黑頭', '酒糟',
      '癌症', '腫瘤', '癤瘡', '疣',
      'wound', 'surgery', 'tumor', 'eczema', 'acne', 'rash',
    ],
  },
  {
    id: 'parasites',
    label: { 'zh-TW': '寄生蟲', en: 'Parasites' },
    description: { 'zh-TW': '寄生蟲、蟲卵、感染', en: 'Parasites, eggs, infections' },
    keywords: [
      '寄生蟲', '蛔蟲', '蟯蟲', '絛蟲', '鉤蟲',
      '線蟲', '蟲卵', '幼蟲',
      'parasite', 'tapeworm', 'roundworm', 'hookworm',
    ],
  },
]

const STORAGE_KEY = 'sib_settings'

/**
 * 偵測 OS 偏好的 dark/light（loadSettings 沒有儲存值時使用）。
 * matchMedia 在 service worker 不可用，用 typeof 防呆。
 */
function detectDefaultTheme(): Theme {
  if (typeof matchMedia === 'undefined') return 'light'
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 偵測預設語系（瀏覽器 navigator.language 開頭含 zh 就用繁中）
 */
function detectDefaultLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-TW'
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en'
}

export const DEFAULT_SETTINGS: BlocklistSettings = {
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
  categoryOrder: CATEGORIES.map((c) => c.id),
  categoryOverrides: {},
  // 這兩個欄位的預設值在 loadSettings 動態決定，這裡的值只當作型別填補
  locale: 'zh-TW',
  theme: 'light',
}

/**
 * 把 stored 的順序與目前 CATEGORIES 對齊：
 * - 過濾掉已不存在的 ID（CATEGORIES 拿掉某分類時）
 * - 把新出現的 ID 補在最後（CATEGORIES 新增分類時）
 * 確保 categoryOrder 永遠剛好等於現存所有 category id 的某個 permutation。
 */
function normalizeCategoryOrder(stored: unknown): string[] {
  const allIds = CATEGORIES.map((c) => c.id)
  const fromStored = Array.isArray(stored)
    ? stored.filter((s): s is string => typeof s === 'string' && allIds.includes(s))
    : []
  const seen = new Set(fromStored)
  for (const id of allIds) {
    if (!seen.has(id)) fromStored.push(id)
  }
  return fromStored
}

/**
 * 對 categoryOverrides 做型別防呆，並過濾不認識的 category id。
 */
function normalizeCategoryOverrides(stored: unknown): Record<string, CategoryOverride> {
  const allIds = new Set(CATEGORIES.map((c) => c.id))
  const out: Record<string, CategoryOverride> = {}
  if (!stored || typeof stored !== 'object') return out
  for (const [id, raw] of Object.entries(stored as Record<string, unknown>)) {
    if (!allIds.has(id) || !raw || typeof raw !== 'object') continue
    const r = raw as { label?: unknown; keywords?: unknown }
    const entry: CategoryOverride = {}
    if (typeof r.label === 'string') entry.label = r.label
    if (Array.isArray(r.keywords)) {
      entry.keywords = r.keywords.filter((k): k is string => typeof k === 'string')
    }
    if (entry.label !== undefined || entry.keywords !== undefined) out[id] = entry
  }
  return out
}

/**
 * 從 chrome.storage 讀取設定。
 * 對每個欄位做型別正規化 — 之前版本曾因 v-model 把 enabledCategories 寫成 boolean，
 * 這層保護同時自我修復壞資料（下一次 watch 觸發 saveSettings 就會覆蓋掉）。
 */
export async function loadSettings(): Promise<BlocklistSettings> {
  try {
    const result = await browser.storage.sync.get(STORAGE_KEY)
    const stored = (result[STORAGE_KEY] ?? {}) as Partial<BlocklistSettings>
    return {
      globalBlock: typeof stored.globalBlock === 'boolean' ? stored.globalBlock : DEFAULT_SETTINGS.globalBlock,
      blockTypes: { ...DEFAULT_SETTINGS.blockTypes, ...(stored.blockTypes ?? {}) },
      keywords: Array.isArray(stored.keywords) ? stored.keywords : [...DEFAULT_SETTINGS.keywords],
      enabledCategories: Array.isArray(stored.enabledCategories)
        ? stored.enabledCategories
        : [...DEFAULT_SETTINGS.enabledCategories],
      categoryOrder: normalizeCategoryOrder(stored.categoryOrder),
      categoryOverrides: normalizeCategoryOverrides(stored.categoryOverrides),
      locale: stored.locale === 'zh-TW' || stored.locale === 'en' ? stored.locale : detectDefaultLocale(),
      theme: stored.theme === 'light' || stored.theme === 'dark' ? stored.theme : detectDefaultTheme(),
    }
  } catch (e) {
    console.error('[SIB] Failed to load settings:', e)
    return {
      ...DEFAULT_SETTINGS,
      keywords: [...DEFAULT_SETTINGS.keywords],
      enabledCategories: [...DEFAULT_SETTINGS.enabledCategories],
      categoryOrder: [...DEFAULT_SETTINGS.categoryOrder],
      categoryOverrides: {},
    }
  }
}

/**
 * 儲存設定到 chrome.storage。
 * 透過 JSON 來回拆掉 Vue 的 reactive Proxy — 否則 structured clone 認不出
 * Proxy<Array>，會把陣列降級存成 `{0: ..., 1: ...}` 物件，下次 loadSettings
 * 就無法復原。
 */
export async function saveSettings(settings: BlocklistSettings): Promise<void> {
  const plain = JSON.parse(JSON.stringify(settings)) as BlocklistSettings
  await browser.storage.sync.set({ [STORAGE_KEY]: plain })
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
    categoryOrder: [...DEFAULT_SETTINGS.categoryOrder],
    categoryOverrides: {},
  })
  const loaded = ref(false)

  loadSettings().then((s) => {
    settings.value = s
    loaded.value = true
  })

  watch(
    settings,
    (val) => {
      if (loaded.value) saveSettings(val)
    },
    { deep: true, flush: 'sync' }
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

  function ensureOverride(catId: string): CategoryOverride {
    if (!settings.value.categoryOverrides[catId]) {
      settings.value.categoryOverrides[catId] = {}
    }
    return settings.value.categoryOverrides[catId]
  }

  function setCategoryLabel(catId: string, label: string) {
    const cat = CATEGORIES.find((c) => c.id === catId)
    if (!cat) return
    const trimmed = label.trim()
    const entry = ensureOverride(catId)
    // 跟任何 locale 預設一致就移除 override（保持資料乾淨並讓未來預設更新可生效）
    const isDefault = (Object.values(cat.label) as string[]).includes(trimmed)
    if (!trimmed || isDefault) {
      delete entry.label
    } else {
      entry.label = trimmed
    }
    if (entry.label === undefined && entry.keywords === undefined) {
      delete settings.value.categoryOverrides[catId]
    }
  }

  function addCategoryKeyword(catId: string, keyword: string) {
    const cat = CATEGORIES.find((c) => c.id === catId)
    if (!cat) return
    const trimmed = keyword.trim()
    if (!trimmed) return
    const entry = ensureOverride(catId)
    const list = entry.keywords ?? [...cat.keywords]
    if (list.includes(trimmed)) return
    list.push(trimmed)
    entry.keywords = list
  }

  function removeCategoryKeyword(catId: string, keyword: string) {
    const cat = CATEGORIES.find((c) => c.id === catId)
    if (!cat) return
    const entry = ensureOverride(catId)
    const list = entry.keywords ?? [...cat.keywords]
    entry.keywords = list.filter((k) => k !== keyword)
  }

  return {
    settings,
    loaded,
    addKeyword,
    removeKeyword,
    setCategoryLabel,
    addCategoryKeyword,
    removeCategoryKeyword,
  }
}

/**
 * 解析分類在當前 settings/locale 下的最終 label（有 override 用 override，否則用 locale 預設）
 */
export function getCategoryLabel(cat: KeywordCategory, settings: BlocklistSettings): string {
  return settings.categoryOverrides[cat.id]?.label ?? cat.label[settings.locale]
}

/**
 * 解析分類的最終 keywords 列表（有 override 用 override，否則用預設）
 */
export function getCategoryKeywords(cat: KeywordCategory, settings: BlocklistSettings): string[] {
  return settings.categoryOverrides[cat.id]?.keywords ?? cat.keywords
}

/**
 * 判斷搜尋關鍵字是否命中黑名單
 */
export function shouldBlock(query: string, settings: BlocklistSettings): boolean {
  if (settings.globalBlock) return true
  const lower = query.toLowerCase()
  if (settings.keywords.some((k) => lower.includes(k.toLowerCase()))) return true
  for (const catId of settings.enabledCategories) {
    const cat = CATEGORIES.find((c) => c.id === catId)
    if (!cat) continue
    const kws = getCategoryKeywords(cat, settings)
    if (kws.some((k) => lower.includes(k.toLowerCase()))) return true
  }
  return false
}
