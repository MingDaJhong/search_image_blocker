<script setup lang="ts">
import { ref } from "vue";
import type { Category, AddKeywordResult } from "@/composables/useBlockList";
import type { Messages } from "./i18n";

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
const newKeyword = ref("");
const keywordError = ref<AddKeywordResult | null>(null);
let errorTimer = 0;

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

function handleAddKeyword() {
  const result = props.addCatKeyword(props.category.id, newKeyword.value);
  if (result === "added") {
    newKeyword.value = "";
    keywordError.value = null;
  } else {
    clearTimeout(errorTimer);
    keywordError.value = result;
    errorTimer = window.setTimeout(() => {
      keywordError.value = null;
    }, 2500);
  }
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

  <section>
    <h2
      class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2"
    >
      {{ t.keywordsLabel }}
    </h2>

    <form
      :class="['flex gap-2', keywordError ? 'mb-0' : 'mb-2']"
      @submit.prevent="handleAddKeyword"
    >
      <input
        v-model="newKeyword"
        type="text"
        :placeholder="t.addKeywordPlaceholder"
        :class="[
          'flex-1 px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:border-transparent dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500',
          keywordError
            ? 'border-red-400 dark:border-red-600 focus:ring-red-400'
            : 'border-gray-300 dark:border-gray-700 focus:ring-primary-500',
        ]"
        @input="keywordError = null"
      />
      <button
        type="submit"
        class="px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-md transition-colors"
      >
        {{ t.addBtn }}
      </button>
    </form>
    <p
      v-if="keywordError"
      class="mt-1 mb-2 text-xs text-red-500 dark:text-red-400"
    >
      {{ keywordError === "duplicate" ? t.errorDuplicate : t.errorEmpty }}
    </p>

    <div
      v-if="category.keywords.length === 0"
      class="text-xs text-gray-400 dark:text-gray-500 text-center py-3"
    >
      {{ t.emptyCategoryKeywords }}
    </div>
    <ul v-else class="flex flex-wrap gap-1.5">
      <li
        v-for="kw in category.keywords"
        :key="kw"
        class="inline-flex items-center gap-1 px-2 py-1 bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs rounded-md max-w-[10rem] overflow-hidden"
      >
        <span class="truncate" :title="kw">{{ kw }}</span>
        <button
          class="hover:text-primary-900 dark:hover:text-primary-100 font-bold leading-none"
          :aria-label="t.removeAria(kw)"
          @click="props.removeCatKeyword(props.category.id, kw)"
        >
          ×
        </button>
      </li>
    </ul>
  </section>
</template>
