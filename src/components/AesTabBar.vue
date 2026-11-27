<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { useAesWorkspace } from '../composables/useAesWorkspace';
import type { SaveMode, SecretField } from '../core/aes-workspace';
import { OPEN_LIMIT, TEMPLATE_LIMIT } from '../core/aes-workspace';
import { isDesktop } from '../platform/desktop';

const props = defineProps<{ workspace: ReturnType<typeof useAesWorkspace>; exitBlocked?: boolean }>();
const emit = defineEmits<{ (e: 'exit-without-saving'): void }>();
const { state, active, jobs, templates, saveStatus, saveError, blocked } = props.workspace;
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
const fieldLabels: [SecretField, string][] = [
  ['key', 'Key / 加密口令'], ['iv', 'IV / Nonce'], ['aad', 'AAD'],
  ['prefix', '密文前缀'], ['input', '输入内容'], ['output', '处理结果'],
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
function create() { if (!props.workspace.create()) notice.value = '最多打开 ' + OPEN_LIMIT + ' 个 AES Tab。'; }
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
  <div class="aes-tabs-shell" aria-label="AES 多标签工作台">
    <div class="aes-tab-toolbar">
      <div class="aes-tabs" role="tablist" aria-label="AES 标签页">
        <div v-for="tab in state.tabs" :key="tab.id" class="aes-tab"
          :class="{ active: active.id === tab.id }"
          draggable="true" @dragstart.stop="dragged = tab.id" @dragend.stop="dragged = ''"
          @dragover.stop.prevent @drop.stop.prevent="drop(tab.id)"
          @contextmenu.prevent.stop="openMenu(tab.id)" @dblclick.stop="openMenu(tab.id)">
          <button type="button" role="tab" :aria-selected="active.id === tab.id"
            :title="tab.name + ' · 双击重命名'" @click="workspace.select(tab.id)">
            <span v-if="jobs.includes(tab.id)" class="aes-running-dot" aria-label="正在处理"></span>
            <span>{{ tab.name }}</span>
          </button>
          <button type="button" class="aes-tab-close" :aria-label="'关闭标签 ' + tab.name"
            @click.stop="workspace.close(tab.id)">×</button>
        </div>
      </div>
      <button type="button" class="icon-button aes-add-tab" title="新建 AES 标签 (Ctrl/Cmd+T)" aria-label="新建 AES 标签" :disabled="state.tabs.length >= OPEN_LIMIT" @click="create">＋</button>
      <button type="button" class="small-action" title="恢复最近关闭 (Ctrl/Cmd+Shift+T)" :disabled="!state.closed.length || state.tabs.length >= OPEN_LIMIT" @click="workspace.reopen()">恢复关闭<span v-if="state.closed.length"> ({{ state.closed.length }})</span></button>
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
    <div v-if="settings" class="aes-session-panel">
      <div class="aes-session-heading">
        <strong>自动保存与会话恢复</strong>
        <button class="small-action" type="button" :disabled="changing || blocked" @click="workspace.flushLatest()">立即保存</button>
      </div>
      <label class="aes-session-mode">
        保存范围
        <select :value="state.mode" :disabled="changing || blocked" aria-label="AES 自动保存范围" @change="changeMode">
          <option value="config">仅保存标签与算法配置（默认）</option>
          <option value="full">完整会话 · 加密保存</option>
          <option value="off">关闭自动保存</option>
        </select>
      </label>
      <p v-if="state.mode === 'config'">自动保存标签、顺序及非敏感参数；Key、IV、AAD、前缀和输入输出只保留在当前运行会话。标签名不要填写秘密。</p>
      <p v-else-if="state.mode === 'off'">关闭后会移除原有工作台内容存档，标签仅在本次运行中保留。</p>
      <p v-else>{{ isDesktop() ? '完整会话经 AES-256-GCM 加密，密钥存放于操作系统凭据库。' : '浏览器预览使用 IndexedDB 内的不可导出 Web Crypto 密钥，不等同于桌面系统凭据库。' }} 不上传网络；已控制本机的程序仍可能访问。请勿在不可信设备上开启。</p>
      <div v-if="confirmFull" class="aes-consent">
        <strong>确认允许在本机保存所选敏感内容？</strong>
        <p>开启后，Key、前缀、输入输出及其他选中字段会进入加密存档。凭据库不可用时会拒绝保存，不会降级成明文。</p>
        <button type="button" class="primary-button" @click="enableFull">确认开启加密保存</button>
        <button type="button" class="small-action" @click="confirmFull = false">取消</button>
      </div>
      <div v-if="state.mode === 'full'" class="aes-fields">
        <label v-for="[field, label] in fieldLabels" :key="field"><input v-model="state.fields[field]" type="checkbox" :disabled="changing" /> {{ label }}</label>
      </div>
      <p v-if="saveError" class="error-text" role="status">{{ saveError }}<span v-if="blocked"> · 为保护原文件，自动覆盖已停止。可解锁凭据库后重启，或主动清除存档。</span></p>
      <p>每次修改约 500ms 后自动保存。正常退出前尝试刷新；闪退、断电仍可能丢失最后未落盘的修改。会话总大小上限 4 MiB。</p>
      <div class="aes-session-actions">
        <button type="button" class="small-action" :disabled="changing" @click="confirmErase = true">清除全部 AES 工作台</button>
        <template v-if="confirmErase">
          <span>同时清空已关闭的标签和模板？</span>
          <button class="secondary-button" type="button" @click="erase">确认清除</button>
          <button class="small-action" type="button" @click="confirmErase = false">取消</button>
        </template>
        <button v-if="exitBlocked" type="button" class="secondary-button" @click="emit('exit-without-saving')">退出且不保存本次变更</button>
      </div>
    </div>
    <div class="aes-template-bar">
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
</style>
