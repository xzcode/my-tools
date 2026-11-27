import { defaultOptions, getTool } from './catalog';
import type { OptionValue, ToolResult } from './types';

export type SaveMode = 'off' | 'config' | 'full';
export type SecretField = 'key' | 'iv' | 'aad' | 'prefix' | 'input' | 'output';
export type SaveFields = Record<SecretField, boolean>;
export const OPEN_LIMIT = 16;
export const CLOSED_LIMIT = 10;
export const TEMPLATE_LIMIT = 30;
export const SESSION_MAX_BYTES = 4 * 1024 * 1024;

export interface AesTab {
  id: string; name: string; action: string; input: string;
  options: Record<string, OptionValue>; result: ToolResult | null;
  error: string; stale: boolean; elapsed: number;
  outputView: 'text' | 'tree' | 'diff';
}
export interface AesTemplate {
  id: string; name: string; options: Record<string, OptionValue>;
}
export interface AesWorkspace {
  version: 1; mode: SaveMode; fields: SaveFields;
  tabs: AesTab[]; closed: AesTab[]; activeId: string;
  templates: AesTemplate[];
}
const tool = getTool('aes')!;
const configKeys = ['profile', 'cipherMode', 'keySize', 'keyEncoding', 'ivEncoding',
  'dataEncoding', 'cipherEncoding', 'padding', 'tagLength', 'tagFormat', 'aadEncoding'] as const;
export function aesDefaults() { return defaultOptions(tool); }
export function configOptions(options: Record<string, OptionValue>): Record<string, OptionValue> {
  return Object.fromEntries(configKeys.map(key => [key, options[key] ?? aesDefaults()[key]!]));
}
function identifier() { return globalThis.crypto.randomUUID(); }
export function newTab(name = 'AES 1', options = aesDefaults()): AesTab {
  return { id: identifier(), name, action: 'encrypt', input: '', options: { ...options },
    result: null, error: '', stale: false, elapsed: 0, outputView: 'text' };
}
export function initialWorkspace(): AesWorkspace {
  const tab = newTab();
  return { version: 1, mode: 'config', fields: { key: true, iv: true, aad: true, prefix: true, input: true, output: true },
    tabs: [tab], closed: [], activeId: tab.id, templates: [] };
}
export const builtInTemplates: AesTemplate[] = [
  { id: 'java256', name: 'Java AES-256 ECB', options: { ...configOptions(aesDefaults()), profile: 'advanced', cipherMode: 'ECB', keySize: '256', keyEncoding: 'utf8', padding: 'pkcs7', dataEncoding: 'utf8', cipherEncoding: 'base64' } },
  { id: 'java128', name: 'Java AES-128 ECB', options: { ...configOptions(aesDefaults()), profile: 'advanced', cipherMode: 'ECB', keySize: '128', keyEncoding: 'utf8', padding: 'pkcs7', dataEncoding: 'utf8', cipherEncoding: 'base64' } },
  { id: 'javaCBC', name: 'Java AES CBC', options: { ...configOptions(aesDefaults()), profile: 'advanced', cipherMode: 'CBC', keyEncoding: 'utf8', ivEncoding: 'utf8', padding: 'pkcs7' } },
  { id: 'gcm256', name: 'AES-256 GCM', options: { ...configOptions(aesDefaults()), profile: 'advanced', cipherMode: 'GCM', keySize: '256', tagLength: '128' } },
];
export function copyConfig(tab: AesTab): AesTab {
  return newTab(tab.name + ' 副本', { ...aesDefaults(), ...configOptions(tab.options) });
}
export function snapshotWorkspace(workspace: AesWorkspace): AesWorkspace {
  const mode = workspace.mode;
  const fields = workspace.fields;
  const full = mode === 'full';
  function saveTab(tab: AesTab): AesTab {
    const opts = { ...aesDefaults(), ...configOptions(tab.options) };
    if (full) {
      if (fields.key) { opts.password = tab.options.password ?? ''; opts.rawKey = tab.options.rawKey ?? ''; }
      if (fields.iv) opts.iv = tab.options.iv ?? '';
      if (fields.aad) opts.aad = tab.options.aad ?? '';
      if (fields.prefix) opts.prefix = tab.options.prefix ?? '';
    }
    return { id: tab.id, name: tab.name, action: tab.action, options: opts,
      input: full && fields.input ? tab.input : '',
      result: full && fields.output && tab.result ? JSON.parse(JSON.stringify(tab.result)) as ToolResult : null,
      error: '', stale: !!(full && fields.output && tab.result) && (tab.stale || !fields.input || !fields.key || !fields.iv || !fields.aad || !fields.prefix),
      elapsed: 0, outputView: 'text' };
  }
  if (mode === 'off') return { version: 1, mode, fields: { ...fields }, tabs: [], closed: [], activeId: '', templates: [] };
  return { version: 1, mode, fields: { ...fields },
    tabs: workspace.tabs.slice(0, OPEN_LIMIT).map(saveTab),
    closed: workspace.closed.slice(0, CLOSED_LIMIT).map(saveTab), activeId: workspace.activeId,
    templates: workspace.templates.slice(0, TEMPLATE_LIMIT).map(t => ({ id: t.id, name: t.name, options: configOptions(t.options) })) };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AES 工作台存档结构无效。');
  return value as Record<string, unknown>;
}
function str(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('AES 存档字段无效：' + label);
  return value;
}
function id(value: unknown): string {
  const s = str(value, 100, 'ID');
  if (!/^[a-zA-Z0-9-]+$/.test(s)) throw new Error('AES 存档 ID 无效。');
  return s;
}
function normalizeOptions(value: unknown): Record<string, OptionValue> {
  const input = record(value), defaults = aesDefaults();
  for (const option of tool.options) {
    const v = input[option.key] ?? option.defaultValue;
    if (typeof v !== 'string' || v.length > (option.key === 'prefix' ? 4096 : 65536)) throw new Error('AES 存档选项无效。');
    if (option.type === 'select' && !option.choices?.some(c => c.value === v)) throw new Error('AES 存档选项无效。');
    defaults[option.key] = v;
  }
  return defaults;
}
export function restoreWorkspace(json: string): AesWorkspace {
  if (new TextEncoder().encode(json).byteLength > SESSION_MAX_BYTES) throw new Error('AES 工作台存档超过 4 MiB。');
  const value = record(JSON.parse(json));
  if (value.version !== 1 || !['off', 'config', 'full'].includes(String(value.mode))) throw new Error('AES 工作台存档版本不受支持。');
  const base = initialWorkspace();
  const fields = record(value.fields);
  for (const key of Object.keys(base.fields) as SecretField[]) {
    if (typeof fields[key] !== 'boolean') throw new Error('AES 存档保存选项无效。');
    base.fields[key] = fields[key] as boolean;
  }
  base.mode = value.mode as SaveMode;
  if (base.mode === 'off') return base;
  function readTab(v: unknown): AesTab {
    const t = record(v), action = str(t.action, 10, 'action');
    if (action !== 'encrypt' && action !== 'decrypt') throw new Error('AES 存档操作无效。');
    const r = t.result == null ? null : record(t.result);
    let result: ToolResult | null = null;
    if (r) {
      result = { output: str(r.output, SESSION_MAX_BYTES, 'output') };
      if (typeof r.summary === 'string') result.summary = r.summary.slice(0, 2000);
      if (r.kind === 'json' || r.kind === 'text') result.kind = r.kind;
      if (Array.isArray(r.warnings)) result.warnings = r.warnings.filter((x): x is string => typeof x === 'string').slice(0, 10).map(x => x.slice(0, 2000));
    }
    return { id: id(t.id), name: str(t.name, 100, 'name'), action, options: normalizeOptions(t.options),
      input: str(t.input, SESSION_MAX_BYTES, 'input'), result, error: '', stale: t.stale === true, elapsed: 0, outputView: 'text' };
  }
  if (!Array.isArray(value.tabs) || value.tabs.length > OPEN_LIMIT || !Array.isArray(value.closed) || value.closed.length > CLOSED_LIMIT || !Array.isArray(value.templates) || value.templates.length > TEMPLATE_LIMIT) throw new Error('AES 存档标签数量无效。');
  base.tabs = value.tabs.map(readTab);
  base.closed = value.closed.map(readTab);
  const ids = [...base.tabs, ...base.closed].map(t => t.id);
  if (new Set(ids).size !== ids.length) throw new Error('AES 存档标签重复。');
  if (!base.tabs.length) base.tabs = [newTab()];
  base.activeId = base.tabs.some(t => t.id === value.activeId) ? String(value.activeId) : base.tabs[0]!.id;
  base.templates = value.templates.map(v => {
    const t = record(v);
    return { id: id(t.id), name: str(t.name, 100, 'name'), options: configOptions(normalizeOptions(t.options)) };
  });
  // Re-apply the stored policy so even an unexpected config document cannot
  // restore secret fields in metadata-only mode.
  return snapshotWorkspace(base);
}
