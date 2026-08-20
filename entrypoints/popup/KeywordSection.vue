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
 */
import { ref } from 'vue'
import { MAX_KEYWORD_LEN, type AddKeywordResult } from '@/composables/useBlockList'
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
  }>(),
  { tone: 'block', title: undefined, hint: undefined },
)

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

const CHIP_CLASS = {
  block:
    'bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 hover:text-primary-900 dark:hover:text-primary-100',
  allow:
    'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100',
} as const
</script>

<template>
  <section>
    <h2
      v-if="title"
      class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2"
    >
      {{ title }}
    </h2>
    <p v-if="hint" class="text-xs text-gray-500 dark:text-gray-400 mb-2 leading-relaxed">
      {{ hint }}
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

    <div
      v-if="keywords.length === 0"
      class="text-xs text-gray-400 dark:text-gray-500 text-center py-3"
    >
      {{ emptyText }}
    </div>
    <ul v-else class="flex flex-wrap gap-1.5">
      <li
        v-for="kw in keywords"
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
