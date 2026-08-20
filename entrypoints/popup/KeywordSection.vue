<script setup lang="ts">
/**
 * 「標題 + 輸入框 + chip 清單」的關鍵字管理區塊。
 *
 * 三個地方用同一套互動（新增走 Enter、× 移除、非 'added' 時邊框轉紅 2.5 秒）：
 * 自訂關鍵字、例外關鍵字、分類詳情頁的關鍵字。抽成元件是為了讓驗證回饋只有
 * 一份實作 —— 之前 App.vue 與 CategoryDetail.vue 各有一份幾乎相同的複製品。
 *
 * `tone` 決定 chip 顏色，這是有意義的區分而非裝飾：
 * 藍色 = 命中會擋，綠色 = 命中會放行。
 *
 * `searchable` / `bulk` 預設關閉，只有寬版面（獨立設定頁）會打開 —— 360 px 的
 * popup 再多兩個輸入框就塞不下了，而這兩個功能本來也是「幾百個關鍵字」才需要。
 */
import { computed, ref } from 'vue'
import {
  MAX_KEYWORD_LEN,
  addManyKeywords,
  type AddKeywordResult,
  type AddManyResult,
} from '@/composables/useBlockList'
import type { Messages } from './i18n'

const props = withDefaults(
  defineProps<{
    /** 省略時不畫標題 —— 子頁的 header 已經是標題了，不需要重複 */
    title?: string
    keywords: string[]
    placeholder: string
    emptyText: string
    t: Messages
    add: (keyword: string) => AddKeywordResult
    remove: (keyword: string) => void
    tone?: 'block' | 'allow'
    hint?: string
    /** 顯示篩選框（清單長到一定程度才會出現） */
    searchable?: boolean
    /** 顯示批次貼上 */
    bulk?: boolean
  }>(),
  {
    tone: 'block',
    title: undefined,
    hint: undefined,
    searchable: false,
    bulk: false,
  },
)

/** 低於這個數量，用眼睛掃比用篩選框快 —— 早早就冒出一個輸入框只是雜訊 */
const FILTER_THRESHOLD = 12

const draft = ref('')
const error = ref<AddKeywordResult | null>(null)
let errorTimer = 0

function handleAdd() {
  const result = props.add(draft.value)
  if (result === 'added') {
    draft.value = ''
    error.value = null
    return
  }
  clearTimeout(errorTimer)
  error.value = result
  errorTimer = window.setTimeout(() => {
    error.value = null
  }, 2500)
}

const filter = ref('')
const showFilter = computed(
  () => props.searchable && props.keywords.length >= FILTER_THRESHOLD,
)
const visibleKeywords = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  if (!showFilter.value || !needle) return props.keywords
  return props.keywords.filter((k) => k.toLowerCase().includes(needle))
})

const showBulk = ref(false)
const bulkDraft = ref('')
const bulkSummary = ref<AddManyResult | null>(null)
let bulkTimer = 0

function handleBulk() {
  const summary = addManyKeywords(bulkDraft.value, props.add)
  bulkSummary.value = summary
  if (summary.added > 0) {
    bulkDraft.value = ''
    showBulk.value = false
  }
  clearTimeout(bulkTimer)
  bulkTimer = window.setTimeout(() => {
    bulkSummary.value = null
  }, 4000)
}

const CHIP_CLASS = {
  block:
    'bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 hover:text-primary-900 dark:hover:text-primary-100',
  allow:
    'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100',
} as const
</script>

<template>
  <section>
    <div v-if="title || bulk" class="flex items-center justify-between mb-2">
      <h2
        v-if="title"
        class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide"
      >
        {{ title }}
      </h2>
      <span v-else />
      <button
        v-if="bulk"
        type="button"
        class="text-xs text-primary-600 dark:text-primary-400 hover:underline"
        @click="showBulk = !showBulk"
      >
        {{ t.bulkAddBtn }}
      </button>
    </div>
    <p v-if="hint" class="text-xs text-gray-500 dark:text-gray-400 mb-2 leading-relaxed">
      {{ hint }}
    </p>

    <form v-if="showBulk" class="mb-2" @submit.prevent="handleBulk">
      <textarea
        v-model="bulkDraft"
        rows="4"
        :placeholder="t.bulkPlaceholder"
        class="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
      />
      <div class="mt-1.5 flex gap-2 justify-end">
        <button
          type="button"
          class="px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          @click="
            showBulk = false;
            bulkDraft = '';
          "
        >
          {{ t.cancelBtn }}
        </button>
        <button
          type="submit"
          class="px-3 py-1 text-xs bg-primary-600 hover:bg-primary-700 text-white rounded-md transition-colors"
        >
          {{ t.bulkApplyBtn }}
        </button>
      </div>
    </form>
    <p
      v-if="bulkSummary"
      class="mb-2 text-xs text-gray-500 dark:text-gray-400"
      role="status"
    >
      {{ t.bulkResult(bulkSummary) }}
    </p>

    <form :class="['flex gap-2', error ? 'mb-0' : 'mb-2']" @submit.prevent="handleAdd">
      <input
        v-model="draft"
        type="text"
        :placeholder="placeholder"
        :maxlength="MAX_KEYWORD_LEN"
        :class="[
          'flex-1 px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:border-transparent dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500',
          error
            ? 'border-red-400 dark:border-red-600 focus:ring-red-400'
            : 'border-gray-300 dark:border-gray-700 focus:ring-primary-500',
        ]"
        @input="error = null"
      />
      <button
        type="submit"
        class="px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-md transition-colors"
      >
        {{ t.addBtn }}
      </button>
    </form>
    <p v-if="error" class="mt-1 mb-2 text-xs text-red-500 dark:text-red-400">
      {{
        error === "duplicate"
          ? t.errorDuplicate
          : error === "too_long"
            ? t.errorTooLong
            : t.errorEmpty
      }}
    </p>

    <input
      v-if="showFilter"
      v-model="filter"
      type="search"
      :placeholder="t.keywordFilterPlaceholder"
      :aria-label="t.keywordFilterPlaceholder"
      class="w-full mb-2 px-3 py-1 text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
    />

    <div
      v-if="keywords.length === 0"
      class="text-xs text-gray-400 dark:text-gray-500 text-center py-3"
    >
      {{ emptyText }}
    </div>
    <div
      v-else-if="visibleKeywords.length === 0"
      class="text-xs text-gray-400 dark:text-gray-500 text-center py-3"
    >
      {{ t.keywordFilterEmpty }}
    </div>
    <ul v-else class="flex flex-wrap gap-1.5">
      <li
        v-for="kw in visibleKeywords"
        :key="kw"
        :class="[
          'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md max-w-[10rem] overflow-hidden',
          CHIP_CLASS[tone],
        ]"
      >
        <span class="truncate" :title="kw">{{ kw }}</span>
        <button
          type="button"
          class="font-bold leading-none"
          :aria-label="t.removeAria(kw)"
          @click="remove(kw)"
        >
          ×
        </button>
      </li>
    </ul>
  </section>
</template>
