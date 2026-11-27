<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { useWorkspace } from '../composables/useWorkspace';

const props = defineProps<{ workspace: ReturnType<typeof useWorkspace>; exitBlocked?: boolean }>();
const emit = defineEmits<{ (e: 'exit-without-saving'): void; (e: 'restore-tool', id: string): void }>();
const { state, active, tabs, closed, toolId, jobs, batchJobs, binaryJobs, templates, saveStatus, saveError, blocked } = props.workspace;
const tabStrip = ref<HTMLElement>();
watch(() => active.value?.id, async () => {
  await nextTick();
  const strip = tabStrip.value;
  const selected = strip?.querySelector<HTMLElement>('.aes-tab.active');
  if (!strip || !selected) return;
  const view = strip.getBoundingClientRect(), rect = selected.getBoundingClientRect();
  if (rect.left < view.left) strip.scrollLeft += rect.left - view.left;
  else if (rect.right > view.right) strip.scrollLeft += rect.right - view.right;
}, { flush: 'post', immediate: true });
const settings = ref(false);
const menuId = ref('');
const renameDraft = ref('');
const renameInput = ref<HTMLInputElement>();
const dragged = ref('');
const confirmErase = ref(false);
const changing = ref(false);
const templateId = ref('');
const templateName = ref('');
const notice = ref('');
function quickReopen() {
  const target = props.workspace.reopen();
  if (target) emit('restore-tool', target);
}
const currentTemplate = computed(() => state.value.templates.find(t => t.id === templateId.value));
const statusLabel = computed(() => {
  if (blocked.value) return '存档不可读取';
  if (saveStatus.value === 'error') return '保存失败';
  if (saveStatus.value === 'saving') return '保存中…';
  if (saveStatus.value === 'pending') return '待保存';
  return saveStatus.value === 'saved' ? '已保存' : '自动保存';
});
watch(() => props.exitBlocked, value => { if (value) settings.value = true; }, { immediate: true });
function create() { if (!props.workspace.create()) notice.value = '无法创建标签，请重试。'; }
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
  if (!props.workspace.duplicate(menuId.value)) notice.value = '无法复制该标签。';
  menuId.value = '';
}
function closeMore(rightOnly: boolean) {
  props.workspace.closeOthers(menuId.value, rightOnly); menuId.value = '';
}
function drop(id: string) {
  if (dragged.value) props.workspace.reorder(dragged.value, id);
  dragged.value = '';
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
    notice.value = '已保存完整参数模板。';
    if (!update) templateId.value = state.value.templates.at(-1)?.id ?? '';
  } else notice.value = '请填写模板名称。';
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
      <div ref="tabStrip" class="aes-tabs" role="tablist" aria-label="工具标签页">
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
      <select v-if="tabs.length > 8" class="tab-jump" :value="active.id" aria-label="快速切换标签" :title="'当前 ' + tabs.length + ' 个标签'" @change="workspace.select(($event.target as HTMLSelectElement).value)">
        <option v-for="tab in tabs" :key="tab.id" :value="tab.id">{{ tab.name }}</option>
      </select>
      <button type="button" class="icon-button aes-add-tab" :title="tabs.length + ' 个标签 · Ctrl/Cmd+T 新建'" :aria-label="toolId === 'aes' ? '新建 AES 标签' : '新建标签'" :disabled="!workspace.canCreate()" @click="create">＋</button>
      <button type="button" class="small-action" title="恢复最近关闭 (Ctrl/Cmd+Shift+T)" :disabled="!closed.length || !workspace.canCreate()" @click="quickReopen">恢复关闭<span v-if="closed.length"> ({{ closed.length }})</span></button>
      <button type="button" class="icon-button" title="标签管理" aria-label="标签管理" @click="openMenu(active.id)">···</button>
      <button type="button" class="small-action aes-save-status" :class="{ 'error-text': saveStatus === 'error' }" :aria-expanded="settings" @click="settings = !settings">{{ statusLabel }} · 设置</button>
    </div>
    <div v-if="menuId" class="aes-tab-menu">
      <label>标签名称 <input ref="renameInput" v-model="renameDraft" maxlength="100" aria-label="标签名称" @keydown.enter.prevent="rename" @keydown.esc.prevent="menuId = ''" /></label>
      <button class="secondary-button" type="button" @click="rename">重命名</button>
      <button class="small-action" type="button" @click="copy">复制标签</button>
      <button class="small-action" type="button" @click="closeMore(false)">关闭其他标签</button>
      <button class="small-action" type="button" @click="closeMore(true)">关闭右侧标签</button>
      <button class="icon-button" type="button" aria-label="关闭标签管理" @click="menuId = ''">×</button>
    </div>
    <div v-if="settings" class="aes-session-panel">
      <div class="aes-session-heading">
        <strong>自动保存与会话恢复</strong>
        <button class="small-action" type="button" :disabled="changing || blocked" @click="workspace.flushLatest()">立即保存</button>
      </div>
      <p>全部工具参数、输入输出、文件、模板及历史记录自动完整保存到本机，不上传。重要数据请自行删除或清理。</p>
      <p v-if="saveError" class="error-text" role="status">{{ saveError }}<span v-if="blocked"> · 为保护原文件，自动覆盖已停止。请检查本地存档后重启，或主动清除存档。</span></p>
      <p>每次修改约 500ms 后自动保存。正常退出前尝试刷新；闪退、断电仍可能丢失最后未落盘的修改。不设固定存档容量或历史条数配额，历史由你自行清理。</p>
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
.tab-jump { flex-shrink: 0; width: 118px; max-width: 18%; min-height: 30px; font-size: 12px; border: 1px solid var(--border); background: var(--input); color: var(--text); border-radius: 5px; }
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
</style>
