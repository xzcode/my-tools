<script setup lang="ts">
import { computed, ref } from 'vue';

const props = withDefaults(defineProps<{ modelValue: string; label: string; placeholder?: string; readonly?: boolean; id?: string }>(), { placeholder: '', readonly: false });
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const scrollTop = ref(0);
const lineCount = computed(() => Math.min(10000, props.modelValue.split('\n').length));
const lineNumbers = computed(() => Array.from({ length: lineCount.value }, (_, i) => i + 1).join('\n'));
const field = ref<HTMLTextAreaElement>();

function insertTab(event: KeyboardEvent) {
  if (props.readonly || event.shiftKey) return;
  if (event.key === 'Tab') {
    // A keyboard modifier is required so ordinary Tab can always leave the editor.
    if (!event.altKey) return;
    event.preventDefault();
    const target = event.target as HTMLTextAreaElement;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    emit('update:modelValue', `${props.modelValue.slice(0, start)}  ${props.modelValue.slice(end)}`);
    requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2; });
  }
}

defineExpose({ focus: () => field.value?.focus() });
</script>

<template>
  <div class="code-editor" :class="{ 'is-readonly': readonly }">
    <div class="line-numbers" aria-hidden="true"><pre :style="{ transform: `translateY(-${scrollTop}px)` }">{{ lineNumbers }}</pre></div>
    <textarea
      :id="id" ref="field" :value="modelValue" :aria-label="label" :placeholder="placeholder"
      :readonly="readonly" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off"
      wrap="off" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @scroll="scrollTop = ($event.target as HTMLTextAreaElement).scrollTop" @keydown="insertTab"
    />
  </div>
</template>
