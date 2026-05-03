import { ref, watch } from 'vue'

export interface BlocklistSettings {
  /** 啟用全域阻擋（不論關鍵字都隱藏） */
  globalBlock: boolean
  /** 要隱藏哪些區塊類型 */
  blockTypes: {
    images: boolean
    videos: boolean
    relatedQuestions: boolean
    knowledgePanel: boolean
  }
  /** 使用者自訂的觸發關鍵字 */
  keywords: string[]
  /** 已啟用的分類包 ID（對應 CATEGORIES） */
  enabledCategories: string[]
}

export interface KeywordCategory {
  id: string
  label: string
  description: string
  keywords: string[]
}

/**
 * 預設策展的分類包。新增分類就加在這裡，popup UI 會自動帶出。
 * 關鍵字比對是 substring（不分大小寫），所以「蟲」會命中「昆蟲」「毛毛蟲」等。
 */
export const CATEGORIES: KeywordCategory[] = [
  {
    id: 'insects',
    label: '昆蟲 / 節肢動物',
    description: '蟲類、蜘蛛、蜈蚣等',
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
    label: '爬蟲 / 兩棲類',
    description: '蛇、蜥蜴、青蛙等',
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
    label: '血腥 / 暴力',
    description: '血腥、屍體、戰爭等',
    keywords: [
      '血腥', '屍體', '屍塊', '解剖',
      '戰爭', '暴力', '兇殺', '謀殺',
      '酷刑', '死亡', '車禍現場',
      'gore', 'blood', 'corpse', 'autopsy', 'gruesome',
    ],
  },
  {
    id: 'medical',
    label: '醫療 / 傷口',
    description: '傷口、皮膚病、手術等',
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
    label: '寄生蟲',
    description: '寄生蟲、蟲卵、感染',
    keywords: [
      '寄生蟲', '蛔蟲', '蟯蟲', '絛蟲', '鉤蟲',
      '線蟲', '蟲卵', '幼蟲',
      'parasite', 'tapeworm', 'roundworm', 'hookworm',
    ],
  },
]

const STORAGE_KEY = 'sib_settings'

export const DEFAULT_SETTINGS: BlocklistSettings = {
  globalBlock: false,
  blockTypes: {
    images: true,
    videos: true,
    relatedQuestions: false,
    knowledgePanel: false,
  },
  keywords: [],
  enabledCategories: ['insects'],
}

/**
 * 從 chrome.storage 讀取設定。
 * 對每個欄位做型別正規化 — 之前版本曾因 v-model 把 enabledCategories 寫成 boolean，
 * 這層保護同時自我修復壞資料（下一次 watch 觸發 saveSettings 就會覆蓋掉）。
 */
export async function loadSettings(): Promise<BlocklistSettings> {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY)
    const stored = (result[STORAGE_KEY] ?? {}) as Partial<BlocklistSettings>
    return {
      globalBlock: typeof stored.globalBlock === 'boolean' ? stored.globalBlock : DEFAULT_SETTINGS.globalBlock,
      blockTypes: { ...DEFAULT_SETTINGS.blockTypes, ...(stored.blockTypes ?? {}) },
      keywords: Array.isArray(stored.keywords) ? stored.keywords : [...DEFAULT_SETTINGS.keywords],
      enabledCategories: Array.isArray(stored.enabledCategories)
        ? stored.enabledCategories
        : [...DEFAULT_SETTINGS.enabledCategories],
    }
  } catch (e) {
    console.error('[SIB] Failed to load settings:', e)
    return { ...DEFAULT_SETTINGS, keywords: [...DEFAULT_SETTINGS.keywords], enabledCategories: [...DEFAULT_SETTINGS.enabledCategories] }
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
  await chrome.storage.sync.set({ [STORAGE_KEY]: plain })
}

/**
 * Vue composable：響應式設定 + 自動儲存
 */
export function useBlocklist() {
  const settings = ref<BlocklistSettings>({
    ...DEFAULT_SETTINGS,
    blockTypes: { ...DEFAULT_SETTINGS.blockTypes },
    keywords: [...DEFAULT_SETTINGS.keywords],
    enabledCategories: [...DEFAULT_SETTINGS.enabledCategories],
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

  return {
    settings,
    loaded,
    addKeyword,
    removeKeyword,
  }
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
    if (cat.keywords.some((k) => lower.includes(k.toLowerCase()))) return true
  }
  return false
}
