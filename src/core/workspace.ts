import { defaultOptions, getTool } from './catalog';
import type { OptionValue, ToolResult } from './types';
import { initialWorkspace as oldInitial, restoreWorkspace as restoreLegacy, configOptions as aesConfig, builtInTemplates } from './aes-workspace';
import type { AesTab, AesTemplate, SaveMode, SaveFields, SecretField } from './aes-workspace';
export { builtInTemplates };
export type { SaveMode, SecretField };
export type BatchItem = { name: string; input: string; output?: string; error?: string; state: 'waiting' | 'running' | 'done' | 'error' };
export interface ToolTab extends AesTab {
  toolId: string; secondaryInput: string; fileName: string; binarySourceName: string;
  batch: BatchItem[]; batchVisible: boolean;
}
export interface HistoryEntry { id: string; at: number; type: 'closed' | 'run'; tab: ToolTab }
export interface Workspace {
  version: 2; mode: SaveMode; fields: SaveFields; tabs: ToolTab[];
  activeIds: Record<string, string>; history: HistoryEntry[]; templates: AesTemplate[];
}
export function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }
export function toolDefaults(id: string) { return defaultOptions(getTool(id)!); }
export function safeOptions(toolId: string, options: Record<string, OptionValue>): Record<string, OptionValue> {
  const tool = getTool(toolId)!;
  const out: Record<string, OptionValue> = {};
  for (const opt of tool.options) {
    const v = options[opt.key] ?? opt.defaultValue;
    if (opt.type === 'select' && opt.choices?.some(c => c.value === v)) out[opt.key] = v;
    if (opt.type === 'checkbox' && typeof v === 'boolean') out[opt.key] = v;
    if (opt.type === 'number' && typeof v === 'number' && Number.isFinite(v) && v >= (opt.min ?? 0) && v <= (opt.max ?? 100000)) out[opt.key] = v;
  }
  return out;
}
export function tabName(id: string, n: number) { return id === 'aes' ? 'AES ' + n : getTool(id)!.name + ' ' + n; }
export function newToolTab(toolId: string, name = tabName(toolId, 1), options = toolDefaults(toolId)): ToolTab {
  return { id: crypto.randomUUID(), toolId, name, action: getTool(toolId)!.defaultAction, input: '', secondaryInput: '',
    options: { ...options }, result: null, error: '', stale: false, elapsed: 0, outputView: 'text',
    fileName: '', binarySourceName: '', batch: [], batchVisible: false };
}
export function newWorkspace(): Workspace {
  const tab = newToolTab('json');
  return { version: 2, mode: 'config', fields: oldInitial().fields, tabs: [tab], activeIds: { json: tab.id }, history: [], templates: [] };
}
export function duplicateTab(tab: ToolTab): ToolTab {
  return newToolTab(tab.toolId, (tab.name + ' 副本').slice(0,100), { ...toolDefaults(tab.toolId), ...safeOptions(tab.toolId, tab.options) });
}
function optionField(key: string, toolId: string): SecretField {
  if (['key','rawKey','password'].includes(key)) return 'key';
  if (toolId === 'aes' && key === 'iv') return 'iv';
  if (toolId === 'aes' && key === 'aad') return 'aad';
  if (toolId === 'aes' && key === 'prefix') return 'prefix';
  return 'input';
}
function projectTab(tab: ToolTab, state: Workspace): ToolTab {
  const full = state.mode === 'full', f = state.fields;
  const opts = safeOptions(tab.toolId, tab.options);
  if (full) for (const option of getTool(tab.toolId)!.options) {
    if ((option.type === 'text' || option.type === 'textarea') && f[optionField(option.key, tab.toolId)]) {
      const value = tab.options[option.key];
      if (typeof value === 'string') opts[option.key] = value;
    }
  }
  const payload = full && f.input, output = full && f.output;
  return { id: tab.id, toolId: tab.toolId, name: tab.name.slice(0,100), action: tab.action,
    input: payload ? tab.input : '', secondaryInput: payload ? tab.secondaryInput : '',
    options: opts, result: output && tab.result ? clone(tab.result) : null,
    error: '', stale: !!(output && tab.result) && (tab.stale || !f.input || !f.key || !f.iv || !f.aad || !f.prefix),
    elapsed: 0, outputView: 'text', fileName: payload ? tab.fileName : '',
    binarySourceName: payload ? tab.binarySourceName : '',
    batch: payload && output ? tab.batch.map(b => ({ ...b, state: b.state === 'running' ? 'waiting' : b.state })) : [],
    batchVisible: payload && output && tab.batchVisible,
  };
}
export function snapshotWorkspace(state: Workspace): Workspace {
  if (state.mode === 'off') return { version: 2, mode: 'off', fields: { ...state.fields }, tabs: [], activeIds: {}, history: [], templates: [] };
  return { version: 2, mode: state.mode, fields: { ...state.fields },
    tabs: state.tabs.map(t => projectTab(t, state)), activeIds: { ...state.activeIds },
    history: state.history.map(h => ({ id: h.id, at: h.at, type: h.type, tab: projectTab(h.tab,state) })),
    templates: state.templates.map(t => ({ id: t.id, name: t.name, options: aesConfig(t.options) })) };
}
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('工作台存档结构无效。');
  return v as Record<string,unknown>;
}
function string(v: unknown, max = Infinity) {
  if (typeof v !== 'string' || v.length > max) throw Error('工作台存档字符串无效。');
  return v;
}
function id(v: unknown) { const s = string(v,100); if (!/^[a-zA-Z0-9-]+$/.test(s)) throw Error('工作台标识无效。'); return s; }
function optionsFor(toolId: string, value: unknown) {
  const obj = record(value), tool = getTool(toolId)!;
  const out = toolDefaults(toolId);
  for (const option of tool.options) {
    const v = obj[option.key];
    if (v === undefined) continue;
    if (option.type === 'select' && option.choices?.some(c => c.value === v)) out[option.key] = v as string;
    else if (option.type === 'checkbox' && typeof v === 'boolean') out[option.key] = v;
    else if (option.type === 'number' && typeof v === 'number' && Number.isFinite(v) && v >= (option.min ?? 0) && v <= (option.max ?? 100000)) out[option.key] = v;
    else if ((option.type === 'text' || option.type === 'textarea') && typeof v === 'string') out[option.key] = v;
    else throw Error('工作台存档选项无效：' + option.label);
  }
  return out;
}
function resultFor(value: unknown): ToolResult | null {
  if (value == null) return null;
  const r = record(value), result: ToolResult = { output: string(r.output) };
  if (typeof r.summary === 'string') result.summary = r.summary.slice(0,2000);
  if (['text','json','diff'].includes(String(r.kind))) result.kind = r.kind as ToolResult['kind'];
  if (Array.isArray(r.warnings)) result.warnings = r.warnings.filter((x): x is string => typeof x === 'string').slice(0,20).map(x=>x.slice(0,2000));
  if (Array.isArray(r.diff)) result.diff = r.diff.map(v => { const d=record(v); if (!['equal','add','remove'].includes(String(d.type))) throw Error('差异存档无效'); return { type: d.type as 'equal'|'add'|'remove', text: string(d.text) }; });
  if (r.stats && typeof r.stats === 'object' && !Array.isArray(r.stats)) result.stats = Object.fromEntries(Object.entries(r.stats).filter(([,v])=>typeof v==='string'||typeof v==='number')) as Record<string,string|number>;
  return result;
}
function readTab(value: unknown): ToolTab {
  const t = record(value), toolId = string(t.toolId,80), tool = getTool(toolId);
  if (!tool || !tool.actions.some(a => a.id === t.action)) throw Error('工作台工具或操作无效。');
  const batch = Array.isArray(t.batch) ? t.batch.map(v => {
    const b=record(v);
    return { name:string(b.name,512), input:string(b.input), output:typeof b.output==='string'?b.output:undefined, error:typeof b.error==='string'?b.error.slice(0,1000):undefined,
      state: (b.state==='done'||b.state==='error'?b.state:'waiting') as BatchItem['state'] };
  }) : [];
  return { id:id(t.id), toolId, name:string(t.name,100), action:string(t.action,80), input:string(t.input), secondaryInput:string(t.secondaryInput??''),
    options:optionsFor(toolId,t.options), result:resultFor(t.result), error:'', stale:t.stale===true, elapsed:0, outputView:'text',
    fileName:string(t.fileName??'',512), binarySourceName:string(t.binarySourceName??'',512), batch, batchVisible:t.batchVisible===true };
}
export function restoreUnifiedWorkspace(json: string): Workspace {
  const obj = record(JSON.parse(json));
  if (obj.version === 1) {
    const old = restoreLegacy(json), base = newWorkspace();
    const convert = (t: AesTab): ToolTab => ({ ...newToolTab('aes'), ...clone(t), toolId:'aes' });
    base.mode = old.mode; base.fields = old.fields; base.templates = old.templates;
    if (old.mode !== 'off') {
      base.tabs.push(...old.tabs.map(convert));
      if (old.tabs.length) base.activeIds.aes = old.activeId;
      base.history = old.closed.map((t,i) => ({ id:crypto.randomUUID(), at:Date.now()-i, type:'closed', tab:convert(t) }));
    }
    return base;
  }
  if (obj.version !== 2 || !['off','config','full'].includes(String(obj.mode))) throw Error('工作台存档版本不受支持。');
  const base = newWorkspace(); base.mode = obj.mode as SaveMode;
  const f = record(obj.fields);
  for (const k of Object.keys(base.fields) as SecretField[]) { if (typeof f[k] !== 'boolean') throw Error('工作台保存选项无效。'); base.fields[k] = f[k] as boolean; }
  if (base.mode === 'off') return base;
  if (!Array.isArray(obj.tabs) || !Array.isArray(obj.history) || !Array.isArray(obj.templates)) throw Error('工作台存档数量无效。');
  base.tabs = obj.tabs.map(readTab);
  if (new Set(base.tabs.map(t=>t.id)).size !== base.tabs.length) throw Error('工作台标签重复。');
  base.activeIds = {};
  const ids = record(obj.activeIds);
  for (const t of base.tabs) if (!base.activeIds[t.toolId] || ids[t.toolId] === t.id) base.activeIds[t.toolId] = t.id;
  base.history = obj.history.map(value => { const h=record(value); if (!['closed','run'].includes(String(h.type))||typeof h.at!=='number'||!Number.isFinite(h.at)||h.at<0) throw Error('历史记录无效。');
    return { id:id(h.id), at:h.at, type:h.type as HistoryEntry['type'], tab:readTab(h.tab) }; }).sort((a,b)=>b.at-a.at);
  if (new Set(base.history.map(h=>h.id)).size!==base.history.length) throw Error('历史记录重复。');
  base.templates = obj.templates.map(value=>{const t=record(value);return {id:id(t.id),name:string(t.name,100),options:aesConfig(optionsFor('aes',t.options))};});
  // A config-only file cannot restore arbitrary content even if externally edited.
  const projected = snapshotWorkspace(base);
  for(const tab of [...projected.tabs,...projected.history.map(h=>h.tab)]) tab.options={...toolDefaults(tab.toolId),...tab.options};
  return projected;
}
export function historyBefore(entries: HistoryEntry[], cutoff: number, toolId?: string): HistoryEntry[] {
  return entries.filter(h=>h.at<cutoff && (!toolId||h.tab.toolId===toolId));
}
