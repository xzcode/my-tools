import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SESSION_MAX_BYTES, restoreUnifiedWorkspace, snapshotWorkspace } from '../core/workspace';

const DB_NAME = 'my-tools-aes-workspace-v1';
const STORE = 'vault';
const ID = 'workspace';
const AAD = new TextEncoder().encode('my-tools-aes-workspace-preview-v1');
type PreviewRecord = { mode: 'config'; json: string } |
  { mode: 'full'; key: CryptoKey; iv: Uint8Array<ArrayBuffer>; encrypted: ArrayBuffer };

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开浏览器预览的本地存档。'));
    request.onblocked = () => reject(new Error('浏览器预览存档被其他窗口占用。'));
  });
}
async function previewRead(): Promise<PreviewRecord | undefined> {
  const connection = await db();
  try {
    return await new Promise((resolve, reject) => {
      const tx = connection.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(ID);
      req.onsuccess = () => resolve(req.result as PreviewRecord | undefined);
      req.onerror = () => reject(new Error('浏览器预览读取失败。'));
    });
  } finally { connection.close(); }
}
async function previewWrite(record?: PreviewRecord): Promise<void> {
  const connection = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = connection.transaction(STORE, 'readwrite');
      if (record) tx.objectStore(STORE).put(record, ID);
      else tx.objectStore(STORE).delete(ID);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error('浏览器预览存档写入失败。'));
    });
  } finally { connection.close(); }
}
export async function loadAesWorkspace(): Promise<string | null> {
  if (isTauri()) return invoke<string | null>('load_aes_workspace');
  const record = await previewRead();
  if (!record) return null;
  if (record.mode === 'config') return record.json;
  if (record.mode !== 'full') throw new Error('浏览器预览的存档版本无效。');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv, additionalData: AAD }, record.key, record.encrypted);
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch { throw new Error('浏览器预览存档认证失败；原存档未被覆盖。'); }
}
export async function saveAesWorkspace(json: string): Promise<void> {
  if (new TextEncoder().encode(json).byteLength > SESSION_MAX_BYTES) throw new Error('工作台自动保存上限为 32 MiB，请减少保存内容。');
  if (isTauri()) return invoke<void>('save_aes_workspace', { data: json });
  // Browser preview is deliberately not represented as an OS-keychain vault.
  // Use a non-extractable Web Crypto key stored via structured clone in IDB.
  const state = restoreUnifiedWorkspace(json);
  if (state.mode !== 'full') {
    // Re-project in the browser so config-only records cannot contain secrets.
    await previewWrite({ mode: 'config', json: JSON.stringify(snapshotWorkspace(state)) });
    return;
  }
  const previous = await previewRead();
  const key = previous?.mode === 'full' ? previous.key : await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, new TextEncoder().encode(json));
  await previewWrite({ mode: 'full', key, iv, encrypted });
}
export async function clearAesWorkspace(): Promise<string | null> {
  if (isTauri()) return invoke<string | null>('clear_aes_workspace');
  await previewWrite();
  return null;
}
export async function registerAesExit(flush: (quit: boolean) => Promise<boolean>): Promise<() => void> {
  if (!isTauri()) {
    const handler = () => { if (document.visibilityState === 'hidden') void flush(false); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }
  const cleanup = await listen<boolean>('my-tools:flush-aes-workspace', async event => {
    let ok = false;
    try { ok = await flush(event.payload === true); } catch { /* UI reports the error. */ }
    if (event.payload === true) await invoke('finish_aes_workspace_exit', { proceed: ok });
  });
  try { await invoke('enable_aes_workspace_exit_guard'); } catch (e) { cleanup(); throw e; }
  return cleanup;
}

export async function exitWithoutSavingAesWorkspace(): Promise<void> {
  if (isTauri()) await invoke("finish_aes_workspace_exit", { proceed: true });
}
