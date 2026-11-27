import { defaultOptions, getTool } from './catalog';
import type { ToolResult } from './types';
import { initialWorkspace as oldInitial, restoreWorkspace as restoreLegacy, builtInTemplates } from './aes-workspace';
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
export function tabName(id: string, n: number) { return id === 'aes' ? 'AES ' + n : getTool(id)!.name + ' ' + n; }
export function newToolTab(toolId: string, name = tabName(toolId, 1), options = toolDefaults(toolId)): ToolTab {
  return { id: crypto.randomUUID(), toolId, name, action: getTool(toolId)!.defaultAction, input: '', secondaryInput: '',
    options: { ...options }, result: null, error: '', stale: false, elapsed: 0, outputView: 'text',
    fileName: '', binarySourceName: '', batch: [], batchVisible: false };
}
export function newWorkspace(): Workspace {
  const tab = newToolTab('json');
  return { version: 2, mode: 'full', fields: oldInitial().fields, tabs: [tab], activeIds: { json: tab.id }, history: [], templates: [] };
}
export function duplicateTab(tab: ToolTab): ToolTab {
  return { ...snapshotTab(tab), id: crypto.randomUUID(), name: (tab.name + ' 副本').slice(0,100) };
}
function snapshotTab(tab: ToolTab): ToolTab {
  const saved = clone(tab);
  saved.batch = saved.batch.map(b => ({ ...b, state: b.state === 'running' ? 'waiting' : b.state }));
  return saved;
}
export function snapshotWorkspace(state: Workspace): Workspace {
  // Old mode and fields remain on disk only for v1/v2 compatibility.
  // Current workspaces always preserve complete local snapshots.
  return { version: 2, mode: 'full', fields: oldInitial().fields,
    tabs: state.tabs.map(snapshotTab), activeIds: { ...state.activeIds },
    history: state.history.map(h => ({ ...h, tab: snapshotTab(h.tab) })),
    templates: state.templates.map(t => clone(t)) };
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
    if (option.type === 'select' && typeof v === 'string') out[option.key] = v;
    else if (option.type === 'checkbox' && typeof v === 'boolean') out[option.key] = v;
    else if (option.type === 'number' && ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string')) out[option.key] = v;
    else if ((option.type === 'text' || option.type === 'textarea') && typeof v === 'string') out[option.key] = v;
    else throw Error('工作台存档选项无效：' + option.label);
  }
  return out;
}
function resultFor(value: unknown): ToolResult | null {
  if (value == null) return null;
  const r = record(value), result: ToolResult = { output: string(r.output) };
  if (typeof r.summary === 'string') result.summary = r.summary;
  if (['text','json','diff'].includes(String(r.kind))) result.kind = r.kind as ToolResult['kind'];
  if (Array.isArray(r.warnings)) result.warnings = r.warnings.filter((x): x is string => typeof x === 'string');
  if (Array.isArray(r.diff)) result.diff = r.diff.map(v => { const d=record(v); if (!['equal','add','remove'].includes(String(d.type))) throw Error('差异存档无效'); return { type: d.type as 'equal'|'add'|'remove', text: string(d.text) }; });
  if (r.stats && typeof r.stats === 'object' && !Array.isArray(r.stats)) result.stats = Object.fromEntries(Object.entries(r.stats).filter(([,v])=>typeof v==='string'||typeof v==='number')) as Record<string,string|number>;
  return result;
}
function readTab(value: unknown): ToolTab {
  const t = record(value), toolId = string(t.toolId,80), tool = getTool(toolId);
  if (!tool || !tool.actions.some(a => a.id === t.action)) throw Error('工作台工具或操作无效。');
  const batch = Array.isArray(t.batch) ? t.batch.map(v => {
    const b=record(v);
    return { name:string(b.name,512), input:string(b.input), output:typeof b.output==='string'?b.output:undefined, error:typeof b.error==='string'?b.error:undefined,
      state: (b.state==='done'||b.state==='error'?b.state:'waiting') as BatchItem['state'] };
  }) : [];
  return { id:id(t.id), toolId, name:string(t.name,100), action:string(t.action,80), input:string(t.input), secondaryInput:string(t.secondaryInput??''),
    options:optionsFor(toolId,t.options), result:resultFor(t.result), error:typeof t.error==='string'?t.error:'', stale:t.stale===true, elapsed:typeof t.elapsed==='number'&&Number.isFinite(t.elapsed)?t.elapsed:0, outputView:t.outputView==='tree'||t.outputView==='diff'?t.outputView:'text',
    fileName:string(t.fileName??'',512), binarySourceName:string(t.binarySourceName??'',512), batch, batchVisible:t.batchVisible===true };
}
export function restoreUnifiedWorkspace(json: string): Workspace {
  const obj = record(JSON.parse(json));
  if (obj.version === 1) {
    const old = restoreLegacy(json), base = newWorkspace();
    const convert = (t: AesTab): ToolTab => ({ ...newToolTab('aes'), ...clone(t), toolId:'aes' });
    base.templates = old.templates;
    if (old.mode !== 'off') {
      base.tabs.push(...old.tabs.map(convert));
      if (old.tabs.length) base.activeIds.aes = old.activeId;
      base.history = old.closed.map((t,i) => ({ id:crypto.randomUUID(), at:Date.now()-i, type:'closed', tab:convert(t) }));
    }
    return base;
  }
  if (obj.version !== 2 || !['off','config','full'].includes(String(obj.mode))) throw Error('工作台存档版本不受支持。');
  const base = newWorkspace();
  // Preserve every value that exists in legacy snapshots.
  // Fields omitted by older versions cannot be reconstructed.
  if (obj.mode === 'off') return base;
  if (!Array.isArray(obj.tabs) || !Array.isArray(obj.history) || !Array.isArray(obj.templates)) throw Error('工作台存档数量无效。');
  base.tabs = obj.tabs.map(readTab);
  if (new Set(base.tabs.map(t=>t.id)).size !== base.tabs.length) throw Error('工作台标签重复。');
  base.activeIds = {};
  const ids = record(obj.activeIds);
  for (const t of base.tabs) if (!base.activeIds[t.toolId] || ids[t.toolId] === t.id) base.activeIds[t.toolId] = t.id;
  base.history = obj.history.map(value => { const h=record(value); if (!['closed','run'].includes(String(h.type))||typeof h.at!=='number'||!Number.isFinite(h.at)||h.at<0) throw Error('历史记录无效。');
    return { id:id(h.id), at:h.at, type:h.type as HistoryEntry['type'], tab:readTab(h.tab) }; }).sort((a,b)=>b.at-a.at);
  if (new Set(base.history.map(h=>h.id)).size!==base.history.length) throw Error('历史记录重复。');
  base.templates = obj.templates.map(value=>{const t=record(value);return {id:id(t.id),name:string(t.name,100),options:optionsFor('aes',t.options)};});
  return base;
}
export function historyBefore(entries: HistoryEntry[], cutoff: number, toolId?: string): HistoryEntry[] {
  return entries.filter(h=>h.at<cutoff && (!toolId||h.tab.toolId===toolId));
}
