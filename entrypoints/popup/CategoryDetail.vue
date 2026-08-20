<script setup lang="ts">
import { ref } from "vue";
import type { Category, AddKeywordResult } from "@/composables/useBlockList";
import { MAX_LABEL_LEN } from "@/composables/useBlockList";
import type { Messages } from "./i18n";
import KeywordSection from "./KeywordSection.vue";

const props = defineProps<{
  category: Category;
  t: Messages;
  setCatLabel: (id: string, label: string) => void;
  addCatKeyword: (id: string, keyword: string) => AddKeywordResult;
  removeCatKeyword: (id: string, keyword: string) => void;
  removeCategory: (id: string) => void;
}>();

const emit = defineEmits<{
  deleted: [];
}>();

const editingLabel = ref(false);
const labelDraft = ref("");

// 綁定到目前分類的 add / remove，交給 KeywordSection 使用
const addKeyword = (kw: string): AddKeywordResult =>
  props.addCatKeyword(props.category.id, kw);
const removeKeyword = (kw: string) => props.removeCatKeyword(props.category.id, kw);

function startEditLabel() {
  labelDraft.value = props.category.label;
  editingLabel.value = true;
}
function commitLabel() {
  props.setCatLabel(props.category.id, labelDraft.value);
  editingLabel.value = false;
}
function cancelEditLabel() {
  editingLabel.value = false;
}

function handleDelete() {
  props.removeCategory(props.category.id);
  emit("deleted");
}
</script>

<template>
  <section class="mb-4">
    <h2
      class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2"
    >
      {{ t.categoriesTitle }}
    </h2>
    <div class="flex items-center gap-2">
      <template v-if="!editingLabel">
        <div class="flex-1 min-w-0 text-sm font-medium truncate">
          {{ category.label }}
        </div>
        <button
          type="button"
          :title="t.editTitleAria"
          :aria-label="t.editTitleAria"
          class="px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          @click="startEditLabel"
        >
          ✎
        </button>
      </template>
      <template v-else>
        <input
          v-model="labelDraft"
          type="text"
          :maxlength="MAX_LABEL_LEN"
          class="flex-1 min-w-0 px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          @keyup.enter="commitLabel"
          @keyup.escape="cancelEditLabel"
        />
        <button
          type="button"
          class="px-2 py-1 text-xs bg-primary-600 hover:bg-primary-700 text-white rounded-md"
          @click="commitLabel"
        >
          {{ t.saveBtn }}
        </button>
        <button
          type="button"
          class="px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          @click="cancelEditLabel"
        >
          {{ t.cancelBtn }}
        </button>
      </template>
    </div>
    <button
      type="button"
      class="mt-3 w-full px-3 py-1.5 text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
      @click="handleDelete"
    >
      {{ t.deleteCategoryBtn }}
    </button>
  </section>

  <KeywordSection
    :title="t.keywordsLabel"
    :keywords="category.keywords"
    :placeholder="t.addKeywordPlaceholder"
    :empty-text="t.emptyCategoryKeywords"
    :t="t"
    :add="addKeyword"
    :remove="removeKeyword"
    tone="block"
  />
</template>
