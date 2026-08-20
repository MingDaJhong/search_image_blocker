/**
 * 純資料層 + storage I/O：types、預設值、loadSettings / saveSettings、shouldBlock。
 *
 * 這個檔案不依賴 Vue。Content script 只 import 此檔，避免把 popup composable
 * 與 PRESET_TEMPLATES 等 popup-only 的東西打包進注入到每一頁的 content bundle。
 *
 * Popup 由 useBlockList.ts 統一 re-export 與擴充，App.vue / CategoryDetail.vue
 * 仍從 useBlockList 導入，無需改 import 路徑。
 */
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
    /** 搜尋結果列表裡每一筆的縮圖 */
    thumbnails: boolean
    videos: boolean
    relatedQuestions: boolean
    knowledgePanel: boolean
    /** 搜尋框 autocomplete 下拉建議裡的縮圖 */
    searchPreview: boolean
    /** 圖片分頁頂端篩選列（相關搜尋 chips）的縮圖 */
    imageFilterBar: boolean
  }
  /** 使用者自訂的觸發關鍵字 */
  keywords: string[]
  /**
   * 例外關鍵字：命中的查詢一律放行，優先於 keywords / 分類。
   * 首次安裝時依 locale 由 seedDefaultAllowKeywords() 帶入一份策展清單。
   */
  allowKeywords: string[]
  /** 已啟用的分類包 ID */
  enabledCategories: string[]
  /** 分類包顯示順序（ID 陣列，可被使用者拖曳改變） */
  categoryOrder: string[]
  /** 所有觸發分類（內建預設與使用者新增都存這裡，可自由刪除） */
  customCategories: Category[]
  /**
   * 搜尋字沒命中時，改逐筆檢查搜尋結果的文字，只隱藏命中那一筆的圖片。
   *
   * 補的是 query 層級阻擋的盲點：搜「我家牆上這是什麼」時 query 一個關鍵字
   * 都不會命中，但結果標題全是「蜘蛛」—— 那正是最需要保護的時刻。
   * 與 query 層級疊加，不取代。
   */
  perResultBlock: boolean
  /**
   * 在搜尋頁左下角顯示封鎖提示（隱藏了幾個區塊、命中哪個關鍵字、一鍵本頁顯示）。
   * 預設開啟 —— 這個功能存在的意義就是讓阻擋不再無聲，預設關掉等於沒做。
   */
  pageIndicator: boolean
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

/** 雙語 seed 資料的形狀，給 DEFAULT_CATEGORIES 與 PRESET_TEMPLATES 共用 */
export interface DefaultCategory {
  id: string
  label: Record<Locale, string>
  keywords: Record<Locale, string[]>
}

export const STORAGE_KEY = 'sib_settings'
export const MAX_KEYWORD_LEN = 50
export const MAX_LABEL_LEN = 30

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
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
        'insect', 'stink bug', 'spider', 'cockroach', 'centipede',
        'beetle', 'wasp', 'mosquito', 'maggot', 'larva',
        'butterfly', 'moth', 'honeybee', 'bumblebee', 'hornet', 'fire ant',
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
        'snake', 'cobra', 'ball python', 'python snake', 'rattlesnake', 'viper',
        'boa', 'mamba', 'cottonmouth', 'copperhead', 'anaconda',
        'lizard', 'gecko lizard', 'chameleon', 'iguana', 'komodo',
        'frog', 'toad', 'tadpole', 'salamander', 'newt',
        'crocodile', 'alligator', 'caiman', 'turtle', 'tortoise',
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

export const DEFAULT_SETTINGS: BlocklistSettings = {
  paused: false,
  globalBlock: false,
  blockTypes: {
    images: true,
    thumbnails: true,
    videos: true,
    relatedQuestions: false,
    knowledgePanel: false,
    searchPreview: true,
    imageFilterBar: true,
  },
  keywords: [],
  allowKeywords: [],
  enabledCategories: ['insects'],
  categoryOrder: [],
  customCategories: [],
  perResultBlock: true,
  pageIndicator: true,
  locale: 'zh-TW',
  theme: 'light',
}

export function detectDefaultTheme(): Theme {
  if (typeof matchMedia === 'undefined') return 'light'
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function detectDefaultLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-TW'
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en'
}

/** 從 DEFAULT_CATEGORIES 依指定 locale seed 出初始 categories */
export function seedDefaultCategories(locale: Locale): Category[] {
  return DEFAULT_CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label[locale],
    keywords: [...cat.keywords[locale]],
  }))
}

/**
 * 內建例外關鍵字：常見的「字面上含有被擋關鍵字、但內容完全無關」的複合詞。
 *
 * 中文特別需要這個。matchKeyword 的詞邊界規則救得了拉丁字母（`moth` 不再命中
 * `mother`），但中文沒有詞邊界可用 —— `蛇` 一定會命中 `蛇年運勢`、`蟬` 一定會
 * 命中 `蟬聯冠軍`。唯一的解法就是列舉例外。
 *
 * 收錄標準（兩條都要成立）：
 *   1. 是常見查詢，不是冷僻詞
 *   2. 搜出來的圖片確實不會出現使用者想避開的東西
 * 已經被詞邊界規則擋掉的不收（例如 `beetlejuice`、`hard boiled` 本來就不會命中）。
 * `composables/blockList.test.ts` 有一條測試會擋下這種死條目。
 */
const DEFAULT_ALLOW_KEYWORDS: Record<Locale, string[]> = {
  'zh-TW': [
    '蟬聯', '蛇年', '蛇果', '蛇形', '蛇皮包', '打草驚蛇',
    '蟲洞', '甲蟲車', '螞蟻上樹',
    '蝴蝶結', '蝴蝶效應', '蝴蝶刀',
    '鱷魚牌', '鱷魚夾', '壁虎功', '烏龜車', '蝸牛霜', '蜈蚣辮',
    '響尾蛇飛彈', '蜘蛛人',
    '癌症險', '癌症保險', '腫瘤科', '手術費用', '手術同意書', '暴力美學',
  ],
  en: [
    'flea market', 'snake case', 'snake game',
    'spider chart', 'spider diagram', 'spider plot', 'spider solitaire', 'spider man',
    'feather boa', 'worm gear', 'vw beetle', 'tick tock',
    'charlotte hornets', 'dodge viper', 'cobra kai', 'mamba mentality',
    'turtle neck', 'snail mail', 'url slug', 'crocodile dundee', 'alligator clip',
    'wound up', 'boil water', 'rash decision', 'wart hog', 'blister pack',
    'in stitches', 'al gore', 'gore-tex', 'corpse bride', 'bloody mary',
  ],
}

/** 依 locale seed 出初始的例外關鍵字清單 */
export function seedDefaultAllowKeywords(locale: Locale): string[] {
  return [...DEFAULT_ALLOW_KEYWORDS[locale]]
}

/**
 * 儲存層的關鍵字過濾條件：必須是字串、去掉空白後非空、且不超長。
 *
 * 「非空」這條是必要的：空字串在任何 substring 比對下都會命中所有查詢，等於
 * 偷偷開啟全域阻擋。正常 UI 流程進不來（addKeyword 會擋），但損毀的 storage
 * 或惡意的匯入檔可以。matchKeyword 內另有一道相同的防線 —— 這裡是把髒資料
 * 擋在儲存層外，兩道都留著。
 */
export function isValidKeyword(k: unknown): k is string {
  return typeof k === 'string' && k.trim().length > 0 && k.length <= MAX_KEYWORD_LEN
}

export function normalizeCategories(stored: unknown): Category[] {
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
      keywords: (c.keywords as unknown[]).filter(isValidKeyword),
    }))
}

/**
 * 把 stored 的順序與現有 categories 對齊：
 * 過濾掉已刪除的 ID，把新增的補在最後。
 */
export function normalizeCategoryOrder(stored: unknown, categoryIds: string[]): string[] {
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
        ? (raw.keywords as unknown[]).filter(isValidKeyword)
        : [...DEFAULT_SETTINGS.keywords],
      // 遷移：舊版沒有這個欄位，undefined 代表「還沒帶過內建例外」→ seed 一份。
      // 已經是陣列（即使是空的）代表使用者可能刻意清空，尊重它、不要塞回去。
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
  } catch (e) {
    console.error('[SIB] Failed to load settings:', e)
    const locale = detectDefaultLocale()
    const categories = seedDefaultCategories(locale)
    return {
      ...DEFAULT_SETTINGS,
      keywords: [...DEFAULT_SETTINGS.keywords],
      allowKeywords: seedDefaultAllowKeywords(locale),
      enabledCategories: [...DEFAULT_SETTINGS.enabledCategories],
      categoryOrder: categories.map((c) => c.id),
      customCategories: categories,
      locale,
      theme: detectDefaultTheme(),
    }
  }
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
 * 關鍵字只由這些字元組成時，代表它屬於「用空白斷詞」的語言，可以做詞邊界比對。
 * 反之（中日韓等）沒有詞邊界可判斷，只能退回 substring。
 */
const WORD_DELIMITED = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\d\s'\-.]+$/u
/** 詞內字元 — 命中位置前後若是這些字元，代表切在詞中間，不算命中 */
const WORD_CHAR = /[\p{L}\p{N}]/u
/** 後方允許的簡單複數形，讓 `moth` 仍能命中 `moths` / `boxes` */
const PLURAL_SUFFIX = /^(es|s)/

/**
 * 判斷 keyword 是否出現在 haystack 中，依關鍵字所屬的文字系統採用不同規則。
 *
 * 這裡不能用單純的 substring：`moth` 會命中 `mother's day gift`、`boa` 會命中
 * `keyboard shortcuts`、`mite` 會命中 `limited edition`、`rash` 會命中 `car crash`
 * ——結果是使用者搜一個完全無關的詞，整頁圖片無故消失，而且沒有任何提示。
 *
 * - **拉丁 / 西里爾 / 希臘字母關鍵字**：前緣必須是詞邊界，後緣是詞邊界或簡單複數。
 * - **CJK 等無詞邊界的關鍵字**：維持 substring。中文的誤判（蟬聯、蛇年、螞蟻上樹…）
 *   本質上要靠「例外關鍵字」清單解，不是靠比對規則。
 *
 * 刻意不把使用者輸入組成 regex：那有 ReDoS 風險，而 indexOf + 前後字元檢查就夠了。
 */
export function matchKeyword(haystack: string, keyword: string): boolean {
  // 空字串會被 String.includes 視為命中所有內容，等同全域阻擋 —— 一律不算命中
  if (!keyword) return false

  const hay = haystack.toLowerCase()
  const needle = keyword.toLowerCase()

  if (!WORD_DELIMITED.test(needle)) return hay.includes(needle)

  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (WORD_CHAR.test(hay[i - 1] ?? '')) continue // 前緣切在詞中間
    const after = hay.slice(i + needle.length).replace(PLURAL_SUFFIX, '')
    if (!WORD_CHAR.test(after[0] ?? '')) return true
  }
  return false
}

/**
 * 判斷搜尋關鍵字是否命中黑名單
 */
export function shouldBlock(query: string, settings: BlocklistSettings): boolean {
  if (settings.paused) return false
  // globalBlock 刻意排在例外清單之前：它是「全部擋」的核彈按鈕，不該有洞。
  // 想在 globalBlock 下臨時看某一頁，用 paused（本來就是為此存在的逃生口）。
  if (settings.globalBlock) return true
  if (settings.allowKeywords.some((k) => matchKeyword(query, k))) return false
  if (settings.keywords.some((k) => matchKeyword(query, k))) return true
  for (const catId of settings.enabledCategories) {
    const cat = settings.customCategories.find((c) => c.id === catId)
    if (cat && cat.keywords.some((k) => matchKeyword(query, k))) return true
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
  for (const k of settings.keywords) {
    if (matchKeyword(query, k)) return { keyword: k, categoryLabel: null }
  }
  for (const catId of settings.enabledCategories) {
    const cat = settings.customCategories.find((c) => c.id === catId)
    if (!cat) continue
    for (const k of cat.keywords) {
      if (matchKeyword(query, k)) return { keyword: k, categoryLabel: cat.label }
    }
  }
  return null
}

/**
 * 回傳「讓這個查詢被放行」的例外關鍵字，沒有則回傳 null（供 UI 說明為何沒擋）。
 *
 * 只有在「拿掉例外清單就會被擋」時才算數 —— 否則使用者自己加的無關例外
 * （例如 `台北`）會在每個根本不會被擋的頁面上冒出「已放行」的假訊息。
 */
export function findAllowMatch(query: string, settings: BlocklistSettings): string | null {
  if (settings.paused || settings.globalBlock) return null
  const hit = settings.allowKeywords.find((k) => matchKeyword(query, k))
  if (!hit) return null
  return shouldBlock(query, { ...settings, allowKeywords: [] }) ? hit : null
}
