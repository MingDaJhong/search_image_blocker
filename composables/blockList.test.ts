/**
 * 比對邏輯的回歸測試。
 *
 * 核心是 A1 的誤判清單：這些查詢與封鎖內容完全無關，卻因為純 substring 比對
 * 而命中內建關鍵字，導致整頁圖片無故消失。每一筆都用「真實的內建關鍵字清單」
 * 跑，不是用手寫的假資料 —— 這樣之後有人往 DEFAULT_CATEGORIES 加了新的短單字
 * （像 `ant`、`bee`、`fly`），這裡會直接紅給你看。
 */
import { describe, expect, it } from 'vitest'
import { beforeEach } from 'vitest'
import { fakeBrowser } from 'wxt/testing'
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  findAllowMatch,
  findBlockMatch,
  isValidKeyword,
  loadSettings,
  matchKeyword,
  seedDefaultAllowKeywords,
  seedDefaultCategories,
  shouldBlock,
  type BlocklistSettings,
  type Locale,
} from './blockList'
import { PRESET_TEMPLATES, mergeSettings, parseImport } from './useBlockList'

/** 內建 3 個分類 + 2 個範本全開，作為「最容易誤判」的最壞情況 */
function allCategoriesOn(locale: Locale, allowKeywords: string[] = []): BlocklistSettings {
  const categories = [
    ...seedDefaultCategories(locale),
    ...PRESET_TEMPLATES.map((p) => ({
      id: p.id,
      label: p.label[locale],
      keywords: [...p.keywords[locale]],
    })),
  ]
  return {
    ...DEFAULT_SETTINGS,
    keywords: [],
    allowKeywords,
    customCategories: categories,
    enabledCategories: categories.map((c) => c.id),
    categoryOrder: categories.map((c) => c.id),
  }
}

const en = allCategoriesOn('en')
const zh = allCategoriesOn('zh-TW')
/** 內建例外清單也套上 —— 這才是使用者實際拿到的設定 */
const enSeeded = allCategoriesOn('en', seedDefaultAllowKeywords('en'))
const zhSeeded = allCategoriesOn('zh-TW', seedDefaultAllowKeywords('zh-TW'))

// ─────────────────────────────────────────────────────────────
describe('matchKeyword — 拉丁字母走詞邊界', () => {
  it.each([
    ['moth', 'moth'],
    ['moths in closet', 'moth'],
    ['a moth flew in', 'moth'],
    ['giant moth', 'moth'],
    ['boas for sale', 'boa'],
    ['rashes on arm', 'rash'],
    ['ticks on dogs', 'tick'],
    ['boxes of wasps', 'wasp'],
    ['MOTH', 'moth'],
    ['Spider-Man', 'spider'],
  ])('命中 %j ← %j', (hay, needle) => {
    expect(matchKeyword(hay, needle)).toBe(true)
  })

  it.each([
    ['mother', 'moth'],
    ['smother', 'moth'],
    ['keyboard', 'boa'],
    ['boat', 'boa'],
    ['limited', 'mite'],
    ['car crash', 'rash'],
    ['rashguard', 'rash'],
    ['ticket', 'tick'],
    ['sticker', 'tick'],
    ['boiler', 'boil'],
    ['newton', 'newt'],
    ['blouse', 'louse'],
    ['scabbard', 'scab'],
    ['sluggish', 'slug'],
    ['warthog', 'wart'],
  ])('不命中 %j ← %j', (hay, needle) => {
    expect(matchKeyword(hay, needle)).toBe(false)
  })

  it('多字關鍵字兩端都要對齊詞邊界', () => {
    expect(matchKeyword('dust mite allergy', 'dust mite')).toBe(true)
    expect(matchKeyword('adjust mites', 'dust mite')).toBe(false)
  })
})

describe('matchKeyword — CJK 維持 substring', () => {
  it('中文沒有詞邊界可判斷，切在詞中間也算命中', () => {
    expect(matchKeyword('家裡有蜘蛛怎麼辦', '蜘蛛')).toBe(true)
    expect(matchKeyword('被蛇咬急救', '蛇')).toBe(true)
  })

  /**
   * 中文一定會切在詞中間 —— 這是比對層改不掉的事實，也正是例外關鍵字清單
   * 存在的原因。使用者實際看到的結果由 shouldBlock + allowKeywords 決定，
   * 見下方「例外關鍵字」的測試。
   */
  it.each([
    ['蟬聯冠軍', '蟬'],
    ['蛇年運勢', '蛇'],
    ['螞蟻上樹 食譜', '螞蟻'],
    ['鱷魚牌 polo', '鱷魚'],
  ])('%j 在比對層仍會命中 %j —— 由例外清單在上層處理', (hay, needle) => {
    expect(matchKeyword(hay, needle)).toBe(true)
  })
})

describe('matchKeyword — 邊界情況', () => {
  it('空關鍵字一律不命中，不能等同全域阻擋', () => {
    expect(matchKeyword('任何查詢', '')).toBe(false)
    expect(matchKeyword('', '')).toBe(false)
  })

  it('大小寫不敏感', () => {
    expect(matchKeyword('Giant SPIDER photo', 'spider')).toBe(true)
    expect(matchKeyword('spider', 'SPIDER')).toBe(true)
  })

  it('中英混排的查詢兩種規則各自生效', () => {
    expect(matchKeyword('我家的 spider 是什麼品種', 'spider')).toBe(true)
    expect(matchKeyword('我家的 keyboard 壞了', 'boa')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
describe('shouldBlock — A1 誤判回歸（英文內建關鍵字全開）', () => {
  it.each([
    "mother's day gift",
    'mothers day flowers',
    'keyboard shortcuts mac',
    'best keyboard 2026',
    'limited edition sneakers',
    'limited liability company',
    'car crash video',
    'trash can ideas',
    'rashguard',
    'ticket prices',
    'sticker printing',
    'boiler repair',
    'boiling point movie',
    'newton laws',
    'fig newton',
    'white blouse outfit',
    'scabbard sword',
    'sluggish laptop',
    'baseball slugger',
    'warthog',
    'boat rental',
    'mammoth',
    'wounded knee',
    'toaster oven',
  ])('不該擋：%j', (query) => {
    expect(shouldBlock(query, en)).toBe(false)
  })
})

describe('shouldBlock — 真正該擋的仍然要擋', () => {
  it.each([
    'spider in my house',
    'how to kill cockroaches',
    'snake bite first aid',
    'dust mite allergy',
    'tapeworm symptoms',
    'maggots in trash',
    'wasp nest removal',
    'open wound care',
    'scabies treatment',
    'ticks on dogs',
    'centipede bite',
    'python snake game',
  ])('要擋：%j', (query) => {
    expect(shouldBlock(query, en)).toBe(true)
  })

  it.each([
    '蜘蛛 圖片',
    '家裡有蟑螂怎麼辦',
    '被蛇咬 急救',
    '寄生蟲 症狀',
    '蜈蚣 咬傷',
  ])('中文要擋：%j', (query) => {
    expect(shouldBlock(query, zh)).toBe(true)
  })
})

describe('shouldBlock — 開關優先序', () => {
  it('paused 蓋過一切', () => {
    expect(shouldBlock('spider', { ...en, paused: true })).toBe(false)
    expect(shouldBlock('spider', { ...en, paused: true, globalBlock: true })).toBe(false)
  })

  it('globalBlock 不看關鍵字', () => {
    const bare = { ...DEFAULT_SETTINGS, enabledCategories: [], globalBlock: true }
    expect(shouldBlock('台北天氣', bare)).toBe(true)
  })

  it('未啟用的分類不參與比對', () => {
    expect(shouldBlock('spider', { ...en, enabledCategories: [] })).toBe(false)
  })

  it('自訂關鍵字也走同一套詞邊界規則', () => {
    const s = { ...DEFAULT_SETTINGS, enabledCategories: [], keywords: ['moth'] }
    expect(shouldBlock('moths', s)).toBe(true)
    expect(shouldBlock("mother's day", s)).toBe(false)
  })

  it('storage 裡混進空關鍵字時不會變成全域阻擋', () => {
    const s = { ...DEFAULT_SETTINGS, enabledCategories: [], keywords: ['', '   '] }
    expect(shouldBlock('台北天氣', s)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
describe('findBlockMatch', () => {
  it('與 shouldBlock 判斷一致，並回報命中的關鍵字與分類', () => {
    const m = findBlockMatch('spider in my house', en)
    expect(m).toEqual({ keyword: 'spider', categoryLabel: 'Insects / Arthropods' })
  })

  it('自訂關鍵字命中時沒有分類名', () => {
    const s = { ...DEFAULT_SETTINGS, enabledCategories: [], keywords: ['moth'] }
    expect(findBlockMatch('moths', s)).toEqual({ keyword: 'moth', categoryLabel: null })
  })

  it('未命中回傳 null —— A1 的誤判查詢不該再有「阻擋來源」', () => {
    expect(findBlockMatch("mother's day gift", en)).toBeNull()
    expect(findBlockMatch('keyboard shortcuts mac', en)).toBeNull()
  })

  it('globalBlock 時 keyword 為空字串', () => {
    expect(findBlockMatch('任何查詢', { ...en, globalBlock: true })).toEqual({
      keyword: '',
      categoryLabel: null,
    })
  })
})

describe('parseImport — 匯入檔不能夾帶空關鍵字', () => {
  it('過濾掉空字串與純空白的關鍵字', () => {
    const parsed = parseImport(
      JSON.stringify({ version: 1, settings: { keywords: ['moth', '', '   ', '蜘蛛'] } }),
    )
    expect(parsed?.keywords).toEqual(['moth', '蜘蛛'])
  })

  it('匯入含空關鍵字的檔案後，無關查詢仍不會被擋', () => {
    const parsed = parseImport(JSON.stringify({ keywords: [''] }))!
    expect(shouldBlock('台北天氣', { ...parsed, enabledCategories: [] })).toBe(false)
  })

  it('格式錯誤回傳 null', () => {
    expect(parseImport('not json')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────
describe('例外關鍵字 — 內建清單品質', () => {
  it.each([['zh-TW'], ['en']] as const)(
    '%s：每一條內建例外都真的必要（拿掉例外清單就會被擋）',
    (locale) => {
      const bare = allCategoriesOn(locale)
      const dead = seedDefaultAllowKeywords(locale).filter((k) => !shouldBlock(k, bare))
      // 死條目 = 本來就不會被擋、放進清單只是徒增儲存與誤放行風險。
      // 例如 `beetlejuice` / `hard boiled` 已被 matchKeyword 的詞邊界規則處理掉。
      expect(dead).toEqual([])
    },
  )

  it('內建例外不會過度放行 —— 真正該擋的仍然要擋', () => {
    for (const q of ['spider in my house', 'snake bite first aid', 'tapeworm symptoms']) {
      expect(shouldBlock(q, enSeeded)).toBe(true)
    }
    for (const q of ['蜘蛛 圖片', '被蛇咬 急救', '家裡有蟑螂怎麼辦']) {
      expect(shouldBlock(q, zhSeeded)).toBe(true)
    }
  })
})

describe('例外關鍵字 — 中文誤判（A1 修不掉的那半）現在被解掉了', () => {
  it.each([
    '蟬聯冠軍',
    '蛇年運勢',
    '蛇果 產地',
    '打草驚蛇 意思',
    '蟲洞 理論',
    '螞蟻上樹 食譜',
    '蝴蝶結 綁法',
    '蝴蝶效應 電影',
    '鱷魚牌 polo',
    '壁虎功',
    '烏龜車',
    '蝸牛霜 推薦',
    '蜈蚣辮 教學',
    '甲蟲車 二手',
    '蜘蛛人 電影',
    '癌症險 比較',
    '腫瘤科 掛號',
    '手術費用 健保',
    '暴力美學',
  ])('不該擋：%j', (query) => {
    expect(shouldBlock(query, zh)).toBe(true) // 沒有例外清單時會被誤擋
    expect(shouldBlock(query, zhSeeded)).toBe(false) // 有了就正確放行
  })
})

describe('例外關鍵字 — 英文詞邊界之後仍殘留的誤判', () => {
  it.each([
    'flea market taipei',
    'snake case vs camel case',
    'spider chart excel',
    'spider man no way home',
    'feather boa costume',
    'worm gear ratio',
    'vw beetle 2003',
    'charlotte hornets roster',
    'dodge viper price',
    'cobra kai season 6',
    'turtle neck sweater',
    'snail mail meaning',
    'url slug generator',
    'alligator clip wire',
    'all wound up',
    'boil water advisory',
    'wart hog a10',
    'blister pack packaging',
    'al gore documentary',
    'gore-tex jacket',
    'bloody mary recipe',
  ])('不該擋：%j', (query) => {
    expect(shouldBlock(query, en)).toBe(true)
    expect(shouldBlock(query, enSeeded)).toBe(false)
  })
})

describe('例外關鍵字 — 優先序', () => {
  const s = { ...DEFAULT_SETTINGS, enabledCategories: [], keywords: ['蛇'], allowKeywords: ['蛇年'] }

  it('例外優先於自訂關鍵字與分類', () => {
    expect(shouldBlock('蛇年運勢', s)).toBe(false)
    expect(shouldBlock('被蛇咬', s)).toBe(true)
  })

  it('globalBlock 蓋過例外 —— 它是沒有洞的核彈按鈕', () => {
    expect(shouldBlock('蛇年運勢', { ...s, globalBlock: true })).toBe(true)
  })

  it('paused 仍然蓋過一切', () => {
    expect(shouldBlock('被蛇咬', { ...s, paused: true })).toBe(false)
  })

  it('例外自己也走同一套文字系統規則', () => {
    const latin = {
      ...DEFAULT_SETTINGS,
      enabledCategories: [],
      keywords: ['spider'],
      allowKeywords: ['spider man'],
    }
    expect(shouldBlock('spider man 2', latin)).toBe(false)
    expect(shouldBlock('spider in bathroom', latin)).toBe(true)
  })
})

describe('findAllowMatch', () => {
  it('回報是哪一條例外讓查詢放行', () => {
    expect(findAllowMatch('蛇年運勢 2025', zhSeeded)).toBe('蛇年')
  })

  it('本來就不會被擋的查詢不回報例外（避免假訊息）', () => {
    const s = { ...DEFAULT_SETTINGS, enabledCategories: [], keywords: [], allowKeywords: ['台北'] }
    expect(findAllowMatch('台北天氣', s)).toBeNull()
  })

  it('paused / globalBlock 時不回報', () => {
    expect(findAllowMatch('蛇年運勢', { ...zhSeeded, paused: true })).toBeNull()
    expect(findAllowMatch('蛇年運勢', { ...zhSeeded, globalBlock: true })).toBeNull()
  })

  it('與 blockMatch 互斥', () => {
    expect(findBlockMatch('蛇年運勢', zhSeeded)).toBeNull()
    expect(findAllowMatch('被蛇咬 急救', zhSeeded)).toBeNull()
  })
})

describe('例外關鍵字 — 既有使用者的遷移', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  it('舊版設定沒有 allowKeywords 欄位時，seed 一份內建例外', async () => {
    await fakeBrowser.storage.sync.set({
      [STORAGE_KEY]: { locale: 'zh-TW', keywords: ['自訂'], enabledCategories: ['insects'] },
    })
    const s = await loadSettings()
    expect(s.allowKeywords).toEqual(seedDefaultAllowKeywords('zh-TW'))
    expect(s.keywords).toEqual(['自訂']) // 其他欄位不受影響
  })

  it('使用者刻意清空成 [] 時，不會被塞回去', async () => {
    await fakeBrowser.storage.sync.set({
      [STORAGE_KEY]: { locale: 'zh-TW', allowKeywords: [] },
    })
    expect((await loadSettings()).allowKeywords).toEqual([])
  })

  it('使用者自訂的例外原樣保留，髒資料被濾掉', async () => {
    await fakeBrowser.storage.sync.set({
      [STORAGE_KEY]: { locale: 'zh-TW', allowKeywords: ['我的例外', '', '  ', 123, 'x'.repeat(51)] },
    })
    expect((await loadSettings()).allowKeywords).toEqual(['我的例外'])
  })

  it('舊版設定沒有 pageIndicator 時預設開啟', async () => {
    // 這個功能存在的意義就是讓阻擋不再無聲，對既有使用者預設關掉等於沒做
    await fakeBrowser.storage.sync.set({ [STORAGE_KEY]: { locale: 'zh-TW' } })
    expect((await loadSettings()).pageIndicator).toBe(true)
  })

  it('使用者關掉之後不會被改回來', async () => {
    await fakeBrowser.storage.sync.set({
      [STORAGE_KEY]: { locale: 'zh-TW', pageIndicator: false },
    })
    expect((await loadSettings()).pageIndicator).toBe(false)
  })

  it('全新安裝依 locale 帶入對應語言的例外', async () => {
    await fakeBrowser.storage.sync.set({ [STORAGE_KEY]: { locale: 'en' } })
    expect((await loadSettings()).allowKeywords).toEqual(seedDefaultAllowKeywords('en'))
  })
})

describe('例外關鍵字 — 匯入 / 合併', () => {
  it('parseImport 保留匯入檔的例外清單', () => {
    const parsed = parseImport(JSON.stringify({ version: 1, settings: { allowKeywords: ['蛇年'] } }))
    expect(parsed?.allowKeywords).toEqual(['蛇年'])
  })

  it('舊版備份檔（沒有這個欄位）匯入時補上內建例外', () => {
    const parsed = parseImport(JSON.stringify({ version: 1, settings: { locale: 'zh-TW' } }))
    expect(parsed?.allowKeywords).toEqual(seedDefaultAllowKeywords('zh-TW'))
  })

  it('mergeSettings 取聯集且去重', () => {
    const a = { ...DEFAULT_SETTINGS, allowKeywords: ['蛇年', '蟬聯'] }
    const b = { ...DEFAULT_SETTINGS, allowKeywords: ['蟬聯', '蝴蝶結'] }
    expect(mergeSettings(a, b).allowKeywords).toEqual(['蛇年', '蟬聯', '蝴蝶結'])
  })
})

describe('isValidKeyword', () => {
  it.each([['moth'], ['蜘蛛'], ['dust mite']])('接受 %j', (k) => {
    expect(isValidKeyword(k)).toBe(true)
  })

  it.each([[''], ['   '], ['\n\t'], [null], [undefined], [123], [{}], ['x'.repeat(51)]])(
    '拒絕 %j',
    (k) => {
      expect(isValidKeyword(k)).toBe(false)
    },
  )
})
