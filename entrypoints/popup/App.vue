<script setup lang="ts">
import { computed, ref, watch } from "vue";
import draggable from "vuedraggable";
import { browser } from "wxt/browser";
import {
  useBlockList,
  findBlockMatch,
  findAllowMatch,
  shouldBlock,
  parseImport,
  mergeSettings,
  STORAGE_KEY,
  PRESET_TEMPLATES,
  DEFAULT_CATEGORIES,
  MAX_LABEL_LEN,
  type Locale,
  type Category,
  type BlocklistSettings,
  type HideMode,
} from "@/composables/useBlockList";
import { GOOGLE_SEARCH_MATCHES, isGoogleSearchUrl } from "@/composables/googleTlds";
import {
  DIAGNOSE_MESSAGE,
  TOGGLE_REVEAL_MESSAGE,
  hiddenCountOf,
  summarizePageStatus,
  type PageStatus,
  summarizeDiagnosis,
  type DiagnosisReport,
  type DiagnosisVerdict,
} from "@/composables/diagnostics";
import { messages, type Messages } from "./i18n";
import CategoryDetail from "./CategoryDetail.vue";
import KeywordSection from "./KeywordSection.vue";

/**
 * 同一個元件同時當 popup（360 px）與獨立設定頁（`entrypoints/options/`）用。
 *
 * `wide` 不只是換個寬度：它決定「哪些東西值得攤開」—— 例外關鍵字的 57 個 chip
 * 在 popup 裡必須收進子頁，在設定頁裡直接展開反而比較好用；關鍵字篩選與批次
 * 貼上也只有在有空間的時候才有意義。複製一份 OptionsApp.vue 出來會讓兩邊
 * 立刻開始漂移，這裡的每一個 section 都是同一份實作。
 */
const props = withDefaults(defineProps<{ wide?: boolean }>(), { wide: false });

const {
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
} = useBlockList();
const expandedCategory = ref<string | null>(null);

// 目前 active tab 的搜尋字串（null = 非 Google 搜尋頁）
const currentSearchQuery = ref<string | null>(null);
// 命中的關鍵字資訊，隨 settings 變動自動更新
const blockMatch = computed(() => {
  const query = currentSearchQuery.value;
  if (query === null || !loaded.value) return null;
  if (!shouldBlock(query, settings.value)) return null;
  return findBlockMatch(query, settings.value);
});
// 命中例外而放行時，讓 UI 說得出「為什麼沒擋」——與 blockMatch 互斥
const allowMatch = computed(() => {
  const query = currentSearchQuery.value;
  if (query === null || !loaded.value) return null;
  return findAllowMatch(query, settings.value);
});

/**
 * 找出要拿來判讀的 Google 搜尋分頁。
 *
 * 先看目前的 active tab；獨立設定頁自己就是一個分頁，那時 active tab 永遠
 * 不是搜尋頁，所以退而找所有搜尋分頁裡最近使用的那一個。少了這一段，設定頁
 * 上的「目前阻擋中」與「檢查是否失效」會永遠是空的。
 *
 * `tabs.query` 的 url 過濾靠的是既有的 host permissions，沒有新增權限。
 */
async function findSearchTab() {
  const active = await browser.tabs.query({ active: true, currentWindow: true });
  const current = active[0];
  if (current?.url && isSearchUrl(current.url)) return current;
  const matches = await browser.tabs.query({ url: [...GOOGLE_SEARCH_MATCHES] });
  return (
    [...matches].sort(
      (a, b) =>
        ((b as { lastAccessed?: number }).lastAccessed ?? 0) -
        ((a as { lastAccessed?: number }).lastAccessed ?? 0),
    )[0] ?? null
  );
}

function isSearchUrl(href: string): boolean {
  try {
    return isGoogleSearchUrl(new URL(href));
  } catch {
    return false;
  }
}

// immediate 是必要的：useBlockList 命中本機快取時 `loaded` 一開始就是 true，
// 沒有 immediate 這個 watcher 永遠等不到那次 false → true 的轉換，狀態卡與
// 儲存配額就會整個不初始化。傳進來是 false 時第一行會自己 early-return。
watch(
  loaded,
  async (isLoaded) => {
    if (!isLoaded) return;
    refreshStorageUsage();
    loadShortcuts();
    // 截圖模式：popup 以分頁開啟並帶 ?q=<關鍵字> 時，跳過 tabs API
    // 直接把該關鍵字當成「目前搜尋字串」，方便擷取阻擋 banner 畫面。
    const overrideQ = new URL(location.href).searchParams.get("q");
    if (overrideQ !== null) {
      currentSearchQuery.value = overrideQ;
      return;
    }
    try {
      const tab = await findSearchTab();
      if (!tab?.url) return;
      currentSearchQuery.value = new URL(tab.url).searchParams.get("q") ?? "";
    } catch {
      // tabs API 不可用或 URL 無法存取
    }
    // 狀態卡要顯示「已隱藏幾個」，那個數字只有 content script 知道
    applyReport(await fetchReport());
  },
  { immediate: true },
);

/**
 * Popup 只有一個視窗，靠這個狀態決定顯示哪一頁。
 * 用 discriminated union 而不是多個布林，避免出現「兩頁同時開著」的無效狀態。
 */
type PopupView =
  | { name: "main" }
  | { name: "category"; id: string }
  | { name: "allowKeywords" };

const view = ref<PopupView>({ name: "main" });
const isMain = computed(() => view.value.name === "main");

const detailCategory = computed<Category | null>(() => {
  if (view.value.name !== "category") return null;
  const id = view.value.id;
  return settings.value.customCategories.find((c) => c.id === id) ?? null;
});


// 新增分類表單狀態
const showAddCategory = ref(false);
const newCategoryName = ref("");

/**
 * 分類在別的裝置被刪掉時，storage 同步過來會讓 detailCategory 變成 null。
 * 停在一個沒有內容的子頁沒有意義，直接退回主畫面。
 */
watch(detailCategory, (cat) => {
  if (loaded.value && view.value.name === "category" && !cat) backToMain();
});

function openCategory(id: string) {
  view.value = { name: "category", id };
}
function openAllowKeywords() {
  view.value = { name: "allowKeywords" };
}
function backToMain() {
  view.value = { name: "main" };
}
function handleAddCategory() {
  const id = addCategory(newCategoryName.value);
  if (id) {
    newCategoryName.value = "";
    showAddCategory.value = false;
    openCategory(id);
  }
}

const availablePresets = computed(() => {
  const existingIds = new Set(settings.value.customCategories.map((c) => c.id));
  const locale = settings.value.locale;
  return PRESET_TEMPLATES.filter((p) => !existingIds.has(p.id)).map((p) => ({
    id: p.id,
    label: p.label[locale],
  }));
});

const availableDefaults = computed(() => {
  const existingIds = new Set(settings.value.customCategories.map((c) => c.id));
  const locale = settings.value.locale;
  return DEFAULT_CATEGORIES.filter((d) => !existingIds.has(d.id)).map((d) => ({
    id: d.id,
    label: d.label[locale],
  }));
});

function handleAddPreset(presetId: string) {
  const id = addCategoryFromPreset(presetId);
  if (id) {
    showAddCategory.value = false;
    newCategoryName.value = "";
  }
}

function handleRestoreDefault(defaultId: string) {
  const id = addCategoryFromDefault(defaultId);
  if (id) {
    showAddCategory.value = false;
    newCategoryName.value = "";
  }
}

/**
 * 把 settings.categoryOrder（ID 陣列）映射成 Category[]，
 * 提供 setter 供 vuedraggable 拖曳回寫。
 */
const orderedCategories = computed<Category[]>({
  get() {
    const order = settings.value.categoryOrder ?? [];
    const result: Category[] = [];
    const seen = new Set<string>();
    for (const id of order) {
      const cat = settings.value.customCategories.find((c) => c.id === id);
      if (cat) {
        result.push(cat);
        seen.add(id);
      }
    }
    for (const cat of settings.value.customCategories) {
      if (!seen.has(cat.id)) result.push(cat);
    }
    return result;
  },
  set(val) {
    settings.value.categoryOrder = val.map((c) => c.id);
  },
});

const t = computed<Messages>(() => messages[settings.value.locale]);

/**
 * 主畫面的分頁。三格對應三個問題：方式（怎麼擋）／關鍵字（擋什麼）／區塊（擋哪裡）。
 *
 * 狀態卡刻意**不在**任何一格裡 —— 它是頁面層級的讀數而不是設定，放進分頁的話
 * 標籤永遠會顧此失彼，而且切到別格就看不到「這一頁怎麼了」。
 */
type TabId = "mode" | "keywords" | "blocks";
const activeTab = ref<TabId>("mode");
const tabDefs = computed(() => [
  { id: "mode" as const, label: t.value.tabMode },
  { id: "keywords" as const, label: t.value.tabKeywords },
  { id: "blocks" as const, label: t.value.tabBlocks },
]);

/**
 * 寬版面（獨立設定頁）不分頁，一次攤開全部 —— 那裡空間夠，
 * 分頁只會讓使用者多點三次才看得完。
 */
function showTab(id: TabId): boolean {
  return props.wide || activeTab.value === id;
}

/**
 * 要隱藏的區塊，分成「夾帶圖片的」與「會連文字一起隱藏的整塊區域」。
 * 後者預設關閉且行為明顯不同，跟前五項並排成一列時看不出差別。
 */
const blockGroups = computed(() => [
  {
    title: t.value.blockGroupMedia,
    hint: "",
    items: [
      { key: "thumbnails" as const, label: t.value.blockThumbnails },
      { key: "searchPreview" as const, label: t.value.blockSearchPreview },
      { key: "imageFilterBar" as const, label: t.value.blockImageFilterBar },
      { key: "images" as const, label: t.value.blockImages },
      { key: "videos" as const, label: t.value.blockVideos },
    ],
  },
  {
    title: t.value.blockGroupArea,
    hint: t.value.blockGroupAreaHint,
    items: [
      { key: "relatedQuestions" as const, label: t.value.blockRelatedQuestions },
      { key: "knowledgePanel" as const, label: t.value.blockKnowledgePanel },
    ],
  },
]);

/** 這一頁現在到底怎麼了 —— 判斷邏輯在 diagnostics.ts，那裡有測試 */
const pageStatus = computed<PageStatus>(() =>
  summarizePageStatus({
    onSearchPage: currentSearchQuery.value !== null,
    report: lastReport.value,
    queryBlocked: blockMatch.value !== null,
    queryAllowed: allowMatch.value !== null,
  }),
);

/** 造成阻擋的命中：query 層級優先，其次是逐筆比對回報的 */
const blockReason = computed(() => blockMatch.value ?? scannerMatch.value);

const statusTitle = computed(() => {
  if (revealedOnPage.value) return t.value.statusRevealedTitle;
  switch (pageStatus.value) {
    case "blocked":
      return t.value.statusBlockedTitle(hiddenCount.value);
    case "offsite":
      return t.value.statusOffsiteTitle;
    default:
      return t.value.statusIdleTitle;
  }
});

const statusDetail = computed(() => {
  if (revealedOnPage.value) return t.value.statusRevealedDetail;
  switch (pageStatus.value) {
    case "blocked":
      return t.value.statusBlockedDetail(
        blockReason.value?.keyword ?? "",
        blockReason.value?.categoryLabel ?? null,
      );
    case "allowed":
      return t.value.statusAllowedDetail(allowMatch.value ?? "");
    case "offsite":
      return t.value.statusOffsiteDetail;
    default:
      return t.value.statusIdleDetail;
  }
});

/** 只有真的擋到東西時才給揭露按鈕 —— 沒東西可放的話那顆鈕是騙人的 */
const canReveal = computed(
  () => pageStatus.value === "blocked" || revealedOnPage.value,
);

const statusToneClass = computed(() =>
  pageStatus.value === "blocked" && !revealedOnPage.value
    ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
    : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300",
);

const hideModeOptions = computed<
  Array<{ value: HideMode; label: string; desc: string }>
>(() => [
  { value: "hide", label: t.value.hideModeHide, desc: t.value.hideModeHideDesc },
  { value: "blur", label: t.value.hideModeBlur, desc: t.value.hideModeBlurDesc },
  { value: "mask", label: t.value.hideModeMask, desc: t.value.hideModeMaskDesc },
]);

const REPORT_URL = "https://github.com/mingdajhong/search_image_blocker/issues";

/**
 * B8：使用者可觸發的失效診斷。
 *
 * 這個產品沒有任何遙測（那是它的隱私主張），所以 Google 改 DOM 時我們無從得知。
 * 頁面提示上的「已隱藏 0 個區塊」是第一道訊號，但那要剛好在被擋的頁面上才看得到。
 * 這顆按鈕讓使用者能主動問一次，並拿到一句可以直接回報的結論。
 *
 * 走 `tabs.sendMessage` 而不是 `scripting.executeScript`：後者要新增 `scripting`
 * 權限，而對已上架的擴充功能新增權限會讓 Chrome 停用它直到使用者重新同意。
 */
const diagVerdict = ref<DiagnosisVerdict | null>(null);
const diagCount = ref(0);
let diagTimer = 0;

/**
 * content script 回報的實際狀況。拿不到（非搜尋頁、或分頁在安裝前就開著）
 * 時維持 null —— 狀態卡就不顯示數字，而不是顯示一個編出來的 0。
 */
const hiddenCount = ref<number | null>(null);
const revealedOnPage = ref(false);
/** 逐筆比對命中的關鍵字（query 層級看不到，只有 content script 知道） */
const scannerMatch = ref<{ keyword: string; categoryLabel: string | null } | null>(
  null,
);
/** 最近一次回報，供 summarizePageStatus 判讀 */
const lastReport = ref<DiagnosisReport | null>(null);

function applyReport(report: DiagnosisReport | null) {
  lastReport.value = report;
  if (!report) {
    hiddenCount.value = null;
    revealedOnPage.value = false;
    scannerMatch.value = null;
    return;
  }
  hiddenCount.value = hiddenCountOf(report);
  revealedOnPage.value = report.revealed;
  scannerMatch.value = report.scannerMatch;
}

/** 狀態卡上的「本頁顯示 / 復原」——與快捷鍵、頁面提示走同一個訊息 */
async function handleToggleReveal() {
  try {
    const tab = await findSearchTab();
    if (tab?.id === undefined) return;
    const res = (await browser.tabs.sendMessage(tab.id, {
      type: TOGGLE_REVEAL_MESSAGE,
    })) as { revealed?: boolean } | undefined;
    revealedOnPage.value = res?.revealed ?? !revealedOnPage.value;
  } catch {
    // content script 不在，忽略
  }
}

/**
 * 向 content script 要一份現況報告。診斷按鈕與常駐狀態卡共用同一條管線 ——
 * 兩者問的是同一件事，沒有理由開兩套。
 */
async function fetchReport(): Promise<DiagnosisReport | null> {
  try {
    const tab = await findSearchTab();
    if (tab?.id === undefined) return null;
    return (await browser.tabs.sendMessage(tab.id, {
      type: DIAGNOSE_MESSAGE,
    })) as DiagnosisReport;
  } catch {
    // 這個分頁沒有 content script（安裝前就開著、或不是搜尋頁）
    return null;
  }
}

async function handleDiagnose() {
  showHeaderMenu.value = false;
  const report = await fetchReport();
  applyReport(report);
  diagCount.value = report
    ? report.queryBlocked
      ? report.cssMatches
      : report.scannerMatches
    : 0;
  diagVerdict.value = summarizeDiagnosis(report);
  clearTimeout(diagTimer);
  diagTimer = window.setTimeout(() => {
    diagVerdict.value = null;
  }, 8000);
}

const diagMessage = computed(() => {
  switch (diagVerdict.value) {
    case "ok":
      return t.value.diagOk(diagCount.value);
    case "broken":
      return t.value.diagBroken;
    case "idle":
      return t.value.diagIdle;
    case "paused":
      return t.value.diagPaused;
    case "unreachable":
      return t.value.diagUnreachable;
    default:
      return "";
  }
});

/**
 * 快捷鍵清單。刻意讀 `commands.getAll()` 而不是把 manifest 的建議組合寫死 ——
 * 使用者在 chrome://extensions/shortcuts 改過之後，寫死的那份就是錯的。
 */
const shortcuts = ref<Array<{ label: string; shortcut: string }>>([]);

async function loadShortcuts() {
  try {
    const all = await browser.commands.getAll();
    shortcuts.value = all
      .filter((c) => c.shortcut)
      .map((c) => ({
        label:
          c.name === "toggle-reveal"
            ? t.value.shortcutToggleReveal
            : t.value.shortcutOpenPopup,
        shortcut: c.shortcut ?? "",
      }));
  } catch {
    // Firefox 或不支援 commands 的環境
  }
}

function openShortcutSettings() {
  // chrome:// 連結沒辦法用 <a> 開，只能由擴充功能自己建分頁
  browser.tabs.create({ url: "chrome://extensions/shortcuts" }).catch(() => {});
}

function openOptions() {
  showHeaderMenu.value = false;
  browser.runtime.openOptionsPage();
}

/** 子頁 header 的標題（主畫面時不會用到） */
const detailTitle = computed(() =>
  view.value.name === "allowKeywords"
    ? t.value.allowKeywordsTitle
    : (detailCategory.value?.label ?? ""),
);

/** 主畫面入口列的摘要，格式與分類列一致 */
const allowKeywordsPreview = computed(() => {
  const list = settings.value.allowKeywords;
  if (list.length === 0) return "";
  return list.slice(0, 3).join(t.value.keywordSep) + (list.length > 3 ? "…" : "");
});

// theme 變動時：套 dark class、寫 localStorage cache（給下次 popup 開啟時 main.ts 同步讀）
watch(
  () => settings.value.theme,
  (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("sib_theme", theme);
  },
  { immediate: true },
);

function toggleExpand(id: string) {
  expandedCategory.value = expandedCategory.value === id ? null : id;
}

function toggleTheme() {
  settings.value.theme = settings.value.theme === "dark" ? "light" : "dark";
}

function toggleLocale() {
  const next: Locale = settings.value.locale === "zh-TW" ? "en" : "zh-TW";
  settings.value.locale = next;
}

function togglePause() {
  settings.value.paused = !settings.value.paused;
}

const showHeaderMenu = ref(false);

// 儲存配額
const STORAGE_QUOTA = 102400; // chrome.storage.sync.QUOTA_BYTES = 100 KB
/**
 * 上次量到的 storage 用量。
 *
 * 先用本機快取開場再對帳，理由跟 useBlockList 的設定快取一樣：
 * `getBytesInUse` 是 async，等它回來才渲染的話這段配額列會在畫面上憑空長出來，
 * 使用者看到的就是「開啟後又跳了一下」。數字對不對隨後會自己修正，但版面
 * 從第一個 frame 起就是穩定的。
 */
const STORAGE_BYTES_CACHE_KEY = "sib_storage_bytes";

function readStorageBytesCache(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_BYTES_CACHE_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

const storageBytes = ref(readStorageBytesCache());
const storageKB = computed(() => (storageBytes.value / 1024).toFixed(1));
const storagePercent = computed(() =>
  Math.min(100, Math.round((storageBytes.value / STORAGE_QUOTA) * 100)),
);
const storageBarColor = computed(() => {
  const p = storagePercent.value;
  if (p >= 90) return "bg-red-500";
  if (p >= 70) return "bg-amber-400";
  return "bg-primary-500";
});

async function refreshStorageUsage() {
  try {
    const bytes = await browser.storage.sync.getBytesInUse(STORAGE_KEY);
    storageBytes.value = bytes;
    try {
      localStorage.setItem(STORAGE_BYTES_CACHE_KEY, String(bytes));
    } catch {
      // 隱私模式或配額爆掉；快取失敗只是下次少一格穩定版面，不影響功能
    }
  } catch {
    // Firefox 或 API 不支援時靜默忽略
  }
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && STORAGE_KEY in changes) refreshStorageUsage();
});

const importFileInput = ref<HTMLInputElement | null>(null);
const importStatus = ref<"success" | "merged" | "error" | null>(null);
const pendingImport = ref<BlocklistSettings | null>(null);

function handleExport() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: JSON.parse(JSON.stringify(settings.value)),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sib-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showHeaderMenu.value = false;
}

function handleImportClick() {
  showHeaderMenu.value = false;
  importFileInput.value?.click();
}

async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (!file) return;
  const text = await file.text();
  const parsed = parseImport(text);
  if (!parsed) {
    importStatus.value = "error";
    setTimeout(() => {
      importStatus.value = null;
    }, 3000);
    return;
  }
  // 不立即套用 — 等使用者選合併或取代
  pendingImport.value = parsed;
}

function applyImportMerge() {
  if (!pendingImport.value) return;
  settings.value = mergeSettings(settings.value, pendingImport.value);
  pendingImport.value = null;
  importStatus.value = "merged";
  setTimeout(() => {
    importStatus.value = null;
  }, 3000);
}

function applyImportReplace() {
  if (!pendingImport.value) return;
  settings.value = pendingImport.value;
  pendingImport.value = null;
  importStatus.value = "success";
  setTimeout(() => {
    importStatus.value = null;
  }, 3000);
}

function cancelImport() {
  pendingImport.value = null;
}
</script>

<template>
  <div
    :class="[
      'bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100',
      props.wide ? 'mx-auto max-w-5xl p-6' : 'p-4',
    ]"
  >
    <input
      ref="importFileInput"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="handleFileChange"
    />

    <!-- 匯入模式選擇 dialog -->
    <div
      v-if="pendingImport"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="cancelImport"
    >
      <div
        class="bg-white dark:bg-gray-800 rounded-md shadow-lg p-4 max-w-sm w-full border border-gray-200 dark:border-gray-700"
      >
        <h3 class="text-sm font-semibold mb-2">
          {{ t.importPromptTitle }}
        </h3>
        <p class="text-xs text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
          {{ t.importPromptDesc }}
        </p>
        <div class="flex gap-2 justify-end">
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            @click="cancelImport"
          >
            {{ t.cancelBtn }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-md border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            @click="applyImportReplace"
          >
            {{ t.importReplaceBtn }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-md bg-primary-600 hover:bg-primary-700 text-white transition-colors"
            @click="applyImportMerge"
          >
            {{ t.importMergeBtn }}
          </button>
        </div>
      </div>
    </div>
    <header v-if="isMain" class="flex items-center gap-2 mb-4">
      <img class="w-10 h-10" src="/icon/128.png" alt="logo" />
      <div class="flex-1 min-w-0">
        <h1 class="text-base font-semibold leading-tight truncate">
          Search Image Blocker
        </h1>
        <p class="text-xs text-gray-500 dark:text-gray-400 truncate">
          {{ t.subtitle }}
        </p>
      </div>
      <div class="relative shrink-0">
        <button
          type="button"
          :title="t.menuAria"
          :aria-label="t.menuAria"
          :class="[
            'w-7 h-7 rounded flex items-center justify-center text-lg leading-none font-bold tracking-tighter',
            settings.paused
              ? 'text-amber-500 dark:text-amber-400'
              : 'text-gray-500 dark:text-gray-400',
            'hover:bg-gray-100 dark:hover:bg-gray-800',
          ]"
          @click.stop="showHeaderMenu = !showHeaderMenu"
        >
          ···
        </button>

        <template v-if="showHeaderMenu">
          <div class="fixed inset-0 z-10" @click="showHeaderMenu = false" />
          <div
            class="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden"
            style="min-width: 11rem"
          >
            <button
              type="button"
              :class="[
                'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left',
                settings.paused
                  ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700',
              ]"
              @click="togglePause"
            >
              <svg
                v-if="!settings.paused"
                viewBox="0 0 20 20"
                class="w-4 h-4 fill-current shrink-0"
                aria-hidden="true"
              >
                <rect x="4" y="3" width="4" height="14" rx="1" />
                <rect x="12" y="3" width="4" height="14" rx="1" />
              </svg>
              <svg
                v-else
                viewBox="0 0 20 20"
                class="w-4 h-4 fill-current shrink-0"
                aria-hidden="true"
              >
                <path
                  d="M6 4.5a.5.5 0 0 1 .765-.424l9 5.5a.5.5 0 0 1 0 .848l-9 5.5A.5.5 0 0 1 6 15.5v-11Z"
                />
              </svg>
              {{ settings.paused ? t.resumeAria : t.pauseAria }}
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              @click="toggleTheme"
            >
              <span
                class="w-4 text-center text-base leading-none"
                aria-hidden="true"
                >{{ settings.theme === "dark" ? "☀️" : "🌙" }}</span
              >
              {{ t.themeToggleAria }}
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              @click="toggleLocale"
            >
              <span
                class="w-4 text-center text-xs font-bold tabular-nums"
                aria-hidden="true"
                >{{ settings.locale === "zh-TW" ? "EN" : "中" }}</span
              >
              {{ t.localeToggleAria }}
            </button>
            <div class="border-t border-gray-100 dark:border-gray-700 my-1" />
            <button
              v-if="!props.wide"
              type="button"
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              @click="openOptions"
            >
              <svg
                viewBox="0 0 20 20"
                class="w-4 h-4 fill-current shrink-0"
                aria-hidden="true"
              >
                <path
                  d="M11 3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V5.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L14.586 4H12a1 1 0 0 1-1-1ZM4 5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3a1 1 0 1 0-2 0v3H4V7h3a1 1 0 1 0 0-2H4Z"
                />
              </svg>
              {{ t.openOptions }}
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              @click="handleDiagnose"
            >
              <svg
                viewBox="0 0 20 20"
                class="w-4 h-4 fill-current shrink-0"
                aria-hidden="true"
              >
                <path
                  d="M9 2a7 7 0 1 0 4.192 12.606l3.101 3.101a1 1 0 0 0 1.414-1.414l-3.1-3.101A7 7 0 0 0 9 2ZM4 9a5 5 0 1 1 10 0A5 5 0 0 1 4 9Z"
                />
              </svg>
              {{ t.diagnoseBtn }}
            </button>
            <div class="border-t border-gray-100 dark:border-gray-700 my-1" />
            <button
              type="button"
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              @click="handleExport"
            >
              <svg
                viewBox="0 0 20 20"
                class="w-4 h-4 fill-current shrink-0"
                aria-hidden="true"
              >
                <path
                  d="M10 2a1 1 0 0 1 1 1v8.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L9 11.586V3a1 1 0 0 1 1-1ZM3 15a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Z"
                />
              </svg>
              {{ t.exportSettings }}
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              @click="handleImportClick"
            >
              <svg
                viewBox="0 0 20 20"
                class="w-4 h-4 fill-current shrink-0"
                aria-hidden="true"
              >
                <path
                  d="M10 18a1 1 0 0 1-1-1V8.414L6.707 10.707a1 1 0 0 1-1.414-1.414l4-4a1 1 0 0 1 1.414 0l4 4a1 1 0 0 1-1.414 1.414L11 8.414V17a1 1 0 0 1-1 1ZM3 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Z"
                />
              </svg>
              {{ t.importSettings }}
            </button>
          </div>
        </template>
      </div>
    </header>

    <header v-else class="flex items-center gap-2 mb-4">
      <button
        type="button"
        :title="t.backAria"
        :aria-label="t.backAria"
        class="w-7 h-7 rounded hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center"
        @click="backToMain"
      >
        <svg
          viewBox="0 0 20 20"
          class="w-4 h-4 fill-current"
          aria-hidden="true"
        >
          <path
            d="M12.95 4.05a1 1 0 0 1 0 1.414L8.414 10l4.536 4.536a1 1 0 0 1-1.414 1.414L6.293 10.707a1 1 0 0 1 0-1.414L11.536 4.05a1 1 0 0 1 1.414 0Z"
          />
        </svg>
      </button>
      <h1 class="flex-1 min-w-0 text-base font-semibold leading-tight truncate">
        {{ detailTitle }}
      </h1>
    </header>

    <!--
      只有「這台裝置第一次開」會走到這裡（之後都有本機快取，第一個 frame 就是
      完整畫面）。min-h 是為了那一次：Chrome 是照內容高度決定 popup 視窗大小的，
      不撐開的話視窗會先開成一條，再猛然長到滿版。
    -->
    <div
      v-if="!loaded"
      :class="[
        'text-center text-sm text-gray-400 dark:text-gray-500 py-8',
        props.wide ? '' : 'min-h-[420px]',
      ]"
    >
      {{ t.loading }}
    </div>

    <template v-else-if="isMain">
      <!-- 暫停 banner -->
      <div
        v-if="settings.paused"
        class="mb-4 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-md text-xs text-amber-700 dark:text-amber-400 flex items-center justify-between"
      >
        <span>{{ t.pausedBanner }}</span>
        <button
          type="button"
          class="ml-2 underline underline-offset-2 hover:no-underline shrink-0"
          @click="togglePause"
        >
          {{ t.resumeAria }}
        </button>
      </div>

      <!-- 匯入狀態提示 -->
      <div
        v-if="importStatus === 'success' || importStatus === 'merged'"
        class="mb-4 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-md text-xs text-green-700 dark:text-green-400"
      >
        {{ importStatus === "merged" ? t.importMergeSuccess : t.importSuccess }}
      </div>
      <div
        v-else-if="importStatus === 'error'"
        class="mb-4 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-xs text-red-600 dark:text-red-400"
      >
        {{ t.importError }}
      </div>

      <!-- 診斷結果 -->
      <div
        v-if="diagVerdict"
        :class="[
          'mb-4 px-3 py-2 border rounded-md text-xs flex items-start gap-2',
          diagVerdict === 'broken'
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400'
            : diagVerdict === 'ok'
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400',
        ]"
        role="status"
      >
        <span class="flex-1">{{ diagMessage }}</span>
        <a
          v-if="diagVerdict === 'broken'"
          :href="REPORT_URL"
          target="_blank"
          rel="noopener"
          class="shrink-0 underline underline-offset-2"
          >{{ t.diagReportLink }}</a
        >
      </div>

      <!--
        儲存失敗是全域錯誤，任何分頁都可能觸發 —— 放在常駐區，
        不能因為使用者剛好切到別格就看不到。
      -->
      <div
        v-if="saveError"
        class="mb-3 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-xs text-red-600 dark:text-red-400"
      >
        {{ t.saveError }}
      </div>

      <!--
        這一頁的狀態：常駐在分頁列上方，不屬於任何一格。
        它是頁面層級的讀數而不是設定 —— 放進分頁的話標籤永遠顧此失彼，
        而且切到別格就看不到「這一頁怎麼了」。
      -->
      <div
        v-if="!settings.paused"
        :class="[
          'mb-3 p-3 rounded-lg border flex items-center gap-2',
          statusToneClass,
        ]"
      >
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold leading-snug">{{ statusTitle }}</div>
          <div class="text-xs leading-relaxed opacity-80 mt-0.5">
            {{ statusDetail }}
          </div>
        </div>
        <button
          v-if="canReveal"
          type="button"
          class="shrink-0 px-2.5 py-1 text-xs rounded-md border border-current bg-white dark:bg-gray-900 hover:opacity-80 transition-opacity"
          @click="handleToggleReveal"
        >
          {{ revealedOnPage ? t.restoreBtn : t.revealBtn }}
        </button>
      </div>

      <!-- 分頁：方式（怎麼擋）／關鍵字（擋什麼）／區塊（擋哪裡） -->
      <div
        v-if="!props.wide"
        class="flex mb-4 border-b border-gray-200 dark:border-gray-700"
      >
        <button
          v-for="tab in tabDefs"
          :key="tab.id"
          type="button"
          :class="[
            'flex-1 px-1 py-2 text-sm -mb-px border-b-2 transition-colors',
            activeTab === tab.id
              ? 'text-primary-600 dark:text-primary-400 font-semibold border-primary-600 dark:border-primary-400'
              : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-200',
          ]"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <!--
        寬版面把區塊排成兩欄。每個 section 是 grid 的直接子元素，所以不需要
        另外包欄容器 —— 少一層 DOM，也不會出現「popup 與設定頁結構不同」的分叉。
      -->
      <div :class="props.wide ? 'grid lg:grid-cols-2 gap-x-8 items-start' : ''">
      <!-- 遮蔽方式 -->
      <section v-if="showTab('mode')" class="mb-6">
        <h2
          class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2"
        >
          {{ t.hideModeTitle }}
        </h2>
        <p
          class="text-xs text-gray-500 dark:text-gray-400 mb-2 leading-relaxed"
        >
          {{ t.hideModeHint }}
        </p>
        <div class="space-y-1.5">
          <label
            v-for="opt in hideModeOptions"
            :key="opt.value"
            class="flex items-start gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded"
          >
            <input
              v-model="settings.hideMode"
              :value="opt.value"
              type="radio"
              name="sib-hide-mode"
              class="mt-1 accent-primary-600"
            />
            <span class="min-w-0">
              <span class="block">{{ opt.label }}</span>
              <span class="block text-xs text-gray-500 dark:text-gray-400">{{
                opt.desc
              }}</span>
            </span>
          </label>
        </div>
      </section>

      <!-- 全域開關 -->
      <section
        v-if="showTab('mode')"
        class="mb-6 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
      >
        <label class="flex items-center justify-between gap-3 cursor-pointer">
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ t.globalBlock }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              {{ t.globalBlockDesc }}
            </div>
          </div>
          <input
            v-model="settings.globalBlock"
            type="checkbox"
            class="w-4 h-4 shrink-0 accent-primary-600"
          />
        </label>

        <div class="my-2.5 border-t border-gray-200 dark:border-gray-700" />

        <label class="flex items-center justify-between gap-3 cursor-pointer">
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ t.perResultBlock }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              {{ t.perResultBlockDesc }}
            </div>
          </div>
          <input
            v-model="settings.perResultBlock"
            type="checkbox"
            class="w-4 h-4 shrink-0 accent-primary-600"
          />
        </label>

        <div class="my-2.5 border-t border-gray-200 dark:border-gray-700" />

        <label class="flex items-center justify-between gap-3 cursor-pointer">
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ t.pageIndicator }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              {{ t.pageIndicatorDesc }}
            </div>
          </div>
          <input
            v-model="settings.pageIndicator"
            type="checkbox"
            class="w-4 h-4 shrink-0 accent-primary-600"
          />
        </label>
      </section>

      <!--
        要隱藏的區塊分兩組：夾帶圖片的，與會連文字一起隱藏的整塊區域。
        後兩項性質不同（預設關閉、會擋掉文字），並排成一列看不出差別。
      -->
      <template v-if="showTab('blocks')">
        <section v-for="group in blockGroups" :key="group.title" class="mb-6">
          <h2
            class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2"
          >
            {{ group.title }}
          </h2>
          <p
            v-if="group.hint"
            class="text-xs text-gray-500 dark:text-gray-400 mb-2 leading-relaxed"
          >
            {{ group.hint }}
          </p>
          <div class="space-y-1.5">
            <label
              v-for="item in group.items"
              :key="item.key"
              class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded"
            >
              <input
                v-model="settings.blockTypes[item.key]"
                type="checkbox"
                class="shrink-0 accent-primary-600"
              />
              {{ item.label }}
            </label>
          </div>
        </section>
      </template>

      <!-- 觸發分類 -->
      <section v-if="showTab('keywords')" class="mb-6">
        <div class="flex items-center justify-between mb-2">
          <h2
            class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide"
          >
            {{ t.categoriesTitle }}
          </h2>
          <button
            type="button"
            class="text-xs text-primary-600 dark:text-primary-400 hover:underline"
            @click="showAddCategory = !showAddCategory"
          >
            + {{ t.addCategoryBtn }}
          </button>
        </div>

        <!-- 還原內建分類 -->
        <div
          v-if="showAddCategory && availableDefaults.length"
          class="mb-2 flex flex-wrap items-center gap-1.5"
        >
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {{ t.restoreDefaultsLabel }}
          </span>
          <button
            v-for="d in availableDefaults"
            :key="d.id"
            type="button"
            class="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-primary-100 dark:hover:bg-primary-900/40 text-gray-700 dark:text-gray-300 rounded-md border border-gray-200 dark:border-gray-700"
            @click="handleRestoreDefault(d.id)"
          >
            + {{ d.label }}
          </button>
        </div>

        <!-- 範本快速加入 -->
        <div
          v-if="showAddCategory && availablePresets.length"
          class="mb-2 flex flex-wrap items-center gap-1.5"
        >
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {{ t.presetsLabel }}
          </span>
          <button
            v-for="p in availablePresets"
            :key="p.id"
            type="button"
            class="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-primary-100 dark:hover:bg-primary-900/40 text-gray-700 dark:text-gray-300 rounded-md border border-gray-200 dark:border-gray-700"
            @click="handleAddPreset(p.id)"
          >
            + {{ p.label }}
          </button>
        </div>

        <!-- 新增分類表單 -->
        <form
          v-if="showAddCategory"
          class="flex gap-2 mb-2"
          @submit.prevent="handleAddCategory"
        >
          <input
            v-model="newCategoryName"
            type="text"
            :placeholder="t.newCategoryPlaceholder"
            :maxlength="MAX_LABEL_LEN"
            class="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="submit"
            class="px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-md transition-colors"
          >
            {{ t.addBtn }}
          </button>
          <button
            type="button"
            class="px-2 py-1.5 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
            @click="
              showAddCategory = false;
              newCategoryName = '';
            "
          >
            {{ t.cancelBtn }}
          </button>
        </form>

        <draggable
          v-model="orderedCategories"
          :item-key="(c: Category) => c.id"
          handle=".drag-handle"
          ghost-class="sib-drag-ghost"
          chosen-class="sib-drag-chosen"
          animation="160"
          class="space-y-1"
          tag="div"
        >
          <template #item="{ element: cat }">
            <div
              class="rounded border border-gray-200 dark:border-gray-700 flex items-stretch bg-white dark:bg-gray-900"
            >
              <label
                class="flex items-start gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded-l flex-1 min-w-0"
              >
                <input
                  v-model="settings.enabledCategories"
                  :value="cat.id"
                  type="checkbox"
                  class="mt-0.5 shrink-0 accent-primary-600"
                />
                <div class="flex-1 min-w-0">
                  <div class="font-medium truncate">{{ cat.label }}</div>
                  <div
                    class="text-xs text-gray-500 dark:text-gray-400 flex items-baseline gap-1 min-w-0"
                  >
                    <span
                      v-if="cat.keywords.length > 0"
                      class="truncate min-w-0"
                    >
                      {{ cat.keywords.slice(0, 3).join(t.keywordSep)
                      }}{{ cat.keywords.length > 3 ? "…" : "" }} ·
                    </span>
                    <button
                      type="button"
                      class="text-primary-600 dark:text-primary-400 hover:underline shrink-0"
                      @click.prevent="toggleExpand(cat.id)"
                    >
                      {{
                        expandedCategory === cat.id
                          ? t.collapse
                          : t.keywordCount(cat.keywords.length)
                      }}
                    </button>
                  </div>
                  <div
                    v-if="expandedCategory === cat.id"
                    class="mt-1.5 text-xs text-gray-600 dark:text-gray-300 leading-relaxed break-all"
                  >
                    {{ cat.keywords.join(t.keywordSep) }}
                  </div>
                </div>
              </label>
              <button
                type="button"
                class="px-1.5 flex items-center text-gray-400 hover:text-primary-600 dark:text-gray-500 dark:hover:text-primary-400"
                :title="t.openCategoryAria"
                :aria-label="t.openCategoryAria"
                @click="openCategory(cat.id)"
              >
                <svg
                  viewBox="0 0 20 20"
                  class="w-4 h-4 fill-current"
                  aria-hidden="true"
                >
                  <path
                    d="M7.05 4.05a1 1 0 0 1 1.414 0l5.243 5.243a1 1 0 0 1 0 1.414L8.464 15.95a1 1 0 0 1-1.414-1.414L11.586 10 7.05 5.464a1 1 0 0 1 0-1.414Z"
                  />
                </svg>
              </button>
              <div
                class="drag-handle px-2 flex items-center cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-300 select-none touch-none"
                :title="t.dragHandleAria"
                :aria-label="t.dragHandleAria"
              >
                <!-- 6 點 grip 圖示 -->
                <svg
                  viewBox="0 0 16 16"
                  class="w-3.5 h-4 fill-current"
                  aria-hidden="true"
                >
                  <circle cx="6" cy="3" r="1.4" />
                  <circle cx="10" cy="3" r="1.4" />
                  <circle cx="6" cy="8" r="1.4" />
                  <circle cx="10" cy="8" r="1.4" />
                  <circle cx="6" cy="13" r="1.4" />
                  <circle cx="10" cy="13" r="1.4" />
                </svg>
              </div>
            </div>
          </template>
        </draggable>
      </section>

      <!--
        例外關鍵字：寬版面直接攤開（有空間，攤開比多點一層好用）；
        popup 只留入口，57 條 chip 會把 360 px 的畫面撐爆。
      -->
      <KeywordSection
        v-if="props.wide"
        :title="t.allowKeywordsTitle"
        :keywords="settings.allowKeywords"
        :placeholder="t.allowKeywordPlaceholder"
        :empty-text="t.noAllowKeywords"
        :hint="t.allowKeywordsHint"
        :t="t"
        :add="addAllowKeyword"
        :remove="removeAllowKeyword"
        tone="allow"
        searchable
        bulk
        class="mb-6"
      />
      <section v-else-if="showTab('keywords')" class="mb-6">
        <h2
          class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2"
        >
          {{ t.allowKeywordsTitle }}
        </h2>
        <button
          type="button"
          class="w-full flex items-center gap-2 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors"
          @click="openAllowKeywords"
        >
          <span
            class="flex-1 min-w-0 truncate text-xs text-gray-500 dark:text-gray-400"
          >
            <template v-if="settings.allowKeywords.length">
              {{ allowKeywordsPreview }} ·
              {{ t.keywordCount(settings.allowKeywords.length) }}
            </template>
            <template v-else>{{ t.noAllowKeywords }}</template>
          </span>
          <svg
            viewBox="0 0 20 20"
            class="w-4 h-4 fill-current text-gray-400 dark:text-gray-500 shrink-0"
            aria-hidden="true"
          >
            <path
              d="M7.05 4.05a1 1 0 0 1 1.414 0l5.243 5.243a1 1 0 0 1 0 1.414L8.464 15.95a1 1 0 0 1-1.414-1.414L11.586 10 7.05 5.464a1 1 0 0 1 0-1.414Z"
            />
          </svg>
        </button>
      </section>

      <!-- 自訂關鍵字 -->
      <KeywordSection
        v-if="showTab('keywords')"
        :title="t.customKeywordsTitle"
        :keywords="settings.keywords"
        :placeholder="t.keywordPlaceholder"
        :empty-text="t.noKeywords"
        :t="t"
        :add="addKeyword"
        :remove="removeKeyword"
        tone="block"
        :searchable="props.wide"
        :bulk="props.wide"
        class="mb-6"
      />

      <!--
        快捷鍵只在設定頁列出來。使用者不會自己去 chrome://extensions/shortcuts
        翻，所以功能存在等於不存在；而 popup 已經沒有空間再多一個區塊。
        鍵位是從 commands.getAll() 讀的，改過的組合也會顯示正確的那一個。
      -->
      <section v-if="props.wide && shortcuts.length" class="mb-6">
        <h2
          class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2"
        >
          {{ t.shortcutsTitle }}
        </h2>
        <dl class="space-y-1.5">
          <div
            v-for="sc in shortcuts"
            :key="sc.label"
            class="flex items-baseline justify-between gap-2 text-sm p-1.5"
          >
            <dt class="min-w-0 truncate">{{ sc.label }}</dt>
            <dd
              class="shrink-0 px-1.5 py-0.5 text-xs font-mono rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
            >
              {{ sc.shortcut }}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          class="mt-2 text-xs text-primary-600 dark:text-primary-400 hover:underline"
          @click="openShortcutSettings"
        >
          {{ t.shortcutsCustomize }}
        </button>
      </section>
      <!--
        儲存配額量的就是這幾份關鍵字清單，放在它們旁邊才有意義；
        擺在 footer 只是個跟上下文無關的讀數。
      -->
      <div
        v-if="showTab('keywords') && storageBytes > 0"
        class="mb-6 text-xs text-gray-400 dark:text-gray-500"
      >
        <div class="flex justify-between mb-1">
          <span>{{ t.storageLabel }}</span>
          <span
            :class="
              storagePercent >= 90
                ? 'text-red-500'
                : storagePercent >= 70
                  ? 'text-amber-500'
                  : ''
            "
            >{{ storageKB }} / 100 KB</span
          >
        </div>
        <div
          class="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
        >
          <div
            :class="[
              storageBarColor,
              'h-full rounded-full transition-all duration-500',
            ]"
            :style="{ width: storagePercent + '%' }"
          />
        </div>
      </div>

      </div>

      <!-- 隱私權政策常駐 —— 不分頁、不隨狀態消失 -->
      <footer
        class="mt-6 pt-3 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500 text-center"
      >
        <a
          href="/privacy.html"
          target="_blank"
          rel="noopener"
          class="hover:text-gray-600 dark:hover:text-gray-300 underline underline-offset-2"
          >{{ t.privacyPolicy }}</a
        >
      </footer>
    </template>

    <!-- 分類詳情頁 -->
    <CategoryDetail
      v-else-if="detailCategory"
      :category="detailCategory"
      :t="t"
      :wide="props.wide"
      :set-cat-label="setCatLabel"
      :add-cat-keyword="addCatKeyword"
      :remove-cat-keyword="removeCatKeyword"
      :remove-category="removeCategory"
      @deleted="backToMain"
    />

    <!-- 例外關鍵字子頁（標題已在 header，這裡不重複下標題） -->
    <KeywordSection
      v-else-if="view.name === 'allowKeywords'"
      :keywords="settings.allowKeywords"
      :placeholder="t.allowKeywordPlaceholder"
      :empty-text="t.noAllowKeywords"
      :hint="t.allowKeywordsHint"
      :t="t"
      :add="addAllowKeyword"
      :remove="removeAllowKeyword"
      tone="allow"
      searchable
    />
  </div>
</template>
