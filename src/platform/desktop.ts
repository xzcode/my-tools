import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export interface DesktopPreferences {
  theme: 'system' | 'light' | 'dark';
  favorites: string[];
  recent: string[];
  shortcut: string;
  closeToTray: boolean;
  lastTool: string;
}

export interface ImportedFile { name: string; content: string; path?: string }
export interface ExportFile { name: string; content: string }
export interface BinaryFile { name: string; bytes: number[] }
export interface DesktopStatus {
  version: string;
  platform: string;
  shortcut: string;
  shortcutError: string | null;
  trayAvailable: boolean;
  updaterEnabled: boolean;
}
export interface UpdateStatus { available: boolean; version?: string | null; notes?: string | null; message: string }

export const defaultPreferences: DesktopPreferences = {
  theme: 'system', favorites: [], recent: [], shortcut: 'CmdOrCtrl+Shift+Space', closeToTray: true, lastTool: 'json',
};
const PREFERENCES_KEY = 'my-tools.preferences.v1';
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20;
const encoder = new TextEncoder();
const preferenceKeys = ['theme', 'favorites', 'recent', 'shortcut', 'closeToTray', 'lastTool'];

export function isDesktop(): boolean { return isTauri(); }

function cloneDefaults(): DesktopPreferences {
  return { ...defaultPreferences, favorites: [], recent: [] };
}

function validatePreferences(value: unknown): DesktopPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('偏好设置无效');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !preferenceKeys.includes(key))) throw new Error('只允许保存工具偏好，不能保存处理内容');
  const id = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9-]{1,64}$/.test(s);
  if (!['system', 'light', 'dark'].includes(String(record.theme))
    || typeof record.closeToTray !== 'boolean'
    || typeof record.shortcut !== 'string' || record.shortcut.length > 128 || /[\u0000-\u001f]/.test(record.shortcut)
    || !id(record.lastTool)
    || !Array.isArray(record.favorites) || record.favorites.length > 100 || !record.favorites.every(id)
    || !Array.isArray(record.recent) || record.recent.length > 20 || !record.recent.every(id)) throw new Error('偏好设置格式无效');
  return {
    theme: record.theme as DesktopPreferences['theme'],
    favorites: [...new Set(record.favorites as string[])], recent: [...new Set(record.recent as string[])],
    shortcut: record.shortcut.trim(), closeToTray: record.closeToTray, lastTool: record.lastTool,
  };
}

export async function loadPreferences(): Promise<DesktopPreferences> {
  if (isDesktop()) return invoke<DesktopPreferences>('load_preferences');
  try {
    const text = localStorage.getItem(PREFERENCES_KEY);
    return text ? validatePreferences(JSON.parse(text)) : cloneDefaults();
  } catch { return cloneDefaults(); }
}

export async function savePreferences(preferences: DesktopPreferences): Promise<DesktopPreferences> {
  const validated = validatePreferences(preferences);
  if (isDesktop()) return invoke<DesktopPreferences>('save_preferences', { preferences: validated });
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(validated));
  window.dispatchEvent(new CustomEvent('my-tools:preferences-changed', { detail: validated }));
  return validated;
}

function checkSize(text: string, limit: number): void {
  if (encoder.encode(text).length > limit) throw new Error(`内容不能超过 ${limit / 1024 / 1024} MiB`);
}

export async function readClipboard(): Promise<string> {
  if (isDesktop()) return invoke<string>('read_clipboard');
  if (!navigator.clipboard?.readText) throw new Error('当前浏览器不能读取剪贴板，请手动粘贴');
  const text = await navigator.clipboard.readText();
  checkSize(text, MAX_INPUT_BYTES);
  return text;
}

export async function writeClipboard(text: string): Promise<void> {
  checkSize(text, MAX_BATCH_BYTES);
  if (isDesktop()) return invoke<void>('write_clipboard', { text });
  if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不能访问剪贴板，请手动复制');
  await navigator.clipboard.writeText(text);
}

export async function readBrowserFiles(files: File[]): Promise<ImportedFile[]> {
  if (files.length > MAX_FILES) throw new Error('一次最多导入 20 个文件');
  if (files.some(file => file.size > MAX_INPUT_BYTES) || files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) {
    throw new Error('单文件上限 5 MiB，一批文件总量上限 20 MiB');
  }
  return Promise.all(files.map(async file => {
    try { return { name: file.name, content: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) }; }
    catch { throw new Error(`${file.name} 不是有效的 UTF-8 文本，请先转换文件编码`); }
  }));
}

export async function openTextFiles(multiple = false): Promise<ImportedFile[]> {
  if (isDesktop()) return invoke<ImportedFile[]>('open_text_files', { multiple });
  return new Promise<ImportedFile[]>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.hidden = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      readBrowserFiles(files).then(resolve, reject);
    };
    input.addEventListener('cancel', () => { input.remove(); resolve([]); }, { once: true });
    document.body.append(input);
    input.click();
  });
}

export async function readDroppedFiles(paths: string[]): Promise<ImportedFile[]> {
  if (!isDesktop()) throw new Error('浏览器预览只能读取拖放事件中的文件对象');
  return invoke<ImportedFile[]>('read_dropped_files', { paths });
}

export async function openBinaryFile(kind?: 'svga'): Promise<BinaryFile | null> {
  if (isDesktop()) return invoke<BinaryFile | null>('open_binary_file', { kind: kind ?? null });
  return new Promise<BinaryFile | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (kind === 'svga') input.accept = '.svga';
    input.hidden = true;
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) { resolve(null); return; }
      if (file.size > MAX_INPUT_BYTES) { reject(new Error('单个文件不能超过 5 MiB')); return; }
      try { resolve({ name: file.name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) }); }
      catch (error) { reject(error); }
    };
    input.addEventListener('cancel', () => { input.remove(); resolve(null); }, { once: true });
    document.body.append(input);
    input.click();
  });
}

export async function saveBinaryFile(bytes: number[], name = 'decoded.bin'): Promise<boolean> {
  validateName(name);
  if (bytes.length > MAX_INPUT_BYTES) throw new Error('二进制文件不能超过 5 MiB');
  if (bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error('二进制内容包含无效字节');
  if (isDesktop()) return invoke<boolean>('save_binary_file', { bytes, name });
  download(new Blob([Uint8Array.from(bytes)], { type: 'application/octet-stream' }), name);
  return true;
}

function validateName(name: string): void {
  const stem = name.split('.')[0]?.toUpperCase() ?? '';
  if (!name || encoder.encode(name).length > 180 || name === '.' || name === '..' || /[\u0000-\u001f<>:"/\\|?*]/.test(name)
    || /[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) throw new Error('导出文件名包含不支持的字符');
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function saveTextFile(content: string, name = 'output.txt'): Promise<boolean> {
  validateName(name);
  checkSize(content, MAX_BATCH_BYTES);
  if (isDesktop()) return invoke<boolean>('save_text_file', { content, name });
  download(new Blob([content], { type: 'text/plain;charset=utf-8' }), name);
  return true;
}

// Store-only ZIP for browser previews. Keeps a batch in one download with UTF-8 names.
function makeZip(files: ExportFile[]): Blob {
  const parts: ArrayBuffer[] = [];
  const directory: ArrayBuffer[] = [];
  let offset = 0;
  const crc32 = (bytes: Uint8Array) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new ArrayBuffer(30 + name.length);
    const l = new DataView(local);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
    l.setUint16(12, 33, true); l.setUint32(14, crc, true); l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true); l.setUint16(26, name.length, true);
    new Uint8Array(local).set(name, 30);
    const central = new ArrayBuffer(46 + name.length);
    const c = new DataView(central);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(14, 33, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    new Uint8Array(central).set(name, 46);
    parts.push(local, data.buffer as ArrayBuffer);
    directory.push(central);
    offset += local.byteLength + data.length;
  }
  const end = new ArrayBuffer(22);
  const e = new DataView(end);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, directory.reduce((sum, item) => sum + item.byteLength, 0), true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}

export async function saveBatchFiles(files: ExportFile[]): Promise<number> {
  if (!files.length || files.length > MAX_FILES) throw new Error('一次只能导出 1–20 个文件');
  const names = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    validateName(file.name);
    if (names.has(file.name.toLowerCase())) throw new Error('批量导出文件名重复');
    names.add(file.name.toLowerCase());
    bytes += encoder.encode(file.content).length;
  }
  if (bytes > MAX_BATCH_BYTES) throw new Error('批量导出总量不能超过 20 MiB');
  if (isDesktop()) return invoke<number>('save_batch_files', { files });
  download(makeZip(files), 'my-tools-results.zip');
  return files.length;
}

export async function showMainWindow(toolId?: string): Promise<void> {
  if (isDesktop()) return invoke<void>('show_main_window', { toolId: toolId ?? null });
  const url = new URL(location.href);
  if (url.searchParams.get('window') === 'launcher') {
    url.searchParams.delete('window');
    if (toolId) url.hash = `/tools/${encodeURIComponent(toolId)}`;
    else if (!url.hash) url.hash = '/tools/json';
    location.assign(url.toString());
    return;
  }
  if (toolId) location.hash = `/tools/${encodeURIComponent(toolId)}`;
  window.dispatchEvent(new CustomEvent('my-tools:open-tool', { detail: toolId }));
}

export async function showLauncher(): Promise<void> {
  if (isDesktop()) return invoke<void>('show_launcher');
  window.dispatchEvent(new CustomEvent('my-tools:show-launcher'));
}

export async function hideCurrentWindow(): Promise<void> {
  if (isDesktop()) return invoke<void>('hide_current_window');
  if (new URL(location.href).searchParams.get('window') === 'launcher') return showMainWindow();
  window.dispatchEvent(new CustomEvent('my-tools:hide-launcher'));
}

export async function onOpenTool(handler: (toolId: string) => void): Promise<UnlistenFn> {
  if (isDesktop()) return getCurrentWebviewWindow().listen<string>('my-tools:open-tool', event => handler(event.payload));
  const callback = (event: Event) => {
    const id = (event as CustomEvent<string | undefined>).detail;
    if (id) handler(id);
  };
  window.addEventListener('my-tools:open-tool', callback);
  return () => window.removeEventListener('my-tools:open-tool', callback);
}

export async function readDroppedBinaryFile(path: string): Promise<BinaryFile> {
  if (!isDesktop()) throw new Error('只能读取刚刚拖入当前窗口的文件。');
  return invoke<BinaryFile>('read_dropped_binary_file', { path });
}
export async function onRawFileDrop(handler: (paths: string[]) => void): Promise<UnlistenFn> {
  if (!isDesktop()) return () => {};
  return getCurrentWebviewWindow().listen<string[]>('my-tools:files-dropped', event => handler(event.payload));
}
export async function onFileDrop(handler: (files: ImportedFile[]) => void, onError?: (message: string) => void): Promise<UnlistenFn> {
  if (!isDesktop()) return () => {};
  return getCurrentWebviewWindow().listen<string[]>('my-tools:files-dropped', async event => {
    try { handler(await readDroppedFiles(event.payload)); }
    catch (error) { onError?.(error instanceof Error ? error.message : String(error)); }
  });
}

export async function onPreferencesChanged(handler: (preferences: DesktopPreferences) => void): Promise<UnlistenFn> {
  if (isDesktop()) return listen<DesktopPreferences>('my-tools:preferences-changed', event => handler(event.payload));
  const callback = (event: Event) => handler((event as CustomEvent<DesktopPreferences>).detail);
  const storage = (event: StorageEvent) => {
    if (event.key === PREFERENCES_KEY && event.newValue) {
      try { handler(validatePreferences(JSON.parse(event.newValue))); } catch { /* Ignore invalid external storage. */ }
    }
  };
  window.addEventListener('my-tools:preferences-changed', callback);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener('my-tools:preferences-changed', callback);
    window.removeEventListener('storage', storage);
  };
}

export async function getDesktopStatus(): Promise<DesktopStatus> {
  if (isDesktop()) return invoke<DesktopStatus>('get_desktop_status');
  return { version: '0.6.1', platform: 'browser', shortcut: '', shortcutError: null, trayAvailable: false, updaterEnabled: false };
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (isDesktop()) return invoke<UpdateStatus>('check_for_updates');
  return { available: false, message: '网页预览不支持桌面应用更新' };
}

export async function installUpdate(): Promise<void> {
  if (isDesktop()) return invoke<void>('install_update');
  throw new Error('请在桌面应用中安装更新');
}

export async function onLauncherShown(handler: () => void): Promise<UnlistenFn> {
  if (isDesktop()) return getCurrentWebviewWindow().listen('my-tools:launcher-shown', handler);
  window.addEventListener('my-tools:show-launcher', handler);
  return () => window.removeEventListener('my-tools:show-launcher', handler);
}

/** Only the native dialog can change the persistent root directory. */
export async function getKeyDirectory(): Promise<string> {
  return isDesktop() ? invoke<string>('get_key_directory') : '桌面应用默认：Documents/My Tools/Keys';
}
export async function chooseKeyDirectory(): Promise<string | null> {
  if (!isDesktop()) throw new Error('默认目录只能在桌面应用中修改。');
  return invoke<string | null>('choose_key_directory');
}
export async function saveNamedKeyBundle(name: string, algorithm: string, files: { name: string; bytes: number[] }[]): Promise<string> {
  if (!isDesktop()) throw new Error('命名目录保存需要桌面应用。');
  return invoke<string>('save_key_bundle', { name, algorithm, files });
}
export async function openKeyDirectory(): Promise<void> {
  if (!isDesktop()) throw new Error('目录打开需要桌面应用。');
  return invoke<void>('open_key_directory');
}
