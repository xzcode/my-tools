<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { parse } from 'lossless-json';
import { Search, Star, Settings2, ChevronRight, ArrowUpRight, Copy, ClipboardPaste, FolderOpen, Download, ArrowLeftRight, Trash2, Play, Square, Check, X, Monitor, Moon, Sun, ShieldCheck, CornerDownLeft, SlidersHorizontal, Braces, Files, CircleAlert, LoaderCircle, PanelLeftClose, PanelLeftOpen, Keyboard, CheckCircle2, RotateCcw, ArrowRight, PackageCheck } from '@lucide/vue';
import { categories, tools, getTool, defaultOptions } from './core/catalog';
import type { ToolResult, ToolDefinition } from './core/types';
import { useWorkspace } from './composables/useWorkspace';
import WorkspaceBar from './components/WorkspaceBar.vue';
import PhoneCountrySelect from './components/PhoneCountrySelect.vue';
import SvgaPreview from './components/SvgaPreview.vue';
import { registerAesExit, exitWithoutSavingAesWorkspace } from './platform/aes-workspace';
import type { ToolTab } from './core/workspace';
import { encodeBase64Bytes } from './core/encoding';
import CodeEditor from './components/CodeEditor.vue';
import JsonTree from './components/JsonTree.vue';
import ToolIcon from './components/ToolIcon.vue';
import { isDesktop, defaultPreferences, loadPreferences, savePreferences, openTextFiles, saveTextFile, saveBatchFiles, readClipboard, writeClipboard, showMainWindow, hideCurrentWindow, onOpenTool, onRawFileDrop, readDroppedFiles, readDroppedBinaryFile, onPreferencesChanged, onLauncherShown, openBinaryFile, saveBinaryFile, readBrowserFiles, getDesktopStatus, checkForUpdates, installUpdate } from './platform/desktop';
import type { DesktopPreferences, ImportedFile, BinaryFile } from './platform/desktop';

const launcher = new URLSearchParams(location.search).get('window') === 'launcher';
const desktop = isDesktop();
const mac = /Mac/.test(navigator.platform);
const modifier = mac ? '⌘' : 'Ctrl';
const preferences = ref<DesktopPreferences>({ ...defaultPreferences, favorites: [...defaultPreferences.favorites], recent: [...defaultPreferences.recent] });
const ready = ref(false);
const workspace = useWorkspace();
const currentId = workspace.toolId;
const activeTab = workspace.active;
const currentTool = computed(() => getTool(currentId.value) || tools[0]!);
const exitBlocked = ref(false);
function activeField<K extends keyof ToolTab>(key: K) {
  return computed({
    get: () => activeTab.value[key],
    set: (value: ToolTab[K]) => { const target: ToolTab = activeTab.value; target[key] = value; },
  });
}
const input = activeField('input');
const secondaryInput = activeField('secondaryInput');
const action = activeField('action');
const options = activeField('options');
const result = activeField('result');
const error = activeField('error');
const stale = activeField('stale');
const elapsed = activeField('elapsed');
const outputView = activeField('outputView');
const binarySourceName = activeField('binarySourceName');
const batch = activeField('batch');
const batchVisible = activeField('batchVisible');
const showOptions = ref(true);
const sidebarCollapsed = ref(false);
const paletteOpen = ref(false);
const paletteQuery = ref('');
const paletteIndex = ref(0);
const paletteSearch = ref<HTMLInputElement>();
const settingsOpen = ref(false);
const shortcutDraft = ref(defaultPreferences.shortcut);
const closeToTrayDraft = ref(defaultPreferences.closeToTray);
const settingsSaving = ref(false);
const status = ref<Awaited<ReturnType<typeof getDesktopStatus>> | null>(null);
const updateState = ref<Awaited<ReturnType<typeof checkForUpdates>> | null>(null);
const updating = ref(false);
const toast = ref<{ text: string; error: boolean } | null>(null);
const dragOver = ref(false);
const running = workspace.running;
const batchRunning = workspace.batchRunning;
const binaryBusy = workspace.binaryBusy;
function cancel() { workspace.stop(); }
let initialized = false;
let returnFocus: HTMLElement | null = null;
let preferenceSequence = 0;
let preferenceQueue = Promise.resolve();
let toastTimer: ReturnType<typeof setTimeout>;
const cleanup: (() => void)[] = [];
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
const systemDark = ref(mediaQuery.matches);
const activeTheme = computed(() => preferences.value.theme === 'system' ? (systemDark.value ? 'dark' : 'light') : preferences.value.theme);
const favorites = computed(() => preferences.value.favorites.map(getTool).filter((tool): tool is ToolDefinition => !!tool));
const recent = computed(() => preferences.value.recent.map(getTool).filter((tool): tool is ToolDefinition => !!tool));
const selectedAction = computed(() => currentTool.value.actions.find(item => item.id === action.value));
const visibleOptions = computed(() => {
  if (currentId.value !== 'aes') return currentTool.value.options;
  const advanced = options.value.profile === 'advanced';
  return currentTool.value.options.filter(option => {
    if (option.key === 'profile' || option.key === 'prefix') return true;
    if (!advanced) return option.key === 'password';
    if (option.key === 'password') return false;
    const mode = options.value.cipherMode;
    if (mode === 'ECB' && ['iv', 'ivEncoding'].includes(option.key)) return false;
    if (option.key === 'padding') return mode === 'CBC' || mode === 'ECB';
    if (['tagLength', 'tagFormat', 'aad', 'aadEncoding'].includes(option.key)) return mode === 'GCM';
    return true;
  });
});
const categoryName = computed(() => categories.find(item => item.id === currentTool.value.category)?.name || '工具');
const paletteTools = computed(() => {
  const query = paletteQuery.value.trim().toLowerCase();
  if (!query) return [...recent.value, ...tools.filter(tool => !recent.value.some(item => item.id === tool.id))];
  return tools.filter(tool => `${tool.name} ${tool.description} ${tool.keywords.join(' ')}`.toLowerCase().includes(query));
});
const canTree = computed(() => !!result.value && result.value.output.length <= 500_000 && (result.value.kind === 'json' || ['json', 'json-diff', 'jwt', 'curl'].includes(currentId.value)));
const treeValue = computed(() => {
  if (outputView.value !== 'tree' || !canTree.value) return undefined;
  try { return parse(result.value!.output); } catch { return undefined; }
});
const inputBytes = computed(() => new TextEncoder().encode(input.value).byteLength);
const outputBytes = computed(() => new TextEncoder().encode(result.value?.output || '').byteLength);
const batchDone = computed(() => batch.value.filter(item => item.state === 'done').length);
const batchErrors = computed(() => batch.value.filter(item => item.state === 'error').length);
const isFavorite = computed(() => preferences.value.favorites.includes(currentId.value));

watch(activeTheme, value => { document.documentElement.dataset.theme = value; }, { immediate: true });
watch(paletteQuery, () => { paletteIndex.value = 0; });
watch([paletteOpen, settingsOpen], ([palette, settings]) => { if (!palette && !settings) nextTick(() => returnFocus?.focus()); });
function notify(text: string, isError = false) {
  clearTimeout(toastTimer);
  toast.value = { text, error: isError };
  toastTimer = setTimeout(() => { toast.value = null; }, 4500);
}

function persist(patch: Partial<DesktopPreferences>) {
  const previous = { ...preferences.value };
  const next = { ...preferences.value, ...patch };
  const sequence = ++preferenceSequence;
  preferences.value = next;
  preferenceQueue = preferenceQueue.then(async () => {
    try {
      const saved = await savePreferences(next);
      if (sequence === preferenceSequence) preferences.value = saved;
    } catch (reason) {
      if (sequence === preferenceSequence) preferences.value = previous;
      notify(reason instanceof Error ? reason.message : '偏好设置保存失败。', true);
    }
  });
  return preferenceQueue;
}

function toggleFavorite(id = currentId.value) {
  const ids = preferences.value.favorites.includes(id)
    ? preferences.value.favorites.filter(item => item !== id)
    : [...preferences.value.favorites, id];
  void persist({ favorites: ids });
}

function rememberTool(id: string) {
  void persist({ lastTool: id, recent: [id, ...preferences.value.recent.filter(item => item !== id)].slice(0, 8) });
}

function applyTool(id: string, remember = true) {
  const tool = getTool(id);
  if (!tool) return;
  workspace.selectTool(id);
  paletteOpen.value = false;
  initialized = true;
  if (remember) rememberTool(tool.id);
  document.title = tool.name + ' — My Tools';
}
function restoredTool(id: string) {
  applyTool(id);
  if (location.hash !== '#/tools/' + id) location.hash = '/tools/' + id;
}

async function navigate(id: string) {
  if (!getTool(id)) return;
  if (launcher) {
    if (desktop) await guarded(() => showMainWindow(id));
    else location.assign(`${location.pathname}#/tools/${encodeURIComponent(id)}`);
    return;
  }
  paletteOpen.value = false;
  if (currentId.value === id && initialized) return;
  location.hash = `/tools/${id}`;
}

function dismissLauncher() {
  if (desktop) void guarded(hideCurrentWindow);
  else location.assign(`${location.pathname}#/tools/${encodeURIComponent(preferences.value.lastTool)}`);
}

function routeChanged() {
  const id = location.hash.replace(/^#\/?(?:tools\/)?/, '');
  applyTool(getTool(id)?.id || preferences.value.lastTool || 'json');
}

function useJavaEcbPreset() {
  options.value = {
    ...options.value, profile: 'advanced', cipherMode: 'ECB',
    keySize: '256', keyEncoding: 'utf8', iv: '',
    dataEncoding: 'utf8', cipherEncoding: 'base64', padding: 'pkcs7',
  };
  showOptions.value = true;
  notify('已选择 Java AES/ECB/PKCS5Padding：无需 IV；请输入与 Java raw 完全一致的 32 字节 UTF-8 Key。');
}

function generateAesIv() {
  if (!window.crypto?.getRandomValues) { notify('当前环境不支持安全随机 IV 生成。', true); return; }
  const bytes = window.crypto.getRandomValues(new Uint8Array(options.value.cipherMode === 'CBC' ? 16 : 12));
  options.value.ivEncoding = 'hex';
  options.value.iv = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  notify('已生成新的随机 IV（Hex）。每次加密都应重新生成，并与密文一起保存。');
}

function setSample() {
  if (currentId.value === 'aes') {
    input.value = currentTool.value.sampleInput;
    notify('已填入示例明文，保留当前 Tab 的加密参数和前缀。');
    return;
  }
  input.value = currentTool.value.sampleInput;
  secondaryInput.value = currentTool.value.sampleSecondaryInput || '';
  options.value = defaultOptions(currentTool.value);
  action.value = currentTool.value.defaultAction;
  void processTool();
}

async function processTool() { await workspace.runActive(); }
function clearContent() { workspace.clearActive(); }
function tabAlive(tab: ToolTab) { return workspace.state.value.tabs.some(t => t.id === tab.id); }

async function guarded<T>(task: () => Promise<T>, success?: string): Promise<T | undefined> {
  try { const value = await task(); if (success) notify(success); return value; }
  catch (reason) { notify(reason instanceof Error ? reason.message : '操作失败。', true); return undefined; }
}

async function pasteInput() {
  const tab = activeTab.value;
  const text = await guarded(readClipboard);
  if (text !== undefined && tabAlive(tab)) { tab.input = text; tab.error = ''; if (tab.result) tab.stale = true; }
}
async function encodeBinaryFile() {
  const tab = activeTab.value;
  const file = await guarded(() => openBinaryFile());
  if (!file || !tabAlive(tab)) return;
  const start = performance.now();
  tab.error = '';
  try {
    const encoded = await workspace.runBinary(tab, { action: 'encode', bytes: Uint8Array.from(file.bytes), urlSafe: !!tab.options.urlSafe, padding: !!tab.options.padding });
    if (!encoded || !tabAlive(tab)) return;
    tab.input = ''; tab.binarySourceName = file.name;
    tab.outputView = 'text'; tab.elapsed = Math.max(1, Math.round(performance.now() - start));
    workspace.recordResult(tab, { output: encoded.output || '', summary: file.name + ' · ' + byteLabel(file.bytes.length) + ' 已编码' });
    notify('已编码 ' + file.name);
  } catch (reason) { if (tabAlive(tab)) tab.error = reason instanceof Error ? reason.message : '文件编码失败。'; }
}
async function decodeBinaryFile() {
  const tab = activeTab.value; tab.error = '';
  if (!tab.input.trim()) { tab.error = '请先在输入区粘贴 Base64 内容。'; return; }
  try {
    const decoded = await workspace.runBinary(tab, { action: 'decode', input: tab.input, urlSafe: !!tab.options.urlSafe });
    if (!decoded?.bytes || !tabAlive(tab)) return;
    const saved = await saveBinaryFile(Array.from(decoded.bytes), 'decoded.bin');
    if (saved) { workspace.recordResult(tab, { output: '', summary: '已保存 ' + byteLabel(decoded.bytes.length) + ' 的二进制文件' }); notify('已保存二进制文件。'); }
  } catch (reason) { if (tabAlive(tab)) tab.error = reason instanceof Error ? reason.message : '文件解码失败。'; }
}
async function copyOutput() {
  const output = result.value?.output;
  if (output !== undefined) await guarded(() => writeClipboard(output), '结果已复制');
}

function swap() {
  if (currentTool.value.secondaryInputLabel) [input.value, secondaryInput.value] = [secondaryInput.value, input.value];
  else if (result.value) { const previous = input.value; input.value = result.value.output; result.value = { output: previous }; stale.value = true; }
}

function acceptFiles(files: ImportedFile[], asBatch = false, tab = activeTab.value) {
  if (!files.length || !tabAlive(tab)) return;
  if (asBatch || files.length > 1) {
    if (!getTool(tab.toolId)?.supportsBatch) { notify('当前工具需要成对输入，请分别导入内容。', true); return; }
    if (workspace.batchJobs.value.includes(tab.id)) { notify('请先停止当前标签的批量任务。', true); return; }
    tab.batch = files.map(file => ({ name: file.name, input: file.content, state: 'waiting' }));
    tab.batchVisible = true;
  } else {
    tab.input = files[0]!.content; tab.error = ''; if(tab.result)tab.stale = true;
    notify('已导入 ' + files[0]!.name);
  }
}
async function pasteSecondaryInput() {
  const tab = activeTab.value, text = await guarded(readClipboard);
  if (text !== undefined && tabAlive(tab)) {tab.secondaryInput = text; if(tab.result)tab.stale = true;}
}
async function importSecondaryFile() {
  const tab = activeTab.value, files = await guarded(() => openTextFiles(false));
  if (files?.[0] && tabAlive(tab)) {tab.secondaryInput = files[0].content; if(tab.result)tab.stale = true;}
}
async function importFiles(asBatch = false) {
  const tab = activeTab.value, files = await guarded(() => openTextFiles(asBatch));
  if (files) acceptFiles(files, asBatch, tab);
}
function setSvgaFile(tab: ToolTab, file: BinaryFile) {
  if (!tabAlive(tab)) return;
  if (!/\.svga$/i.test(file.name) || !file.bytes.length) { notify('请选择非空 .svga 文件。', true); return; }
  tab.result = null; tab.error = ''; tab.fileName = file.name;
  tab.input = encodeBase64Bytes(Uint8Array.from(file.bytes)); tab.stale = false;
}
async function openSvgaFile() {
  const tab = activeTab.value, file = await guarded(() => openBinaryFile('svga'));
  if (file) setSvgaFile(tab, file);
}
function svgaLoaded(tab: ToolTab, value: ToolResult) {
  if (tabAlive(tab) && (!tab.result || tab.result.output !== value.output)) workspace.recordResult(tab, value);
}
async function browserDrop(event: DragEvent) {
  dragOver.value = false;
  if (desktop) return;
  const tab = activeTab.value, files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  if (tab.toolId === 'svga') {
    if (files.length !== 1) { notify('请在一个标签中选择一个 SVGA 文件。', true); return; }
    const file = files[0]!;
    const bytes = await guarded(async () => Array.from(new Uint8Array(await file.arrayBuffer())));
    if (bytes) setSvgaFile(tab, { name: file.name, bytes });
    return;
  }
  const imported = await guarded(() => readBrowserFiles(files));
  if (imported) acceptFiles(imported, false, tab);
}
async function desktopDrop(paths: string[]) {
  const tab = activeTab.value;
  if (tab.toolId === 'svga') {
    if (paths.length !== 1) { notify('一次只预览一个 SVGA 文件。', true); return; }
    const file = await guarded(() => readDroppedBinaryFile(paths[0]!));
    if (file) setSvgaFile(tab, file);
  } else {
    const files = await guarded(() => readDroppedFiles(paths));
    if(files) acceptFiles(files, false, tab);
  }
}
async function runBatch() { await workspace.runBatch(); }
function cancelBatch() { workspace.stop(); }

async function exportBatch() {
  const files = batch.value.filter(item => item.state === 'done').map((item, index) => ({ name: `${String(index + 1).padStart(2, '0')}-${item.name.replace(/\.[^.]+$/, '')}.result.${currentTool.value.extension || 'txt'}`, content: item.output || '' }));
  const count = await guarded(() => saveBatchFiles(files));
  if (count) notify(`已导出 ${count} 个结果文件。`);
}

async function openPalette() {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  paletteQuery.value = ''; paletteIndex.value = 0; paletteOpen.value = true;
  await nextTick(); paletteSearch.value?.focus();
}

async function openSettings() {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  paletteOpen.value = false;
  settingsOpen.value = true;
  shortcutDraft.value = preferences.value.shortcut;
  closeToTrayDraft.value = preferences.value.closeToTray;
  status.value = await guarded(getDesktopStatus) || status.value;
  await nextTick(); document.querySelector<HTMLButtonElement>('.settings-dialog .close-dialog')?.focus();
}

async function saveDesktopSettings() {
  settingsSaving.value = true;
  try {
    await preferenceQueue;
    const saved = await savePreferences({ ...preferences.value, shortcut: shortcutDraft.value, closeToTray: closeToTrayDraft.value });
    preferences.value = saved;
    status.value = await getDesktopStatus();
    notify('桌面偏好已保存');
  } catch (reason) { notify(reason instanceof Error ? reason.message : '设置保存失败。', true); }
  finally { settingsSaving.value = false; }
}

async function checkUpdate() {
  updating.value = true;
  try { updateState.value = await checkForUpdates(); }
  catch (reason) { notify(reason instanceof Error ? reason.message : '检查更新失败。', true); }
  finally { updating.value = false; }
}

async function doInstallUpdate() {
  updating.value = true;
  try { await installUpdate(); notify('更新已安装，请退出并重新打开应用。'); }
  catch (reason) { notify(reason instanceof Error ? reason.message : '安装更新失败。', true); }
  finally { updating.value = false; }
}

function handleKeyboard(event: KeyboardEvent) {
  const command = event.metaKey || event.ctrlKey;
  if (!launcher && !settingsOpen.value && !paletteOpen.value && command) {
    const key = event.key.toLowerCase();
    if (key === 't') { event.preventDefault(); if (event.shiftKey) workspace.reopen(); else workspace.create(); return; }
    if (key === 'w') { event.preventDefault(); workspace.close(activeTab.value.id); return; }
    if (event.altKey && (key === 'arrowleft' || key === 'arrowright')) { event.preventDefault(); workspace.moveSelection(key === 'arrowleft' ? -1 : 1); return; }
  }
  if (command && event.key.toLowerCase() === 'k') { event.preventDefault(); void openPalette(); return; }
  if (command && event.key === ',') { event.preventDefault(); void openSettings(); return; }
  if (event.key === 'Escape') {
    if (settingsOpen.value) settingsOpen.value = false;
    else if (paletteOpen.value) paletteOpen.value = false;
    else if (batchVisible.value && !batchRunning.value) batchVisible.value = false;
    else if (launcher) dismissLauncher();
    return;
  }
  if ((paletteOpen.value || launcher) && !settingsOpen.value) {
    if (event.key === 'ArrowDown') { event.preventDefault(); paletteIndex.value = Math.min(paletteTools.value.length - 1, paletteIndex.value + 1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); paletteIndex.value = Math.max(0, paletteIndex.value - 1); }
    if (event.key === 'Enter' && paletteTools.value[paletteIndex.value]) { event.preventDefault(); void navigate(paletteTools.value[paletteIndex.value]!.id); }
    nextTick(() => document.querySelector('.command-item.selected')?.scrollIntoView({ block: 'nearest' }));
    if (event.key !== 'Tab') return;
  }
  if (command && event.key === 'Enter' && !settingsOpen.value) { event.preventDefault(); void processTool(); }
  if (event.key === 'Tab' && (settingsOpen.value || paletteOpen.value)) {
    const modal = document.querySelector<HTMLElement>('.dialog[aria-modal="true"]');
    const focusable = modal?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]');
    if (!focusable?.length) return;
    const first = focusable[0]!; const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
}

function byteCount(text: string) { return new TextEncoder().encode(text).byteLength; }
function byteLabel(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`; }
function themeChanged(event: MediaQueryListEvent) { systemDark.value = event.matches; }

onMounted(async () => {
  window.addEventListener('keydown', handleKeyboard);
  window.addEventListener('hashchange', routeChanged);
  mediaQuery.addEventListener('change', themeChanged);
  const loaded = await guarded(loadPreferences);
  if (loaded) preferences.value = loaded;
  status.value = await guarded(getDesktopStatus) || null;
  const openCleanup = await guarded(() => onOpenTool(id => { if (!launcher) { if (currentId.value === id) return; location.hash = `/tools/${id}`; } }));
  if (openCleanup) cleanup.push(openCleanup);
  const prefCleanup = await guarded(() => onPreferencesChanged(value => { preferences.value = value; }));
  if (prefCleanup) cleanup.push(prefCleanup);
  if (!launcher) {
    await workspace.initialize();
    const exitCleanup = await guarded(() => registerAesExit(async quit => {
      const ok = await workspace.flushLatest();
      if (!ok && quit) {
        exitBlocked.value = true;
        if (desktop) await guarded(() => showMainWindow(currentId.value));
        notify('工作台保存失败。已取消退出；可重试保存或在工作台设置中选择不保存退出。', true);
      }
      return ok;
    }));
    if (exitCleanup) cleanup.push(exitCleanup);
    const dropCleanup = await guarded(() => onRawFileDrop(paths => { void desktopDrop(paths); }));
    if (dropCleanup) cleanup.push(dropCleanup);
    const id = location.hash.replace(/^#\/?(?:tools\/)?/, '') || preferences.value.lastTool;
    applyTool(getTool(id)?.id || 'json');
    if (currentId.value === 'json' && !workspace.restored.value) setSample();
    ready.value = true;
  } else {
    const launcherCleanup = await guarded(() => onLauncherShown(() => { paletteQuery.value = ''; paletteIndex.value = 0; nextTick(() => paletteSearch.value?.focus()); }));
    if (launcherCleanup) cleanup.push(launcherCleanup);
    await nextTick(); paletteSearch.value?.focus();
  }
});

onBeforeUnmount(() => {
  workspace.dispose();
  clearTimeout(toastTimer);
  window.removeEventListener('keydown', handleKeyboard);
  window.removeEventListener('hashchange', routeChanged);
  mediaQuery.removeEventListener('change', themeChanged);
  cleanup.forEach(fn => fn());
});
</script>

<template>
  <div v-if="launcher" class="launcher-shell">
    <div class="launcher-heading"><div class="brand-mark"><Braces :size="24" /></div><span>My Tools</span><span class="launcher-subtitle">随时开始，专注手上的事。</span><button class="icon-button" aria-label="关闭快捷窗口" @click="dismissLauncher"><X :size="18" /></button></div>
    <div class="command-search"><Search :size="23" /><input ref="paletteSearch" v-model="paletteQuery" aria-label="搜索工具" placeholder="搜索工具，输入 JSON、Base64…" /><kbd>esc</kbd></div>
    <div class="command-section-title">{{ paletteQuery ? `${paletteTools.length} 个搜索结果` : '最近使用与全部工具' }}</div>
    <div class="command-list launcher-results" role="listbox" aria-label="工具搜索结果">
      <button v-for="(tool, index) in paletteTools" :key="tool.id" class="command-item" :class="{ selected: index === paletteIndex }" role="option" :aria-selected="index === paletteIndex" @mouseenter="paletteIndex = index" @click="navigate(tool.id)"><span class="tool-icon-tile small"><ToolIcon :id="tool.id" /></span><span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span><CornerDownLeft v-if="index === paletteIndex" :size="17" /></button>
      <div v-if="!paletteTools.length" class="search-empty">没有找到工具，试试其他关键词。</div>
    </div>
    <div class="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 选择工具</span><span><kbd>↵</kbd> 在工作台打开</span><ShieldCheck :size="15" /><span>离线可用</span></div>
  </div>

  <div v-else-if="ready" class="app-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed }" @dragover.prevent="dragOver = true" @dragleave.prevent="dragOver = false" @drop.prevent="browserDrop">
    <aside class="sidebar" aria-label="工具导航">
      <div class="brand"><div class="brand-mark"><Braces :size="25" :stroke-width="2" /></div><div><strong>My Tools<span class="brand-period">.</span></strong><span>YOUR DAILY TOOLBOX</span></div></div>
      <button class="sidebar-search" @click="openPalette"><Search :size="16" /><span>搜索工具</span><kbd>{{ modifier }} K</kbd></button>
      <div class="navigation-scroll">
        <section v-if="favorites.length" class="nav-group"><div class="nav-group-title"><Star :size="12" />我的收藏<span>{{ favorites.length }}</span></div><button v-for="tool in favorites" :key="tool.id" class="nav-item" :class="{ active: currentId === tool.id }" @click="navigate(tool.id)"><ToolIcon :id="tool.id" :size="17" /><span>{{ tool.name }}</span></button></section>
        <section v-for="category in categories" :key="category.id" class="nav-group"><div class="nav-group-title">{{ category.name }}</div><button v-for="tool in tools.filter(item => item.category === category.id)" :key="tool.id" class="nav-item" :class="{ active: currentId === tool.id }" :aria-current="currentId === tool.id ? 'page' : undefined" @click="navigate(tool.id)"><ToolIcon :id="tool.id" :size="17" /><span>{{ tool.name }}</span><span v-if="currentId === tool.id" class="active-dot"></span></button></section>
      </div>
      <div class="sidebar-bottom"><button class="nav-item" @click="openSettings"><Settings2 :size="17" /><span>偏好设置</span><kbd>{{ modifier }} ,</kbd></button><div class="sidebar-meta"><span><span class="status-dot"></span>本地运行 · 内容不上传</span><span>v{{ status?.version || '0.6.2' }}</span></div></div>
    </aside>

    <main class="workspace">
      <header class="topbar"><div class="breadcrumbs"><button class="icon-button sidebar-toggle" :aria-label="sidebarCollapsed ? '展开导航' : '收起导航'" @click="sidebarCollapsed = !sidebarCollapsed"><PanelLeftOpen v-if="sidebarCollapsed" :size="17" /><PanelLeftClose v-else :size="17" /></button><span>工具箱</span><ChevronRight :size="13" /><span>{{ categoryName }}</span><ChevronRight :size="13" /><strong>{{ currentTool.name }}</strong></div><div class="topbar-actions"><span class="offline-pill"><span class="status-dot"></span>Offline ready</span><button class="icon-button" title="切换深浅主题" aria-label="切换深浅主题" @click="persist({ theme: activeTheme === 'dark' ? 'light' : 'dark' })"><Sun v-if="activeTheme === 'dark'" :size="18" /><Moon v-else :size="18" /></button></div></header>
      <div class="workspace-content">
        <section class="tool-heading"><div class="tool-heading-icon"><ToolIcon :id="currentId" :size="30" /></div><div class="tool-heading-copy"><div class="eyebrow">{{ categoryName }}<span>/</span>LOCAL UTILITY</div><h1>{{ currentTool.name }}</h1><p>{{ currentTool.description }}</p></div><button class="favorite-button" :class="{ starred: isFavorite }" :aria-label="isFavorite ? '取消收藏' : '收藏工具'" :aria-pressed="isFavorite" @click="toggleFavorite()"><Star :size="17" :fill="isFavorite ? 'currentColor' : 'none'" /><span>{{ isFavorite ? '已收藏' : '收藏工具' }}</span></button></section>

        <section class="tool-workbench" :class="{ 'phone-workbench': currentId === 'phone' }" :aria-label="currentTool.name">
          <WorkspaceBar :workspace="workspace" :exit-blocked="exitBlocked" @restore-tool="restoredTool" @exit-without-saving="guarded(exitWithoutSavingAesWorkspace)" />
          <template v-if="currentId !== 'svga'">
          <div class="workbench-toolbar"><div class="action-tabs" aria-label="处理操作"><button v-for="item in currentTool.actions" :key="item.id" :class="{ selected: action === item.id }" :aria-pressed="action === item.id" @click="action = item.id">{{ item.label }}</button></div><div class="toolbar-end"><button v-if="currentTool.options.length" class="icon-button" :class="{ toggled: showOptions }" aria-label="展开或收起工具选项" :aria-expanded="showOptions" @click="showOptions = !showOptions"><SlidersHorizontal :size="17" /></button><button class="text-button" @click="setSample">填入示例<ArrowUpRight :size="14" /></button></div></div>
          <div v-if="showOptions && currentTool.options.length" class="tool-options"><label v-for="option in visibleOptions" :key="option.key" class="tool-option" :class="{ 'checkbox-option': option.type === 'checkbox', 'wide-option': option.type === 'textarea' || option.key === 'pattern' || option.key === 'prefix' }"><template v-if="option.type === 'checkbox'"><input v-model="options[option.key]" type="checkbox" /><span>{{ option.label }}</span></template><template v-else><span>{{ option.label }}</span><PhoneCountrySelect v-if="currentId === 'phone' && option.key === 'country'" :key="activeTab.id" :model-value="String(options[option.key])" @update:model-value="options[option.key] = $event" /><select v-else-if="option.type === 'select'" v-model="options[option.key]" :aria-label="option.label"><option v-for="choice in option.choices" :key="choice.value" :value="choice.value">{{ choice.label }}</option></select><textarea v-else-if="option.type === 'textarea'" :value="String(options[option.key] ?? '')" @input="options[option.key] = ($event.target as HTMLTextAreaElement).value" :aria-label="option.label" :title="option.description" rows="2" /><input v-else-if="option.type === 'number'" v-model.number="options[option.key]" type="number" :min="option.min" :max="option.max" :aria-label="option.label" /><input v-else v-model="options[option.key]" :type="['key', 'password', 'rawKey'].includes(option.key) ? 'password' : 'text'" :aria-label="option.label" :title="option.description" :placeholder="option.description || '留空'" autocomplete="off" spellcheck="false" /></template></label></div>

          <div v-if="currentId === 'aes'" class="binary-file-bar aes-mode-hint">
            <div><ShieldCheck :size="16" /><span v-if="options.profile !== 'advanced'">简单模式：随机 Salt / IV，保留与 v0.2.0 相同的 AES-256-GCM JSON 密文格式。</span><span v-else-if="options.cipherMode === 'GCM'">高级 GCM：同一 Key 下绝不能重复使用 IV；请每次加密生成新的随机 IV，并妥善保存。</span><span v-else-if="options.cipherMode === 'ECB'">Java ECB/PKCS5 兼容：无需 IV；ECB 泄露重复明文块，也不认证密文。</span><span v-else>高级 CBC：用于兼容旧系统；CBC 不认证密文完整性，建议新系统采用 GCM。</span></div>
            <div><button class="text-button" type="button" @click="useJavaEcbPreset"><ShieldCheck :size="14" />Java ECB/PKCS5</button><button v-if="options.profile === 'advanced' && options.cipherMode !== 'ECB'" class="text-button" type="button" @click="generateAesIv"><ShieldCheck :size="14" />生成随机 IV</button></div>
          </div>
          <div v-if="currentId === 'base64'" class="binary-file-bar"><div><Files :size="16" /><span>{{ binarySourceName ? `已编码：${binarySourceName}` : '需要处理图片或其他文件？' }}</span></div><div><button class="text-button" :disabled="binaryBusy || running" @click="encodeBinaryFile"><FolderOpen :size="14" />文件 → Base64</button><button class="text-button" :disabled="binaryBusy || running" @click="decodeBinaryFile"><Download :size="14" />输入 Base64 → 文件</button><LoaderCircle v-if="binaryBusy" :size="15" class="spin" /></div></div>

          <div v-if="currentTool.secondaryInputLabel" class="editor-pair comparison-pair"><section class="editor-pane"><div class="editor-label"><span><span class="pane-index">01</span>{{ currentTool.inputLabel || '输入内容' }}</span><button class="icon-button" title="粘贴" aria-label="粘贴输入" @click="pasteInput"><ClipboardPaste :size="15" /></button><button class="icon-button" title="导入原始文件" aria-label="导入原始文件" @click="importFiles()"><FolderOpen :size="15" /></button></div><CodeEditor v-model="input" :label="currentTool.inputLabel || '输入内容'" placeholder="在这里粘贴原始内容…" /></section><section class="editor-pane"><div class="editor-label"><span><span class="pane-index">02</span>{{ currentTool.secondaryInputLabel }}</span><div><button class="icon-button" title="粘贴修改后文本" aria-label="粘贴修改后文本" @click="pasteSecondaryInput"><ClipboardPaste :size="15" /></button><button class="icon-button" title="导入修改后文件" aria-label="导入修改后文件" @click="importSecondaryFile"><FolderOpen :size="15" /></button><button class="icon-button" title="交换两侧内容" aria-label="交换输入内容" @click="swap"><ArrowLeftRight :size="15" /></button></div></div><CodeEditor v-model="secondaryInput" :label="currentTool.secondaryInputLabel" placeholder="在这里粘贴修改后的内容…" /></section></div>

          <div class="editor-pair" :class="{ 'comparison-output': !!currentTool.secondaryInputLabel }"><section v-if="!currentTool.secondaryInputLabel" class="editor-pane input-pane"><div class="editor-label"><span><span class="pane-index">01</span>{{ currentTool.inputLabel || '输入内容' }}</span><div><button class="small-action" @click="pasteInput"><ClipboardPaste :size="14" />粘贴</button><button class="icon-button" title="导入文本文件" aria-label="导入文件" @click="importFiles()"><FolderOpen :size="16" /></button></div></div><CodeEditor v-model="input" :label="currentTool.inputLabel || '输入内容'" :placeholder="['uuid', 'password'].includes(currentId) ? '这个工具无需输入。设置选项后，点击生成即可。' : '粘贴内容，或将文本文件拖到这里…'" /><div class="editor-meta"><span>{{ input.split('\n').length }} 行<span class="meta-separator">·</span>{{ input.length.toLocaleString() }} 字符</span><span>UTF-8<span class="meta-separator">·</span>{{ byteLabel(inputBytes) }}</span></div></section>
            <section class="editor-pane output-pane"><div class="editor-label"><span><span class="pane-index">{{ currentTool.secondaryInputLabel ? '03' : '02' }}</span>处理结果<span v-if="result && !stale" class="success-label"><Check :size="12" />完成</span><span v-else-if="stale" class="stale-label">待重新处理</span></span><div class="output-controls"><div v-if="result && (canTree || result.diff)" class="view-switch"><button :class="{ selected: outputView === 'text' }" @click="outputView = 'text'">文本</button><button v-if="canTree" :class="{ selected: outputView === 'tree' }" @click="outputView = 'tree'">树形</button><button v-if="result.diff" :class="{ selected: outputView === 'diff' }" @click="outputView = 'diff'">差异</button></div><button class="small-action" :disabled="!result" @click="copyOutput"><Copy :size="14" />复制</button></div></div>
              <div v-if="!result" class="output-empty"><div class="output-empty-icon"><ToolIcon :id="currentId" :size="30" /></div><strong>结果会显示在这里</strong><span>输入内容后，点击“{{ selectedAction?.label }}”</span><kbd>{{ modifier }} ↵</kbd></div>
              <div v-else-if="outputView === 'tree'" class="tree-view"><JsonTree v-if="treeValue !== undefined" :value="treeValue" /><div v-else class="tree-limit">当前结果不是 JSON，请切换到文本视图。</div></div>
              <div v-else-if="outputView === 'diff' && result.diff" class="diff-view"><div v-for="(part, index) in result.diff" :key="index" :class="`diff-part diff-${part.type}`"><span aria-hidden="true">{{ part.type === 'add' ? '+' : part.type === 'remove' ? '−' : ' ' }}</span><pre>{{ part.text }}</pre></div></div>
              <CodeEditor v-else :model-value="result.output" label="处理结果" readonly />
              <div class="editor-meta"><span>{{ result?.summary || (result ? `${result.output.length.toLocaleString()} 字符` : '等待处理') }}</span><span>{{ result ? `${byteLabel(outputBytes)} · ${elapsed} ms` : '仅在本机处理' }}</span></div>
            </section></div>

          <div v-if="error" class="error-banner" role="alert"><CircleAlert :size="17" /><span>{{ error }}</span><button class="icon-button" aria-label="关闭错误提示" @click="error = ''"><X :size="15" /></button></div>
          <div v-for="warning in result?.warnings || []" :key="warning" class="warning-banner"><CircleAlert :size="15" /><span>{{ warning }}</span></div>

          <div class="workbench-footer"><div class="footer-tools"><button class="text-button" @click="clearContent"><Trash2 :size="15" />清空</button><button class="text-button" :disabled="!result && !currentTool.secondaryInputLabel" @click="swap"><ArrowLeftRight :size="15" />交换</button><span class="toolbar-divider"></span><button class="text-button" :disabled="!result" @click="guarded(async () => { const saved = await saveTextFile(result!.output, `${currentId}-result.${currentTool.extension || 'txt'}`); if (saved) notify('结果已保存'); })"><Download :size="15" />导出结果</button></div><button v-if="(running || binaryBusy) && !batchRunning" class="primary-button cancel-button" @click="cancel()"><Square :size="13" />停止处理</button><button v-else class="primary-button" :disabled="batchRunning || binaryBusy" @click="processTool"><Play :size="14" fill="currentColor" />{{ selectedAction?.label || '开始处理' }}<kbd>{{ modifier }} ↵</kbd></button></div>
          </template>
          <SvgaPreview v-else :key="activeTab.id" :tab="activeTab" @open="openSvgaFile" @clear="clearContent" @loaded="svgaLoaded" />
        </section>

        <div class="under-workbench"><div class="privacy-note"><ShieldCheck :size="17" /><span>仅在本机处理；历史与保存范围由工作台设置控制，不会上传。</span></div><button v-if="currentTool.supportsBatch" class="batch-link" @click="batch.length ? batchVisible = !batchVisible : importFiles(true)"><Files :size="16" />批量处理<span v-if="batch.length">{{ batch.length }}</span><ArrowRight :size="14" /></button></div>

        <section v-if="batchVisible" class="batch-panel"><div class="batch-heading"><div><Files :size="19" /><strong>批量文件处理</strong><span>{{ batchDone }} 成功 · {{ batchErrors }} 失败</span></div><div><button class="text-button" :disabled="batchRunning" @click="importFiles(true)">重新选择</button><button class="text-button" :disabled="!batchDone || batchRunning" @click="exportBatch"><Download :size="14" />导出成功结果</button><button v-if="batchRunning" class="primary-button compact" @click="cancelBatch">停止</button><button v-else class="primary-button compact" @click="runBatch">开始处理</button></div></div><div v-for="item in batch" :key="item.name" class="batch-row"><LoaderCircle v-if="item.state === 'running'" :size="16" class="spin" /><CheckCircle2 v-else-if="item.state === 'done'" :size="16" class="success-text" /><CircleAlert v-else-if="item.state === 'error'" :size="16" class="error-text" /><Files v-else :size="16" /><span>{{ item.name }}</span><small>{{ item.error || (item.state === 'done' ? `${byteLabel(byteCount(item.output || ''))} · 已完成` : item.state === 'running' ? '处理中' : '等待处理') }}</small></div><p class="batch-note">使用当前操作与选项依次处理；每个文件单独出结果。导出不会覆盖原文件。</p></section>

        <section class="quick-access"><div class="section-heading"><h2>常用工具</h2><span>让日常工作，少一点重复。</span><button class="text-button" @click="openPalette">全部 {{ tools.length }} 个<ArrowUpRight :size="14" /></button></div><div class="quick-grid"><button v-for="tool in (favorites.length ? favorites : ['string-join', 'base64', 'timestamp', 'url'].map(getTool).filter((item): item is ToolDefinition => !!item)).filter(item => item.id !== currentId).slice(0, 4)" :key="tool.id" class="quick-card" @click="navigate(tool.id)"><span class="tool-icon-tile"><ToolIcon :id="tool.id" :size="21" /></span><span><strong>{{ tool.name }}</strong><small>{{ tool.description.split('，')[0] }}</small></span><ArrowUpRight :size="15" /></button></div></section>
        <footer class="workspace-footer"><span>MY TOOLS<span class="footer-dot">·</span>Built for your everyday.</span><span><Keyboard :size="13" />{{ modifier }} K 快速切换工具</span></footer>
      </div>
    </main>
    <div v-if="dragOver && !desktop" class="drop-overlay"><FolderOpen :size="45" /><strong>放开以导入文件</strong><span>支持 UTF-8 文本和当前工具的文件格式</span></div>
  </div>

  <div v-else class="boot-screen"><div class="brand-mark"><Braces :size="25" /></div><strong>My Tools</strong><span>正在打开你的工具箱…</span></div>

  <div v-if="paletteOpen && !launcher" class="modal-backdrop" @mousedown.self="paletteOpen = false"><section class="dialog command-dialog" role="dialog" aria-modal="true" aria-label="搜索与切换工具"><div class="command-search"><Search :size="22" /><input ref="paletteSearch" v-model="paletteQuery" placeholder="搜索工具、功能或关键词…" aria-label="搜索工具" /><button class="key-button" aria-label="关闭工具搜索" @click="paletteOpen = false">esc</button></div><div class="command-section-title">{{ paletteQuery ? `${paletteTools.length} 个搜索结果` : '最近使用与全部工具' }}</div><div class="command-list" role="listbox" aria-label="工具搜索结果"><button v-for="(tool, index) in paletteTools" :key="tool.id" class="command-item" :class="{ selected: index === paletteIndex }" role="option" :aria-selected="index === paletteIndex" @mouseenter="paletteIndex = index" @click="navigate(tool.id)"><span class="tool-icon-tile small"><ToolIcon :id="tool.id" /></span><span><strong>{{ tool.name }}</strong><small>{{ tool.description }}</small></span><CornerDownLeft v-if="index === paletteIndex" :size="17" /><Star v-else-if="preferences.favorites.includes(tool.id)" :size="14" /></button><div v-if="!paletteTools.length" class="search-empty">没有找到工具，试试“编码”“时间”或“SQL”。</div></div><div class="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开工具</span><span><kbd>esc</kbd> 关闭</span></div></section></div>

  <div v-if="settingsOpen" class="modal-backdrop" @mousedown.self="settingsOpen = false"><section class="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="dialog-heading"><div><span class="eyebrow">MAKE IT YOURS</span><h2 id="settings-title">偏好设置</h2></div><button class="icon-button close-dialog" aria-label="关闭偏好设置" @click="settingsOpen = false"><X :size="21" /></button></div><div class="settings-body"><section class="settings-section"><h3>外观</h3><p>选择一个让你工作更舒服的界面。</p><div class="theme-picker"><button :class="{ selected: preferences.theme === 'light' }" @click="persist({ theme: 'light' })"><Sun :size="20" />浅色<Check v-if="preferences.theme === 'light'" :size="15" /></button><button :class="{ selected: preferences.theme === 'dark' }" @click="persist({ theme: 'dark' })"><Moon :size="20" />深色<Check v-if="preferences.theme === 'dark'" :size="15" /></button><button :class="{ selected: preferences.theme === 'system' }" @click="persist({ theme: 'system' })"><Monitor :size="20" />跟随系统<Check v-if="preferences.theme === 'system'" :size="15" /></button></div></section><section class="settings-section"><h3>桌面与快捷键</h3><p v-if="!desktop">当前为界面预览。系统快捷键、托盘与原生窗口在安装版中使用。</p><label class="settings-field"><span>全局唤起快捷键</span><input v-model="shortcutDraft" aria-label="全局唤起快捷键" placeholder="CmdOrCtrl+Shift+Space" :disabled="!desktop" /><small>例如 CmdOrCtrl+Shift+Space；已被占用时会提示。</small></label><label class="settings-checkbox"><input v-model="closeToTrayDraft" type="checkbox" :disabled="!desktop" /><span>关闭窗口后保留在系统托盘 / 菜单栏</span></label><p v-if="status?.shortcutError" class="error-text">{{ status.shortcutError }}</p><p v-if="desktop && status && !status.trayAvailable" class="setting-warning">此环境没有可用托盘，关闭窗口将正常退出。</p><button class="secondary-button" :disabled="!desktop || settingsSaving" @click="saveDesktopSettings"><LoaderCircle v-if="settingsSaving" :size="15" class="spin" /><Check v-else :size="15" />保存桌面设置</button></section><section class="settings-section"><h3>本地数据</h3><p>仅保存主题、工具收藏、最近使用的工具名和桌面偏好。除明确开启工作台完整会话加密保存的字段外，输入、输出、令牌、密钥与文件内容只在当前会话内存中。</p><button class="text-button" @click="persist({ recent: [] }).then(() => notify('最近使用记录已清空'))"><RotateCcw :size="14" />清空最近使用</button></section><section class="settings-section"><h3>版本与更新</h3><div class="version-card"><span class="tool-icon-tile"><PackageCheck :size="23" /></span><div><strong>My Tools {{ status?.version || '0.6.2' }}</strong><span>{{ desktop ? status?.platform || '桌面应用' : '界面预览' }}</span></div><span class="local-badge">LOCAL FIRST</span></div><p>{{ status?.updaterEnabled ? '更新检查由你手动触发，只接受已配置签名的更新。' : '当前构建未配置在线更新。可从仓库发布页下载新版本后覆盖安装。' }}</p><button v-if="status?.updaterEnabled" class="secondary-button" :disabled="updating" @click="checkUpdate"><LoaderCircle v-if="updating" :size="15" class="spin" /><Download v-else :size="15" />检查更新</button><div v-if="updateState" class="update-result"><p>{{ updateState.message }}</p><p v-if="updateState.notes" class="release-notes">{{ updateState.notes }}</p><button v-if="updateState.available" class="primary-button" :disabled="updating" @click="doInstallUpdate">安装 {{ updateState.version }}</button></div></section></div><div class="settings-footer"><ShieldCheck :size="16" />你的工具，你的数据，你的设备。</div></section></div>

  <Transition name="toast"><div v-if="toast" class="toast-message" :class="{ 'is-error': toast.error }" role="status"><CircleAlert v-if="toast.error" :size="18" /><CheckCircle2 v-else :size="18" /><span>{{ toast.text }}</span><button class="icon-button" aria-label="关闭提示" @click="toast = null"><X :size="14" /></button></div></Transition>
</template>
