<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useBlocklist, CATEGORIES, type Locale } from '@/composables/useBlocklist'

const { settings, loaded, addKeyword, removeKeyword } = useBlocklist()
const newKeyword = ref('')
const expandedCategory = ref<string | null>(null)

// i18n 字串表 — 加新字串就在這兩邊各補一筆
const messages = {
  'zh-TW': {
    subtitle: '隱藏 Google 搜尋的視覺干擾',
    loading: '載入中…',
    globalBlock: '全域阻擋',
    globalBlockDesc: '不論搜尋什麼都隱藏',
    blockTypesTitle: '要隱藏的區塊',
    blockImages: '圖片橫幅 / 圖片輪播',
    blockVideos: '影片卡片',
    blockSearchPreview: '搜尋建議縮圖（autocomplete）',
    blockRelatedQuestions: '相關問題',
    blockKnowledgePanel: '知識面板（右側）',
    categoriesTitle: '觸發分類',
    keywordCount: (n: number) => `${n} 個關鍵字`,
    collapse: '收合',
    customKeywordsTitle: '自訂關鍵字',
    keywordPlaceholder: '輸入關鍵字後 Enter',
    addBtn: '新增',
    noKeywords: '尚未設定關鍵字',
    removeAria: (kw: string) => `移除 ${kw}`,
    footer: '重新整理 Google 搜尋頁以套用變更',
    keywordSep: '、',
    themeToggleAria: '切換主題',
    localeToggleAria: '切換語言',
  },
  en: {
    subtitle: 'Hide visual clutter from Google Search',
    loading: 'Loading…',
    globalBlock: 'Block all',
    globalBlockDesc: 'Hide regardless of what you search',
    blockTypesTitle: 'What to hide',
    blockImages: 'Image banner / carousel',
    blockVideos: 'Video cards',
    blockSearchPreview: 'Autocomplete preview thumbnails',
    blockRelatedQuestions: 'Related questions',
    blockKnowledgePanel: 'Knowledge panel (right)',
    categoriesTitle: 'Trigger categories',
    keywordCount: (n: number) => `${n} keywords`,
    collapse: 'Collapse',
    customKeywordsTitle: 'Custom keywords',
    keywordPlaceholder: 'Type a keyword and press Enter',
    addBtn: 'Add',
    noKeywords: 'No custom keywords yet',
    removeAria: (kw: string) => `Remove ${kw}`,
    footer: 'Reload the Google search page to apply changes',
    keywordSep: ', ',
    themeToggleAria: 'Toggle theme',
    localeToggleAria: 'Toggle language',
  },
} as const

const t = computed(() => messages[settings.value.locale])

// theme 變動時：套 dark class、寫 localStorage cache（給下次 popup 開啟時 main.ts 同步讀）
watch(
  () => settings.value.theme,
  (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('sib_theme', theme)
  },
  { immediate: true }
)

function handleAdd() {
  addKeyword(newKeyword.value)
  newKeyword.value = ''
}

function toggleExpand(id: string) {
  expandedCategory.value = expandedCategory.value === id ? null : id
}

function toggleTheme() {
  settings.value.theme = settings.value.theme === 'dark' ? 'light' : 'dark'
}

function toggleLocale() {
  const next: Locale = settings.value.locale === 'zh-TW' ? 'en' : 'zh-TW'
  settings.value.locale = next
}
</script>

<template>
  <div class="bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 p-4">
    <header class="flex items-center gap-2 mb-4">
      <img class="w-8 h-8" src="/icon/128.png" alt="logo">
      <div class="flex-1 min-w-0">
        <h1 class="text-base font-semibold leading-tight truncate">Search Image Blocker</h1>
        <p class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ t.subtitle }}</p>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button
          type="button"
          :title="t.themeToggleAria"
          :aria-label="t.themeToggleAria"
          class="w-7 h-7 rounded hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-base leading-none"
          @click="toggleTheme"
        >
          {{ settings.theme === 'dark' ? '☀️' : '🌙' }}
        </button>
        <button
          type="button"
          :title="t.localeToggleAria"
          :aria-label="t.localeToggleAria"
          class="px-2 h-7 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-xs font-semibold tabular-nums"
          @click="toggleLocale"
        >
          {{ settings.locale === 'zh-TW' ? 'EN' : '中' }}
        </button>
      </div>
    </header>

    <div v-if="!loaded" class="text-center text-sm text-gray-400 dark:text-gray-500 py-8">
      {{ t.loading }}
    </div>

    <template v-else>
      <!-- 全域開關 -->
      <section class="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        <label class="flex items-center justify-between cursor-pointer">
          <div>
            <div class="text-sm font-medium">{{ t.globalBlock }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400">{{ t.globalBlockDesc }}</div>
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
        <h2 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
          {{ t.blockTypesTitle }}
        </h2>
        <div class="space-y-1.5">
          <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded">
            <input v-model="settings.blockTypes.images" type="checkbox" class="accent-primary-600" />
            {{ t.blockImages }}
          </label>
          <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded">
            <input v-model="settings.blockTypes.videos" type="checkbox" class="accent-primary-600" />
            {{ t.blockVideos }}
          </label>
          <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded">
            <input v-model="settings.blockTypes.searchPreview" type="checkbox" class="accent-primary-600" />
            {{ t.blockSearchPreview }}
          </label>
          <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded">
            <input v-model="settings.blockTypes.relatedQuestions" type="checkbox" class="accent-primary-600" />
            {{ t.blockRelatedQuestions }}
          </label>
          <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1.5 rounded">
            <input v-model="settings.blockTypes.knowledgePanel" type="checkbox" class="accent-primary-600" />
            {{ t.blockKnowledgePanel }}
          </label>
        </div>
      </section>

      <!-- 觸發分類 -->
      <section class="mb-4">
        <h2 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
          {{ t.categoriesTitle }}
        </h2>
        <div class="space-y-1">
          <div
            v-for="cat in CATEGORIES"
            :key="cat.id"
            class="rounded border border-gray-200 dark:border-gray-700"
          >
            <label class="flex items-start gap-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded">
              <input
                v-model="settings.enabledCategories"
                :value="cat.id"
                type="checkbox"
                class="mt-0.5 accent-primary-600"
              />
              <div class="flex-1 min-w-0">
                <div class="font-medium">{{ cat.label[settings.locale] }}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {{ cat.description[settings.locale] }}
                  ·
                  <button
                    type="button"
                    class="text-primary-600 dark:text-primary-400 hover:underline"
                    @click.prevent="toggleExpand(cat.id)"
                  >
                    {{ expandedCategory === cat.id ? t.collapse : t.keywordCount(cat.keywords.length) }}
                  </button>
                </div>
                <div
                  v-if="expandedCategory === cat.id"
                  class="mt-1.5 text-xs text-gray-600 dark:text-gray-300 leading-relaxed"
                >
                  {{ cat.keywords.join(t.keywordSep) }}
                </div>
              </div>
            </label>
          </div>
        </div>
      </section>

      <!-- 自訂關鍵字 -->
      <section>
        <h2 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
          {{ t.customKeywordsTitle }}
        </h2>

        <form class="flex gap-2 mb-2" @submit.prevent="handleAdd">
          <input
            v-model="newKeyword"
            type="text"
            :placeholder="t.keywordPlaceholder"
            class="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="submit"
            class="px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-md transition-colors"
          >
            {{ t.addBtn }}
          </button>
        </form>

        <div v-if="settings.keywords.length === 0" class="text-xs text-gray-400 dark:text-gray-500 text-center py-3">
          {{ t.noKeywords }}
        </div>

        <ul v-else class="flex flex-wrap gap-1.5">
          <li
            v-for="kw in settings.keywords"
            :key="kw"
            class="inline-flex items-center gap-1 px-2 py-1 bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs rounded-md"
          >
            <span>{{ kw }}</span>
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

      <footer class="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500 text-center">
        {{ t.footer }}
      </footer>
    </template>
  </div>
</template>
