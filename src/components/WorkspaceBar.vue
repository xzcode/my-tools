<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { useWorkspace } from '../composables/useWorkspace';
import { getTool } from '../core/catalog';
import type { SaveMode, SecretField } from '../core/workspace';
import { OPEN_LIMIT, TOTAL_LIMIT, HISTORY_LIMIT, TEMPLATE_LIMIT } from '../core/workspace';
import { isDesktop } from '../platform/desktop';

const props = defineProps<{ workspace: ReturnType<typeof useWorkspace>; exitBlocked?: boolean }>();
const emit = defineEmits<{ (e: 'exit-without-saving'): void; (e: 'restore-tool', id: string): void }>();
const { state, active, tabs, closed, toolId, jobs, batchJobs, binaryJobs, templates, saveStatus, saveError, blocked } = props.workspace;
const settings = ref(false);
const menuId = ref('');
const renameDraft = ref('');
const renameInput = ref<HTMLInputElement>();
const dragged = ref('');
const confirmFull = ref(false);
const confirmErase = ref(false);
const changing = ref(false);
const templateId = ref('');
const templateName = ref('');
const notice = ref('');
const historyOpen = ref(false);
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
  if (target) { emit('restore-tool', target); historyOpen.value = false; notice.value = '已在新标签恢复记录。'; }
  else notice.value = '已达到标签数量上限，请先关闭其他标签。';
}
function quickReopen() {
  const target = props.workspace.reopen();
  if (target) emit('restore-tool', target);
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
const fieldLabels: [SecretField, string][] = [
  ['key', '保存 Key / 加密口令'], ['iv', '保存 IV / Nonce'], ['aad', '保存 AAD'],
  ['prefix', '保存密文前缀'], ['input', '保存输入与文件'], ['output', '保存处理结果'],
];
const currentTemplate = computed(() => state.value.templates.find(t => t.id === templateId.value));
const statusLabel = computed(() => {
  if (blocked.value) return '存档不可读取';
  if (saveStatus.value === 'error') return '保存失败';
  if (state.value.mode === 'off') return '自动保存已关闭';
  if (saveStatus.value === 'saving') return '保存中…';
  if (saveStatus.value === 'pending') return '待保存';
  return saveStatus.value === 'saved' ? '已保存' : '自动保存';
});
watch(() => props.exitBlocked, value => { if (value) settings.value = true; }, { immediate: true });
function create() { if (!props.workspace.create()) notice.value = '每个工具最多 ' + OPEN_LIMIT + ' 个标签，总计最多 ' + TOTAL_LIMIT + ' 个。'; }
async function openMenu(id: string) {
  menuId.value = id;
  renameDraft.value = state.value.tabs.find(t => t.id === id)?.name ?? '';
  await nextTick(); renameInput.value?.focus(); renameInput.value?.select();
}
function rename() {
  if (props.workspace.rename(menuId.value, renameDraft.value)) menuId.value = '';
  else notice.value = '请输入非空的标签名。';
}
function copy() {
  if (!props.workspace.duplicate(menuId.value)) notice.value = '已达到标签数量上限。';
  menuId.value = '';
}
function closeMore(rightOnly: boolean) {
  props.workspace.closeOthers(menuId.value, rightOnly); menuId.value = '';
}
function drop(id: string) {
  if (dragged.value) props.workspace.reorder(dragged.value, id);
  dragged.value = '';
}
async function changeMode(event: Event) {
  const select = event.target as HTMLSelectElement;
  const mode = select.value as SaveMode;
  select.value = state.value.mode;
  if (mode === 'full' && state.value.mode !== 'full') { confirmFull.value = true; return; }
  changing.value = true;
  try { await props.workspace.setMode(mode); } finally { changing.value = false; }
}
async function enableFull() {
  confirmFull.value = false;
  changing.value = true;
  try { await props.workspace.setMode('full'); } finally { changing.value = false; }
}
async function erase() {
  confirmErase.value = false; changing.value = true;
  try {
    if (await props.workspace.erase()) { notice.value = '已清除工作台、关闭历史、模板及本地存档。'; templateId.value = ''; }
  } finally { changing.value = false; }
}
function applyTemplate(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  templateId.value = id;
  if (id) props.workspace.applyTemplate(id);
  templateName.value = currentTemplate.value?.name ?? '';
}
function saveTemplate(update: boolean) {
  if (props.workspace.saveTemplate(templateName.value, update ? currentTemplate.value?.id : undefined)) {
    notice.value = '已保存非敏感参数模板。';
    if (!update) templateId.value = state.value.templates.at(-1)?.id ?? '';
  } else notice.value = '请填写模板名称；最多 ' + TEMPLATE_LIMIT + ' 个自定义模板。';
}
function deleteTemplate() {
  if (!currentTemplate.value) return;
  props.workspace.removeTemplate(currentTemplate.value.id);
  templateId.value = ''; templateName.value = '';
}
</script>

<template>
  <div class="aes-tabs-shell" aria-label="多标签工作台">
    <div class="aes-tab-toolbar">
      <div class="aes-tabs" role="tablist" aria-label="工具标签页">
        <div v-for="tab in tabs" :key="tab.id" class="aes-tab"
          :class="{ active: active.id === tab.id }"
          draggable="true" @dragstart.stop="dragged = tab.id" @dragend.stop="dragged = ''"
          @dragover.stop.prevent @drop.stop.prevent="drop(tab.id)"
          @contextmenu.prevent.stop="openMenu(tab.id)" @dblclick.stop="openMenu(tab.id)">
          <button type="button" role="tab" :aria-selected="active.id === tab.id"
            :title="tab.name + ' · 双击重命名'" @click="workspace.select(tab.id)">
            <span v-if="jobs.includes(tab.id) || batchJobs.includes(tab.id) || binaryJobs.includes(tab.id)" class="aes-running-dot" aria-label="正在处理"></span>
            <span>{{ tab.name }}</span>
          </button>
          <button type="button" class="aes-tab-close" :aria-label="'关闭标签 ' + tab.name"
            @click.stop="workspace.close(tab.id)">×</button>
        </div>
      </div>
      <button type="button" class="icon-button aes-add-tab" title="新建标签 (Ctrl/Cmd+T)" :aria-label="toolId === 'aes' ? '新建 AES 标签' : '新建标签'" :disabled="!workspace.canCreate()" @click="create">＋</button>
      <button type="button" class="small-action" title="恢复最近关闭 (Ctrl/Cmd+Shift+T)" :disabled="!closed.length || !workspace.canCreate()" @click="quickReopen">恢复关闭<span v-if="closed.length"> ({{ closed.length }})</span></button>
      <button type="button" class="small-action" :aria-expanded="historyOpen" @click="historyOpen = !historyOpen">历史记录</button>
      <button type="button" class="icon-button" title="标签管理" aria-label="标签管理" @click="openMenu(active.id)">···</button>
      <button type="button" class="small-action aes-save-status" :class="{ 'error-text': saveStatus === 'error' }" :aria-expanded="settings" @click="settings = !settings">{{ statusLabel }} · 设置</button>
    </div>
    <div v-if="menuId" class="aes-tab-menu">
      <label>标签名称 <input ref="renameInput" v-model="renameDraft" maxlength="100" aria-label="标签名称" @keydown.enter.prevent="rename" @keydown.esc.prevent="menuId = ''" /></label>
      <button class="secondary-button" type="button" @click="rename">重命名</button>
      <button class="small-action" type="button" @click="copy">复制配置（不含密钥）</button>
      <button class="small-action" type="button" @click="closeMore(false)">关闭其他标签</button>
      <button class="small-action" type="button" @click="closeMore(true)">关闭右侧标签</button>
      <button class="icon-button" type="button" aria-label="关闭标签管理" @click="menuId = ''">×</button>
    </div>
    <div v-if="historyOpen" class="history-panel" aria-label="历史记录面板">
      <div class="history-heading"><strong>历史记录</strong><span>最多 {{ HISTORY_LIMIT }} 条 · {{ historyRows.length }} 条符合筛选</span></div>
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
      <p>恢复会创建新标签，不会覆盖当前内容。清理按上方工具范围执行，不受搜索及记录类型筛选影响；不会清除正在打开的标签。</p>
    </div>
    <div v-if="settings" class="aes-session-panel">
      <div class="aes-session-heading">
        <strong>自动保存与会话恢复</strong>
        <button class="small-action" type="button" :disabled="changing || blocked" @click="workspace.flushLatest()">立即保存</button>
      </div>
      <label class="aes-session-mode">
        保存范围
        <select :value="state.mode" :disabled="changing || blocked" :aria-label="toolId === 'aes' ? 'AES 自动保存范围' : '工作台自动保存范围'" @change="changeMode">
          <option value="config">仅保存标签与算法配置（默认）</option>
          <option value="full">完整会话 · 加密保存</option>
          <option value="off">关闭自动保存</option>
        </select>
      </label>
      <p v-if="state.mode === 'config'">自动保存所有工具的标签、关闭及运行记录的时间与非敏感配置；输入、输出、文件和密钥仅保留在当前运行会话。开启完整会话加密保存后，重启也可恢复选中的内容。标签名不要填写秘密。</p>
      <p v-else-if="state.mode === 'off'">关闭后会移除原有工作台内容存档，标签仅在本次运行中保留。</p>
      <p v-else>{{ isDesktop() ? '完整会话经 AES-256-GCM 加密，密钥存放于操作系统凭据库。' : '浏览器预览使用 IndexedDB 内的不可导出 Web Crypto 密钥，不等同于桌面系统凭据库。' }} 不上传网络；已控制本机的程序仍可能访问。请勿在不可信设备上开启。</p>
      <div v-if="confirmFull" class="aes-consent">
        <strong>确认允许在本机保存所选敏感内容？</strong>
        <p>开启后，所有工具的历史及当前标签中选中的输入输出、文件、Key、前缀等字段会进入加密存档。凭据库不可用时会拒绝保存，不会降级成明文。</p>
        <button type="button" class="primary-button" @click="enableFull">确认开启加密保存</button>
        <button type="button" class="small-action" @click="confirmFull = false">取消</button>
      </div>
      <div v-if="state.mode === 'full'" class="aes-fields">
        <label v-for="[field, label] in fieldLabels" :key="field"><input v-model="state.fields[field]" type="checkbox" :disabled="changing" /> {{ label }}</label>
      </div>
      <p v-if="saveError" class="error-text" role="status">{{ saveError }}<span v-if="blocked"> · 为保护原文件，自动覆盖已停止。可解锁凭据库后重启，或主动清除存档。</span></p>
      <p>每次修改约 500ms 后自动保存。正常退出前尝试刷新；闪退、断电仍可能丢失最后未落盘的修改。会话总大小上限 32 MiB。</p>
      <div class="aes-session-actions">
        <button type="button" class="small-action" :disabled="changing" @click="confirmErase = true">清除全部工作台</button>
        <template v-if="confirmErase">
          <span>同时清空所有工具的当前标签、历史和模板？</span>
          <button class="secondary-button" type="button" @click="erase">确认清除</button>
          <button class="small-action" type="button" @click="confirmErase = false">取消</button>
        </template>
        <button v-if="exitBlocked" type="button" class="secondary-button" @click="emit('exit-without-saving')">退出且不保存本次变更</button>
      </div>
    </div>
    <div v-if="toolId === 'aes'" class="aes-template-bar">
      <label>参数模板
        <select :value="templateId" aria-label="AES 参数模板" @change="applyTemplate">
          <option value="">选择常用配置…</option>
          <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option>
        </select>
      </label>
      <input v-model="templateName" aria-label="自定义模板名称" maxlength="100" placeholder="自定义模板名称" />
      <button class="small-action" type="button" @click="saveTemplate(false)">保存新模板</button>
      <button class="small-action" type="button" :disabled="!currentTemplate" @click="saveTemplate(true)">更新</button>
      <button class="small-action" type="button" :disabled="!currentTemplate" @click="deleteTemplate">删除</button>
    </div>
    <div v-if="notice" class="aes-tab-notice" role="status">{{ notice }} <button class="icon-button" type="button" aria-label="关闭标签提示" @click="notice = ''">×</button></div>
  </div>
</template>

<style scoped>
.aes-tabs-shell { border-bottom: 1px solid var(--border); background: var(--surface); min-width: 0; }
.aes-tab-toolbar { display: flex; align-items: center; gap: 5px; padding: 6px 12px 0; min-width: 0; }
.aes-tabs { display: flex; gap: 4px; overflow-x: auto; flex: 1; align-items: stretch; min-width: 0; }
.aes-tab { display: flex; align-items: center; flex-shrink: 0; border: 1px solid transparent; border-bottom: 0; border-radius: 6px 6px 0 0; color: var(--secondary); max-width: 220px; }
.aes-tab.active { color: var(--accent); border-color: var(--border); background: var(--accent-soft); }
.aes-tab > button[role=tab] { min-height: 32px; padding: 7px 10px; font-size: 12px; min-width: 0; }
.aes-tab > button[role=tab] > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aes-tab-close { padding: 4px 9px; color: var(--muted); font-size: 17px; }
.aes-tab-close:hover { color: var(--danger); }
.aes-add-tab { font-size: 19px; flex-shrink: 0; }
.aes-tab-toolbar > .small-action { white-space: nowrap; flex-shrink: 0; }
.aes-save-status { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.aes-running-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.aes-tab-menu, .aes-template-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 9px 14px; border-top: 1px solid var(--border); }
.aes-template-bar label, .aes-tab-menu label, .aes-session-mode { display: flex; align-items: center; gap: 7px; color: var(--secondary); }
.aes-template-bar input, .aes-template-bar select, .aes-tab-menu input, .aes-session-mode select { min-height: 30px; border: 1px solid var(--border); background: var(--input); border-radius: 5px; padding: 4px 8px; max-width: 250px; }
.aes-template-bar input { width: 160px; }
.aes-session-panel { border-top: 1px solid var(--border); padding: 13px 16px; display: flex; flex-direction: column; gap: 10px; background: var(--subtle); }
.aes-session-heading, .aes-session-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.aes-session-heading strong { margin-right: auto; }
.aes-session-panel p { margin: 0; font-size: 12px; color: var(--secondary); line-height: 1.6; }
.aes-session-panel .error-text { color: var(--danger); }
.aes-fields { display: flex; flex-wrap: wrap; gap: 10px 16px; }
.aes-fields label { display: flex; gap: 4px; align-items: center; font-size: 12px; }
.aes-consent { border: 1px solid var(--border); border-radius: 6px; padding: 10px; background: var(--surface); }
.aes-consent p { margin: 5px 0 10px; }
.aes-consent button { margin-right: 12px; }
.aes-tab-notice { display: flex; justify-content: space-between; align-items: center; padding: 5px 14px; font-size: 11px; color: var(--secondary); }
.history-panel { padding: 12px 16px; border-top: 1px solid var(--border); background: var(--subtle); }
.history-heading { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
.history-heading span, .history-panel p, .history-entry span { color:var(--secondary);font-size:12px; }
.history-filters, .history-cleanup { display:flex;align-items:center;gap:8px;flex-wrap:wrap; }
.history-filters input, .history-filters select, .history-cleanup input, .history-cleanup select { min-height:30px;border:1px solid var(--border);border-radius:5px;background:var(--input);padding:4px 8px;color:var(--text); }
.history-filters input { flex:1;min-width:120px; }
.history-list { max-height:270px;overflow-y:auto;margin:10px 0;border:1px solid var(--border);border-radius:6px;background:var(--surface); }
.history-row { display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border); }
.history-row:last-child { border-bottom:0; }
.history-entry { min-width:0;flex:1;display:flex;flex-direction:column;gap:4px; }
.history-entry strong { overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px; }
.history-empty { padding:20px;text-align:center;color:var(--muted); }
.history-cleanup label { display:flex;align-items:center;gap:7px; }
.history-panel p { margin:8px 0 0;line-height:1.5; }
</style>
