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
  /** 觸發隱藏的關鍵字 */
  keywords: string[]
}

const STORAGE_KEY = 'sib_settings'

export const DEFAULT_SETTINGS: BlocklistSettings = {
  globalBlock: false,
  blockTypes: {
    images: true,
    videos: true,
    relatedQuestions: false,
    knowledgePanel: false,
  },
  keywords: ['昆蟲', '血腥', 'gore', 'insect'],
}

/**
 * 從 chrome.storage 讀取設定
 */
export async function loadSettings(): Promise<BlocklistSettings> {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY)
    return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY] ?? {}) }
  } catch (e) {
    console.error('[SIB] Failed to load settings:', e)
    return DEFAULT_SETTINGS
  }
}

/**
 * 儲存設定到 chrome.storage
 */
export async function saveSettings(settings: BlocklistSettings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings })
}

/**
 * Vue composable：響應式設定 + 自動儲存
 */
export function useBlocklist() {
  const settings = ref<BlocklistSettings>({ ...DEFAULT_SETTINGS })
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
    { deep: true }
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
  return settings.keywords.some((k) => lower.includes(k.toLowerCase()))
}
