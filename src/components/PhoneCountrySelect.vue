<script setup lang="ts">
import { computed, ref, nextTick, onBeforeUnmount, onMounted } from 'vue';
import { phoneCountries } from '../core/phone';
import 'flag-icons/css/flag-icons.min.css';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', code: string): void }>();
const root = ref<HTMLElement>();
const searchInput = ref<HTMLInputElement>();
const open = ref(false);
const query = ref('');
const selected = computed(() => phoneCountries.find(c => c.code === props.modelValue) ?? phoneCountries[0]!);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return !q ? phoneCountries : phoneCountries.filter(c => (c.name + ' ' + c.english + ' ' + c.code + ' ' + c.dial).toLowerCase().includes(q));
});
function flag(code: string) { return 'fi fi-' + (code === 'AC' ? 'sh-ac' : code === 'TA' ? 'sh-ta' : code.toLowerCase()); }
function toggle() {
  open.value = !open.value;
  if (open.value) { query.value = ''; void nextTick(() => searchInput.value?.focus()); }
}
function choose(code: string) { emit('update:modelValue', code); open.value = false; }
function outside(event: MouseEvent) { if (!root.value?.contains(event.target as Node)) open.value = false; }
onMounted(() => document.addEventListener('mousedown', outside));
onBeforeUnmount(() => document.removeEventListener('mousedown', outside));
</script>
<template>
  <div ref="root" class="phone-country" @keydown.esc.stop="open = false">
    <button type="button" class="country-trigger" aria-label="国家 / 地区与区号" :aria-expanded="open" @click="toggle">
      <span :class="flag(selected.code)" aria-hidden="true"></span>
      <strong>{{ selected.dial }}</strong><span class="country-title">{{ selected.name }}</span><span class="country-arrow">⌄</span>
    </button>
    <div v-if="open" class="country-popup">
      <input ref="searchInput" v-model="query" placeholder="国家、英文名称、ISO 代码或 +区号" aria-label="搜索国家或区号" @keydown.enter.prevent="filtered.length && choose(filtered[0]!.code)" />
      <div class="country-scroll" role="listbox" aria-label="国际区号">
        <button v-for="country in filtered" :key="country.code" type="button" role="option"
          :aria-selected="country.code === modelValue" @click="choose(country.code)">
          <span :class="flag(country.code)" aria-hidden="true"></span><span>{{ country.name }} <small>{{ country.code }}</small></span><strong>{{ country.dial }}</strong>
        </button>
        <p v-if="!filtered.length">没有匹配的国家或地区</p>
      </div>
      <small class="country-count">共 {{ phoneCountries.length }} 个国家和地区</small>
    </div>
  </div>
</template>
<style scoped>
.phone-country { position: relative; min-width: 240px; width: 100%; }
.country-trigger { display: flex; gap: 8px; align-items: center; min-height: 34px; width: 100%; border: 1px solid var(--border); background: var(--input); border-radius: 6px; padding: 6px 10px; text-align: left; color: var(--text); }
.fi { flex-shrink: 0; font-size: 16px; border-radius: 2px; }
.country-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.country-arrow { color: var(--muted); }
.country-popup { position: absolute; top: calc(100% + 5px); left: 0; z-index: 35; width: min(355px, 70vw); padding: 9px; border: 1px solid var(--border); box-shadow: 0 8px 22px #0002; border-radius: 8px; background: var(--surface); }
.country-popup input { width: 100%; box-sizing: border-box; padding: 7px 9px; }
.country-scroll { max-height: 310px; overflow-y: auto; margin-top: 8px; }
.country-scroll button { width: 100%; display: flex; align-items: center; gap: 9px; text-align: left; padding: 8px 7px; border-radius: 4px; }
.country-scroll button:hover, .country-scroll button[aria-selected=true] { background: var(--accent-soft); }
.country-scroll button > span:nth-child(2) { flex: 1; }
.country-scroll small, .country-count { color: var(--muted); }
.country-count { display: block; padding: 5px 7px 0; }
</style>
