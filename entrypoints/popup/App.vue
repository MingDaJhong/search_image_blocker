<script setup lang="ts">
import { ref } from 'vue'
import { useBlocklist, CATEGORIES } from '@/composables/useBlocklist'

const { settings, loaded, addKeyword, removeKeyword } = useBlocklist()
const newKeyword = ref('')
const expandedCategory = ref<string | null>(null)

function handleAdd() {
  addKeyword(newKeyword.value)
  newKeyword.value = ''
}

function toggleExpand(id: string) {
  expandedCategory.value = expandedCategory.value === id ? null : id
}
</script>

<template>
  <div class="bg-white text-gray-800 p-4">
    <header class="flex items-center gap-2 mb-4">
      <div class="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold">
        🛡️
      </div>
      <div>
        <h1 class="text-base font-semibold leading-tight">Search Image Blocker</h1>
        <p class="text-xs text-gray-500">隱藏 Google 搜尋的視覺干擾</p>
      </div>
    </header>

    <div v-if="!loaded" class="text-center text-sm text-gray-400 py-8">
      載入中…
    </div>

    <template v-else>
      <!-- 全域開關 -->
      <section class="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200">
        <label class="flex items-center justify-between cursor-pointer">
          <div>
            <div class="text-sm font-medium">全域阻擋</div>
            <div class="text-xs text-gray-500">不論搜尋什麼都隱藏</div>
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
        <h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          要隱藏的區塊
        </h2>
        <div class="space-y-1.5">
          <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1.5 rounded">
            <input v-model="settings.blockTypes.images" type="checkbox" class="accent-primary-600" />
            圖片橫幅 / 圖片輪播
          </label>
          <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1.5 rounded">
            <input v-model="settings.blockTypes.videos" type="checkbox" class="accent-primary-600" />
            影片卡片
          </label>
          <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1.5 rounded">
            <input v-model="settings.blockTypes.relatedQuestions" type="checkbox" class="accent-primary-600" />
            相關問題
          </label>
          <label class="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1.5 rounded">
            <input v-model="settings.blockTypes.knowledgePanel" type="checkbox" class="accent-primary-600" />
            知識面板（右側）
          </label>
        </div>
      </section>

      <!-- 觸發分類 -->
      <section class="mb-4">
        <h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          觸發分類
        </h2>
        <div class="space-y-1">
          <div
            v-for="cat in CATEGORIES"
            :key="cat.id"
            class="rounded border border-gray-200"
          >
            <label class="flex items-start gap-2 text-sm cursor-pointer hover:bg-gray-50 p-2 rounded">
              <input
                v-model="settings.enabledCategories"
                :value="cat.id"
                type="checkbox"
                class="mt-0.5 accent-primary-600"
              />
              <div class="flex-1 min-w-0">
                <div class="font-medium">{{ cat.label }}</div>
                <div class="text-xs text-gray-500">
                  {{ cat.description }}
                  ·
                  <button
                    type="button"
                    class="text-primary-600 hover:underline"
                    @click.prevent="toggleExpand(cat.id)"
                  >
                    {{ expandedCategory === cat.id ? '收合' : `${cat.keywords.length} 個關鍵字` }}
                  </button>
                </div>
                <div
                  v-if="expandedCategory === cat.id"
                  class="mt-1.5 text-xs text-gray-600 leading-relaxed"
                >
                  {{ cat.keywords.join('、') }}
                </div>
              </div>
            </label>
          </div>
        </div>
      </section>

      <!-- 自訂關鍵字 -->
      <section>
        <h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          自訂關鍵字
        </h2>

        <form class="flex gap-2 mb-2" @submit.prevent="handleAdd">
          <input
            v-model="newKeyword"
            type="text"
            placeholder="輸入關鍵字後 Enter"
            class="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="submit"
            class="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors"
          >
            新增
          </button>
        </form>

        <div v-if="settings.keywords.length === 0" class="text-xs text-gray-400 text-center py-3">
          尚未設定關鍵字
        </div>

        <ul v-else class="flex flex-wrap gap-1.5">
          <li
            v-for="kw in settings.keywords"
            :key="kw"
            class="inline-flex items-center gap-1 px-2 py-1 bg-primary-50 text-primary-700 text-xs rounded-md"
          >
            <span>{{ kw }}</span>
            <button
              class="hover:text-primary-900 font-bold leading-none"
              :aria-label="`移除 ${kw}`"
              @click="removeKeyword(kw)"
            >
              ×
            </button>
          </li>
        </ul>
      </section>

      <footer class="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-400 text-center">
        重新整理 Google 搜尋頁以套用變更
      </footer>
    </template>
  </div>
</template>
