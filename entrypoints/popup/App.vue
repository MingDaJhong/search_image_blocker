<script setup lang="ts">
import { computed, ref, watch } from "vue";
import draggable from "vuedraggable";
import { browser } from "wxt/browser";
import {
  useBlockList,
  findBlockMatch,
  shouldBlock,
  parseImport,
  mergeSettings,
  STORAGE_KEY,
  PRESET_TEMPLATES,
  DEFAULT_CATEGORIES,
  MAX_KEYWORD_LEN,
  MAX_LABEL_LEN,
  type Locale,
  type Category,
  type AddKeywordResult,
  type BlocklistSettings,
} from "@/composables/useBlockList";
import { messages, type Messages } from "./i18n";
import CategoryDetail from "./CategoryDetail.vue";

const {
  settings,
  loaded,
  saveError,
  addKeyword,
  removeKeyword,
  addCategory,
  addCategoryFromPreset,
  addCategoryFromDefault,
  removeCategory,
  setCatLabel,
  addCatKeyword,
  removeCatKeyword,
} = useBlockList();
const newKeyword = ref("");
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

watch(loaded, async (isLoaded) => {
  if (!isLoaded) return;
  refreshStorageUsage();
  // 截圖模式：popup 以分頁開啟並帶 ?q=<關鍵字> 時，跳過 tabs API
  // 直接把該關鍵字當成「目前搜尋字串」，方便擷取阻擋 banner 畫面。
  const overrideQ = new URL(location.href).searchParams.get("q");
  if (overrideQ !== null) {
    currentSearchQuery.value = overrideQ;
    return;
  }
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const url = tabs[0]?.url ? new URL(tabs[0].url) : null;
    if (
      !url ||
      !url.hostname.includes("google.com") ||
      url.pathname !== "/search"
    )
      return;
    currentSearchQuery.value = url.searchParams.get("q") ?? "";
  } catch {
    // tabs API 不可用或 URL 無法存取
  }
});

// 視圖狀態：null = 主畫面；string = 該 category id 的詳情頁
const detailCategoryId = ref<string | null>(null);
const detailCategory = computed<Category | null>(() => {
  const id = detailCategoryId.value;
  if (!id) return null;
  return settings.value.customCategories.find((c) => c.id === id) ?? null;
});

// 新增分類表單狀態
const showAddCategory = ref(false);
const newCategoryName = ref("");

function openCategory(id: string) {
  detailCategoryId.value = id;
}
function closeCategory() {
  detailCategoryId.value = null;
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

// theme 變動時：套 dark class、寫 localStorage cache（給下次 popup 開啟時 main.ts 同步讀）
watch(
  () => settings.value.theme,
  (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("sib_theme", theme);
  },
  { immediate: true },
);

const newKeywordError = ref<AddKeywordResult | null>(null);
let newKeywordErrorTimer = 0;

function handleAdd() {
  const result = addKeyword(newKeyword.value);
  if (result === "added") {
    newKeyword.value = "";
    newKeywordError.value = null;
    return;
  }
  clearTimeout(newKeywordErrorTimer);
  newKeywordError.value = result;
  newKeywordErrorTimer = window.setTimeout(() => {
    newKeywordError.value = null;
  }, 2500);
}

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
const storageBytes = ref(0);
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
  <div class="bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 p-4">
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
    <header v-if="!detailCategory" class="flex items-center gap-2 mb-4">
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
        @click="closeCategory"
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
        {{ detailCategory.label }}
      </h1>
    </header>

    <div
      v-if="!loaded"
      class="text-center text-sm text-gray-400 dark:text-gray-500 py-8"
    >
      {{ t.loading }}
    </div>

    <template v-else-if="!detailCategory">
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

      <!-- 目前阻擋來源提示 -->
      <div
        v-if="blockMatch"
        class="mb-4 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md text-xs text-blue-700 dark:text-blue-300"
      >
        {{ t.blockedByMsg(blockMatch.keyword, blockMatch.categoryLabel) }}
      </div>

      <!-- 全域開關 -->
      <section
        class="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
      >
        <label class="flex items-center justify-between cursor-pointer">
          <div>
            <div class="text-sm font-medium">{{ t.globalBlock }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              {{ t.globalBlockDesc }}
            </div>
          </div>
          <input
            v-model="settings.globalBlock"
            type="checkbox"
            class="w-4 h-4 accent-primary-600"
          />
        </label>
      </section>

      <!-- 區塊類型 -->
      <section class="mb-4">
        <h2
          class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2"
        >
          {{ t.blockTypesTitle }}
        </h2>
        <div class="space-y-1.5">
          <label
            class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded"
          >
            <input
              v-model="settings.blockTypes.thumbnails"
              type="checkbox"
              class="accent-primary-600"
            />
            {{ t.blockThumbnails }}
          </label>
          <label
            class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded"
          >
            <input
              v-model="settings.blockTypes.searchPreview"
              type="checkbox"
              class="accent-primary-600"
            />
            {{ t.blockSearchPreview }}
          </label>
          <label
            class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded"
          >
            <input
              v-model="settings.blockTypes.images"
              type="checkbox"
              class="accent-primary-600"
            />
            {{ t.blockImages }}
          </label>
          <label
            class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded"
          >
            <input
              v-model="settings.blockTypes.videos"
              type="checkbox"
              class="accent-primary-600"
            />
            {{ t.blockVideos }}
          </label>
          <label
            class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded"
          >
            <input
              v-model="settings.blockTypes.relatedQuestions"
              type="checkbox"
              class="accent-primary-600"
            />
            {{ t.blockRelatedQuestions }}
          </label>
          <label
            class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded"
          >
            <input
              v-model="settings.blockTypes.knowledgePanel"
              type="checkbox"
              class="accent-primary-600"
            />
            {{ t.blockKnowledgePanel }}
          </label>
        </div>
      </section>
      <div
        v-if="saveError"
        class="mt-3 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-xs text-red-600 dark:text-red-400 mb-3"
      >
        {{ t.saveError }}
      </div>

      <!-- 觸發分類 -->
      <section class="mb-4">
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
                  class="mt-0.5 accent-primary-600"
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

      <!-- 自訂關鍵字 -->
      <section>
        <h2
          class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2"
        >
          {{ t.customKeywordsTitle }}
        </h2>

        <form
          :class="['flex gap-2', newKeywordError ? 'mb-0' : 'mb-2']"
          @submit.prevent="handleAdd"
        >
          <input
            v-model="newKeyword"
            type="text"
            :placeholder="t.keywordPlaceholder"
            :maxlength="MAX_KEYWORD_LEN"
            :class="[
              'flex-1 px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:border-transparent dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500',
              newKeywordError
                ? 'border-red-400 dark:border-red-600 focus:ring-red-400'
                : 'border-gray-300 dark:border-gray-700 focus:ring-primary-500',
            ]"
            @input="newKeywordError = null"
          />
          <button
            type="submit"
            class="px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-md transition-colors"
          >
            {{ t.addBtn }}
          </button>
        </form>
        <p
          v-if="newKeywordError"
          class="mt-1 mb-1 text-xs text-red-500 dark:text-red-400"
        >
          {{
            newKeywordError === "duplicate" ? t.errorDuplicate : newKeywordError === "too_long" ? t.errorTooLong : t.errorEmpty
          }}
        </p>

        <div
          v-if="settings.keywords.length === 0"
          class="text-xs text-gray-400 dark:text-gray-500 text-center py-3"
        >
          {{ t.noKeywords }}
        </div>

        <ul v-else class="flex flex-wrap gap-1.5">
          <li
            v-for="kw in settings.keywords"
            :key="kw"
            class="inline-flex items-center gap-1 px-2 py-1 bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs rounded-md max-w-[10rem] overflow-hidden"
          >
            <span class="truncate" :title="kw">{{ kw }}</span>
            <button
              class="hover:text-primary-900 dark:hover:text-primary-100 font-bold leading-none"
              :aria-label="t.removeAria(kw)"
              @click="removeKeyword(kw)"
            >
              ×
            </button>
          </li>
        </ul>
      </section>

      <footer
        class="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500"
      >
        <!-- 儲存配額進度條 -->
        <div v-if="storageBytes > 0" class="mb-2">
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
        <div
          class="text-center"
          :class="{
            'mt-4 pt-3 border-t border-gray-200 dark:border-gray-800':
              storageBytes > 0,
          }"
        >
          <a
            href="/privacy.html"
            target="_blank"
            rel="noopener"
            class="hover:text-gray-600 dark:hover:text-gray-300 underline underline-offset-2"
            >{{ t.privacyPolicy }}</a
          >
        </div>
      </footer>
    </template>

    <!-- 分類詳情頁 -->
    <CategoryDetail
      v-else
      :category="detailCategory"
      :t="t"
      :set-cat-label="setCatLabel"
      :add-cat-keyword="addCatKeyword"
      :remove-cat-keyword="removeCatKeyword"
      :remove-category="removeCategory"
      @deleted="closeCategory"
    />
  </div>
</template>
