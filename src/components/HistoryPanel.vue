<script setup lang="ts">
import { computed, ref } from 'vue';
import { PanelRightClose } from '@lucide/vue';
import { getTool } from '../core/catalog';
import type { useWorkspace } from '../composables/useWorkspace';
const props = defineProps<{ workspace: ReturnType<typeof useWorkspace> }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'restore-tool', id: string): void }>();
const { state, toolId } = props.workspace;
const notice = ref('');
const scope = ref<'current'|'all'>('current');
const historyType = ref<'all'|'closed'|'run'>('all');
const historySearch = ref('');
const retention = ref('30');
const customDate = ref('');
const confirmCleanup = ref(false);
const historyRows = computed(() => {
  const query = historySearch.value.trim().toLowerCase();
  return state.value.history.filter(h => (scope.value === 'all' || h.tab.toolId === toolId.value)
    && (historyType.value === 'all' || h.type === historyType.value)
    && (!query || (h.tab.name + ' ' + (getTool(h.tab.toolId)?.name || '')).toLowerCase().includes(query)));
});
const cleanupCutoff = computed(() => retention.value === 'all' ? undefined : retention.value === 'custom' ? (customDate.value ? new Date(customDate.value + 'T00:00:00').getTime() : NaN) : Date.now() - Number(retention.value) * 86400000);
const cleanupCount = computed(() => state.value.history.filter(h => (scope.value === 'all' || h.tab.toolId === toolId.value) && (cleanupCutoff.value === undefined || h.at < cleanupCutoff.value)).length);
function restore(id: string) {
  const target = props.workspace.restoreHistory(id);
  if (target) { emit('restore-tool', target); notice.value = '已在新标签恢复记录。'; }
  else notice.value = '该历史记录已不存在或无法恢复。';
}
async function removeHistory(id: string) {
  props.workspace.removeHistory(id);
  notice.value = await props.workspace.flushLatest() ? '历史记录已删除。' : '已从当前会话删除；本地保存失败，请重试。';
}
async function cleanupHistory() {
  if (Number.isNaN(cleanupCutoff.value)) return;
  const count = props.workspace.clearHistory(cleanupCutoff.value, scope.value === 'current' ? toolId.value : undefined);
  confirmCleanup.value = false;
  notice.value = await props.workspace.flushLatest() ? '已清理 ' + count + ' 条历史记录。' : '已清理当前会话；本地保存失败，请重试。';
}
function timeLabel(at: number) { return new Date(at).toLocaleString('zh-CN', { hour12: false }); }
</script>

<template>
    <aside class="history-panel" aria-label="历史记录面板">
      <div class="history-heading"><div><strong>历史记录</strong><span>{{ historyRows.length }} / {{ state.history.length }} 条</span></div><button class="icon-button" type="button" aria-label="收起历史记录" @click="emit('close')"><PanelRightClose :size="17" /></button></div>
      <div class="history-filters">
        <select v-model="scope" aria-label="历史范围" @change="confirmCleanup = false"><option value="current">当前工具</option><option value="all">全部工具</option></select>
        <select v-model="historyType" aria-label="历史类型"><option value="all">全部记录</option><option value="closed">关闭的标签</option><option value="run">运行记录</option></select>
        <input v-model="historySearch" placeholder="搜索工具或标签" aria-label="搜索历史记录" />
      </div>
      <div class="history-list">
        <div v-if="!historyRows.length" class="history-empty">暂无符合条件的记录。</div>
        <div v-for="h in historyRows" :key="h.id" class="history-row">
          <div class="history-entry"><strong>{{ h.tab.name }}</strong><span>{{ getTool(h.tab.toolId)?.name }} · {{ h.type === 'closed' ? '关闭标签' : '运行' }} · {{ timeLabel(h.at) }}</span></div>
          <button type="button" class="secondary-button" :aria-label="'恢复历史 ' + h.tab.name" @click="restore(h.id)">恢复</button>
          <button type="button" class="small-action" :aria-label="'删除历史 ' + h.tab.name" @click="removeHistory(h.id)">删除</button>
        </div>
      </div>
      <div class="history-cleanup">
        <label>清理范围
          <select v-model="retention" aria-label="历史清理时间" @change="confirmCleanup = false"><option value="7">超过 7 天</option><option value="30">超过 30 天</option><option value="90">超过 90 天</option><option value="custom">指定日期之前</option><option value="all">全部历史</option></select>
        </label>
        <input v-if="retention === 'custom'" v-model="customDate" type="date" aria-label="清理截止日期" @change="confirmCleanup = false" />
        <button type="button" class="small-action" :disabled="!cleanupCount" @click="confirmCleanup = true">清理 {{ cleanupCount }} 条</button>
        <template v-if="confirmCleanup"><span>确定删除 {{ cleanupCount }} 条记录？</span><button type="button" class="secondary-button" @click="cleanupHistory">确认清理</button><button class="small-action" @click="confirmCleanup = false">取消</button></template>
      </div>
      <p class="history-note">恢复到新标签；仅手动删除历史，不影响已打开的标签。</p>
      <p v-if="notice" class="history-note" role="status">{{ notice }}</p>
    </aside>
</template>
<style scoped>
.history-panel { position: sticky; top: 0; height: 100vh; height: 100dvh; min-width: 0; display: flex; flex-direction: column; background: var(--sidebar); border-left: 1px solid var(--border); overflow: hidden; }
.history-heading { min-height: 54px; padding: 10px 13px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--border); background: var(--surface); }
.history-heading > div { display: flex; flex-direction: column; gap: 4px; }
.history-heading strong { font-size: 13px; font-weight: 650; }
.history-heading span, .history-entry span, .history-note { color: var(--secondary); font-size: 11px; }
.history-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; padding: 12px; border-bottom: 1px solid var(--border); }
.history-filters input { grid-column: 1 / -1; }
.history-filters input, .history-filters select, .history-cleanup input, .history-cleanup select { min-width: 0; min-height: 31px; border: 1px solid var(--border); border-radius: 5px; background: var(--input); padding: 5px 7px; font-size: 11px; }
.history-list { flex: 1; min-height: 0; overflow-y: auto; padding: 7px 10px; }
.history-row { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 10px; margin-bottom: 5px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.history-row:hover { border-color: var(--accent); }
.history-entry { grid-column: 1 / -1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.history-entry strong { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-entry span { overflow-wrap: anywhere; line-height: 1.45; }
.history-row .secondary-button { justify-self: start; min-height: 27px; padding: 4px 9px; }
.history-row .small-action { justify-self: end; }
.history-empty { padding: 26px 10px; text-align: center; color: var(--muted); font-size: 12px; }
.history-cleanup { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 11px 12px 4px; border-top: 1px solid var(--border); }
.history-cleanup label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--secondary); }
.history-note { margin: 7px 12px 11px; line-height: 1.5; }
</style>
