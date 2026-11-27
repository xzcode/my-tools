import { computed, ref, watch } from 'vue';
import { aesDefaults, initialWorkspace, newTab, copyConfig, configOptions, snapshotWorkspace, restoreWorkspace, OPEN_LIMIT, CLOSED_LIMIT, TEMPLATE_LIMIT, SESSION_MAX_BYTES, builtInTemplates } from '../core/aes-workspace';
import type { AesTab, AesTemplate, SaveMode } from '../core/aes-workspace';
import { useToolRunner } from './useToolRunner';
import { loadAesWorkspace, saveAesWorkspace, clearAesWorkspace } from '../platform/aes-workspace';

type Runner = ReturnType<typeof useToolRunner>;
export function useAesWorkspace() {
  const state = ref(initialWorkspace());
  const ready = ref(false);
  const blocked = ref(false);
  const saveStatus = ref<'idle'|'pending'|'saving'|'saved'|'error'>('idle');
  const saveError = ref('');
  const jobs = ref<string[]>([]);
  const runners = new Map<string, Runner>();
  const tokens = new Map<string, number>();
  const active = computed(() => state.value.tabs.find(t => t.id === state.value.activeId) ?? state.value.tabs[0]!);
  const running = computed(() => jobs.value.includes(active.value.id));
  const templates = computed(() => [...builtInTemplates, ...state.value.templates]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  let revision = 0;
  let lastSaved = -1;
  let paused = false;

  async function initialize() {
    try {
      const saved = await loadAesWorkspace();
      if (saved) state.value = restoreWorkspace(saved);
      saveStatus.value = saved ? 'saved' : 'idle';
    } catch (e) {
      blocked.value = true;
      saveError.value = String(e instanceof Error ? e.message : e);
      saveStatus.value = 'error';
    } finally { ready.value = true; }
  }

  function schedule() {
    if (!ready.value || paused || blocked.value) return;
    revision++;
    saveStatus.value = 'pending';
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, 500);
  }
  watch(state, schedule, { deep: true, flush: 'sync' });
  watch([() => active.value.id, () => active.value.input, () => active.value.action, () => active.value.options], ([id], [old]) => {
    // Tab selection itself must never invalidate an existing output.
    if (id !== old) return;
    if (active.value.result) active.value.stale = true;
    active.value.error = '';
  }, { deep: true, flush: 'sync' });

  async function flush(): Promise<boolean> {
    clearTimeout(timer);
    if (!ready.value || paused) return true;
    if (blocked.value) return false;
    const at = revision;
    if (lastSaved === at && saveStatus.value === 'saved') return true;
    let json: string;
    try {
      json = JSON.stringify(snapshotWorkspace(state.value));
      if (new TextEncoder().encode(json).byteLength > SESSION_MAX_BYTES) throw new Error('自动保存上限 4 MiB，请减少保存的明文/结果或关闭相关保存选项。');
    } catch (e) {
      saveError.value = e instanceof Error ? e.message : String(e);
      saveStatus.value = 'error';
      return false;
    }
    saveStatus.value = 'saving';
    const task = queue.catch(() => undefined).then(() => saveAesWorkspace(json));
    queue = task;
    try {
      await task;
      lastSaved = at;
      if (revision === at) { saveStatus.value = 'saved'; saveError.value = ''; }
      return true;
    } catch (e) {
      saveStatus.value = 'error';
      saveError.value = e instanceof Error ? e.message : String(e);
      return false;
    }
  }
  async function flushLatest() {
    // If a worker completes while the snapshot is being written, save again.
    for (let i = 0; i < 4; i++) {
      const at = revision;
      if (!await flush()) return false;
      if (at === revision) return true;
    }
    saveStatus.value = 'error';
    saveError.value = '工作台仍有变化，请停止运行中的任务后重试保存。';
    return false;
  }
  async function setMode(mode: SaveMode): Promise<boolean> {
    if (blocked.value) return false;
    const previous = state.value.mode;
    state.value.mode = mode;
    if (await flushLatest()) return true;
    // Never silently switch to a less secure mode or claim success.
    state.value.mode = previous;
    clearTimeout(timer);
    saveStatus.value = 'error';
    return false;
  }

  function select(id: string) { if (state.value.tabs.some(t => t.id === id)) state.value.activeId = id; }
  function create(): boolean {
    if (state.value.tabs.length >= OPEN_LIMIT) return false;
    let i = 1;
    while (state.value.tabs.some(t => t.name === 'AES ' + i)) i++;
    const tab = newTab('AES ' + i);
    state.value.tabs.push(tab);
    select(tab.id);
    return true;
  }
  function rename(id: string, name: string): boolean {
    const tab = state.value.tabs.find(t => t.id === id);
    const trimmed = name.trim().slice(0, 100);
    if (!tab || !trimmed) return false;
    tab.name = trimmed;
    return true;
  }
  function duplicate(id: string): boolean {
    const source = state.value.tabs.find(t => t.id === id);
    if (!source || state.value.tabs.length >= OPEN_LIMIT) return false;
    const tab = copyConfig(source);
    tab.name = tab.name.slice(0, 100);
    state.value.tabs.splice(state.value.tabs.indexOf(source) + 1, 0, tab);
    select(tab.id);
    return true;
  }
  function stop(id = active.value.id) {
    tokens.set(id, (tokens.get(id) ?? 0) + 1);
    runners.get(id)?.cancel();
    jobs.value = jobs.value.filter(t => t !== id);
  }
  function close(id: string) {
    const pos = state.value.tabs.findIndex(t => t.id === id);
    if (pos < 0) return;
    const tab = state.value.tabs[pos]!;
    stop(id);
    runners.delete(id);
    const snapshot = JSON.parse(JSON.stringify(tab)) as AesTab;
    state.value.closed.unshift(snapshot);
    state.value.closed.splice(CLOSED_LIMIT);
    const remaining = state.value.tabs.filter(t => t.id !== id);
    if (!remaining.length) remaining.push(newTab());
    state.value.tabs = remaining;
    if (state.value.activeId === id) select(remaining[Math.min(pos, remaining.length - 1)]!.id);
  }
  function closeOthers(id: string, rightOnly = false) {
    const list = state.value.tabs;
    const pos = list.findIndex(t => t.id === id);
    if (pos < 0) return;
    select(id);
    const ids = (rightOnly ? list.slice(pos + 1) : list.filter(t => t.id !== id)).map(t => t.id);
    for (const closeId of ids) close(closeId);
  }
  function reopen(): boolean {
    if (state.value.tabs.length >= OPEN_LIMIT || !state.value.closed.length) return false;
    const tab = state.value.closed.shift()!;
    state.value.tabs.push(tab);
    select(tab.id);
    return true;
  }
  function reorder(source: string, target: string) {
    if (source === target) return;
    const tabs = [...state.value.tabs];
    const from = tabs.findIndex(t => t.id === source), to = tabs.findIndex(t => t.id === target);
    if (from < 0 || to < 0) return;
    const tab = tabs.splice(from, 1)[0]!;
    tabs.splice(to, 0, tab);
    state.value.tabs = tabs;
  }
  function moveSelection(direction: number) {
    const tabs = state.value.tabs;
    const i = tabs.findIndex(t => t.id === state.value.activeId);
    select(tabs[(i + direction + tabs.length) % tabs.length]!.id);
  }
  function applyTemplate(id: string) {
    const template = templates.value.find(t => t.id === id);
    if (!template) return;
    // No secret is loaded from templates. Preserve the active tab's typed key,
    // but clear IV/AAD on profile changes so users do not reuse GCM nonces.
    active.value.options = { ...active.value.options, ...template.options, iv: '', aad: '' };
  }
  function saveTemplate(name: string, id?: string): boolean {
    name = name.trim().slice(0, 100);
    if (!name) return false;
    const existing = id ? state.value.templates.find(t => t.id === id) : undefined;
    if (existing) { existing.name = name; existing.options = configOptions(active.value.options); return true; }
    if (state.value.templates.length >= TEMPLATE_LIMIT) return false;
    state.value.templates.push({ id: crypto.randomUUID(), name, options: configOptions(active.value.options) } as AesTemplate);
    return true;
  }
  function removeTemplate(id: string) { state.value.templates = state.value.templates.filter(t => t.id !== id); }
  function clearActive() {
    const t = active.value;
    stop(t.id);
    t.input = ''; t.result = null; t.error = ''; t.stale = false;
    t.options = { ...t.options, password: '', rawKey: '', iv: '', aad: '' };
    t.outputView = 'text'; t.elapsed = 0;
  }
  async function runActive() {
    const tab = active.value, id = tab.id;
    if (jobs.value.includes(id)) return;
    const request = { toolId: 'aes', input: tab.input, action: tab.action, options: { ...tab.options } };
    if (new TextEncoder().encode(tab.input).byteLength > 5 * 1024 * 1024) { tab.error = '单次文本最大 5 MiB。'; return; }
    const before = JSON.stringify(request);
    let runner = runners.get(id);
    if (!runner) { runner = useToolRunner(); runners.set(id, runner); }
    const token = (tokens.get(id) ?? 0) + 1;
    tokens.set(id, token);
    jobs.value = [...jobs.value, id];
    tab.error = '';
    if (tab.result) tab.stale = true;
    const start = performance.now();
    try {
      const result = await runner.run(request);
      if (tokens.get(id) !== token || !state.value.tabs.some(t => t.id === id)) return;
      tab.result = result;
      tab.stale = before !== JSON.stringify({ toolId: 'aes', input: tab.input, action: tab.action, options: { ...tab.options } });
      tab.elapsed = Math.max(1, Math.round(performance.now() - start));
      tab.outputView = 'text';
    } catch (e) {
      if (tokens.get(id) === token) tab.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (tokens.get(id) === token) jobs.value = jobs.value.filter(t => t !== id);
    }
  }
  async function erase(): Promise<boolean> {
    paused = true;
    clearTimeout(timer);
    await queue.catch(() => undefined);
    try {
      const warning = await clearAesWorkspace();
      for (const tab of state.value.tabs) stop(tab.id);
      runners.clear(); tokens.clear();
      state.value = initialWorkspace();
      blocked.value = false;
      lastSaved = -1;
      saveStatus.value = warning ? 'error' : 'idle'; saveError.value = warning ?? '';
      return true;
    } catch (e) {
      saveStatus.value = 'error'; saveError.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally { paused = false; }
  }
  function dispose() {
    clearTimeout(timer);
    for (const runner of runners.values()) runner.cancel();
    runners.clear();
  }
  return { state, ready, blocked, saveStatus, saveError, jobs, active, running, templates, initialize, flush, flushLatest,
    setMode, select, create, rename, duplicate, stop, close, closeOthers, reopen, reorder, moveSelection,
    applyTemplate, saveTemplate, removeTemplate, clearActive, runActive, erase, dispose, defaults: aesDefaults };
}
