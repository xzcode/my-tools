import type { ToolRequest, ToolResult } from './types';
import { encoder, isRecord, jsonParse, jsonStringify, optionBool, optionText } from './shared';

export function encodeBase64Bytes(bytes: Uint8Array, urlSafe = false, padding = true): string {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  let result = btoa(chunks.join(''));
  if (urlSafe) result = result.replace(/\+/g, '-').replace(/\//g, '_');
  return padding ? result : result.replace(/=+$/, '');
}

export function decodeBase64Bytes(input: string, urlSafe = false): Uint8Array {
  const text = input.replace(/[\t\r\n ]/g, '');
  const alphabet = urlSafe ? /^[A-Za-z0-9_-]*={0,2}$/ : /^[A-Za-z0-9+/]*={0,2}$/;
  if (!alphabet.test(text) || text.length % 4 === 1 || (text.includes('=') && text.length % 4 !== 0)) throw new Error('Base64 字符或填充无效，请检查 URL-safe 选项与末尾 =。');
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  let raw: string;
  try { raw = atob(normalized); } catch { throw new Error('Base64 无效，无法解码。'); }
  const result = Uint8Array.from(raw, character => character.charCodeAt(0));
  if (encodeBase64Bytes(result, urlSafe, false) !== text.replace(/=+$/, '')) throw new Error('Base64 末尾填充位无效。');
  return result;
}

export function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('结果不是有效的 UTF-8 文本，请选择十六进制输出或保存为二进制文件。'); }
}

export function hexToBytes(input: string): Uint8Array {
  const text = input.replace(/\s/g, '');
  if (text.length % 2 || !/^[\da-f]*$/i.test(text)) throw new Error('十六进制必须是完整的字节，例如 48 65 6c 6c 6f。');
  return Uint8Array.from(text.match(/.{2}/g) ?? [], byte => parseInt(byte, 16));
}
export function bytesToHex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }

export function processBase64(request: ToolRequest): ToolResult {
  if (request.action === 'encode') {
    const bytes = optionText(request.options, 'inputEncoding') === 'hex' ? hexToBytes(request.input) : encoder.encode(request.input);
    return { output: encodeBase64Bytes(bytes, optionBool(request.options, 'urlSafe'), optionBool(request.options, 'padding')), summary: `${bytes.length} 字节已编码` };
  }
  const bytes = decodeBase64Bytes(request.input, optionBool(request.options, 'urlSafe'));
  return { output: optionText(request.options, 'outputEncoding') === 'hex' ? bytesToHex(bytes) : decodeUtf8(bytes), summary: `${bytes.length} 字节已解码` };
}

export function processUrl(request: ToolRequest): ToolResult {
  const { input, action, options } = request;
  if (action === 'encode') return { output: optionText(options, 'mode') === 'uri' ? encodeURI(input) : encodeURIComponent(input), summary: '编码完成' };
  if (action === 'decode') {
    const value = optionBool(options, 'form') ? input.replace(/\+/g, ' ') : input;
    try { return { output: optionText(options, 'mode') === 'uri' ? decodeURI(value) : decodeURIComponent(value), summary: '解码完成' }; }
    catch { throw new Error('URL 百分号编码无效，或包含非法 UTF-8 字节。'); }
  }
  if (action === 'build') {
    const value = jsonParse(input);
    if (!isRecord(value)) throw new Error('构建查询参数需要 JSON 对象，例如 {"q":"你好","tag":["a","b"]}。');
    const params = new URLSearchParams();
    for (const [key, item] of Object.entries(value)) {
      for (const entry of Array.isArray(item) ? item : [item]) {
        if (isRecord(entry) || Array.isArray(entry)) throw new Error(`参数 ${key} 不支持嵌套对象或数组。`);
        params.append(key, entry === null ? '' : typeof entry === 'string' ? entry : jsonStringify(entry, 0));
      }
    }
    return { output: params.toString(), summary: `${[...params].length} 个查询参数` };
  }
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('请输入带协议的完整 URL，例如 https://example.com?a=1。'); }
  const params: Record<string, string[]> = Object.create(null);
  for (const [key, value] of url.searchParams) (params[key] ??= []).push(value);
  return { output: jsonStringify({ protocol: url.protocol, hostname: url.hostname, port: url.port, pathname: url.pathname, username: url.username, password: url.password, hash: url.hash, query: params }), summary: `${[...url.searchParams].length} 个参数 · 重复参数已保留`, kind: 'json' };
}
