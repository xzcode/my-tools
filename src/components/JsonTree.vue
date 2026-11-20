<script setup lang="ts">
import { computed, ref } from 'vue';
import { isLosslessNumber } from 'lossless-json';
import { ChevronRight } from '@lucide/vue';

const props = withDefaults(defineProps<{ value: unknown; name?: string; depth?: number }>(), { depth: 0 });
const open = ref(props.depth === 0);
const isObject = computed(() => props.value !== null && typeof props.value === 'object' && !isLosslessNumber(props.value));
const array = computed(() => Array.isArray(props.value));
const entries = computed(() => isObject.value ? Object.entries(props.value as object) : []);
const primitive = computed(() => {
  if (isLosslessNumber(props.value)) return props.value.toString();
  if (typeof props.value === 'string') return JSON.stringify(props.value);
  return String(props.value);
});
const valueType = computed(() => isLosslessNumber(props.value) ? 'number' : typeof props.value);
</script>

<template>
  <div class="tree-node" :style="{ '--tree-depth': depth }">
    <button v-if="isObject" class="tree-branch" :aria-expanded="open" @click="open = !open">
      <ChevronRight :size="13" :class="{ expanded: open }" />
      <span v-if="name !== undefined" class="tree-key">{{ name }}</span>
      <span v-if="name !== undefined" class="tree-punctuation">:</span>
      <span class="tree-punctuation">{{ array ? '[' : '{' }}</span>
      <span class="tree-count">{{ entries.length }} {{ array ? '项' : '个属性' }}</span>
      <span class="tree-punctuation">{{ array ? ']' : '}' }}</span>
    </button>
    <div v-else class="tree-leaf">
      <span v-if="name !== undefined" class="tree-key">{{ name }}</span>
      <span v-if="name !== undefined" class="tree-punctuation">: </span>
      <span :class="`tree-value-${valueType}`">{{ primitive }}</span>
    </div>
    <div v-if="open && isObject && depth < 30" class="tree-children">
      <JsonTree v-for="[key, child] in entries.slice(0, 200)" :key="key" :value="child" :name="key" :depth="depth + 1" />
      <span v-if="entries.length > 200" class="tree-limit">仅展示前 200 项，请使用文本视图查看完整结果。</span>
    </div>
    <span v-if="open && isObject && depth >= 30" class="tree-limit">已达到树形视图显示深度，请使用文本视图。</span>
  </div>
</template>
