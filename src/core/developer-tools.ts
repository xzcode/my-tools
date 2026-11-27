import { format } from 'sql-formatter';
import type { ToolRequest, ToolResult } from './types';
import { assertOutputLength, boundedInt, encoder, isRecord, jsonParse, jsonStringify, optionBool, optionText } from './shared';
import { bytesToHex, decodeBase64Bytes, decodeUtf8, encodeBase64Bytes } from './encoding';

export function processTimestamp(request: ToolRequest): ToolResult {
  let ms: number;
  let unitDescription = '';
  if (request.action === 'now') ms = Date.now();
  else if (request.action === 'to-timestamp') {
    const value = request.input.trim();
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const timestamp = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    const match = timestamp ?? dateOnly;
    if (!match) throw new Error('请使用带时区的 ISO 日期，如 2026-11-20T12:00:00+08:00；仅日期 YYYY-MM-DD 按 UTC 零点处理。');
    const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]! || (timestamp && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? 0) > 59))) throw new Error('日期不存在或时间超出范围。');
    ms = Date.parse(dateOnly ? `${value}T00:00:00Z` : value.replace(' ', 'T'));
    unitDescription = dateOnly ? '仅日期按 UTC 零点解释' : '已按输入中的时区解析';
  } else {
    const value = request.input.trim();
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) throw new Error('时间戳须为秒或毫秒数字。');
    let unit = optionText(request.options, 'unit');
    if (unit === 'auto') unit = value.replace(/^[+-]/, '').split('.')[0]!.length >= 11 ? 'milliseconds' : 'seconds';
    ms = Number(value) * (unit === 'seconds' ? 1000 : 1);
    unitDescription = `按${unit === 'seconds' ? '秒' : '毫秒'}处理`;
  }
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) throw new Error('时间超出支持范围。');
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new Error('无效日期或时区偏移。');
  const selected = optionText(request.options, 'timezone');
  const timeZone = selected === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : selected;
  const localized = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' }).format(date);
  return { output: `ISO 8601 (UTC): ${date.toISOString()}\n${timeZone}: ${localized}\nUnix 秒: ${Math.floor(date.getTime() / 1000)}\nUnix 毫秒: ${date.getTime()}`, summary: unitDescription || '当前系统时间' };
}

function requireCrypto(): Crypto {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto.subtle) throw new Error('当前环境未提供安全加密 API，请在桌面应用中使用。');
  return globalThis.crypto;
}
function randomString(length: number, alphabet: string): string {
  const source = requireCrypto();
  const limit = 256 - 256 % alphabet.length;
  const output: string[] = [];
  while (output.length < length) {
    const bytes = source.getRandomValues(new Uint8Array(Math.min(512, (length - output.length) * 2)));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      output.push(alphabet[byte % alphabet.length]!);
      if (output.length === length) break;
    }
  }
  return output.join('');
}
export function processUuid(request: ToolRequest): ToolResult {
  const count = boundedInt(request.options.count, 1, 1000, '数量');
  const length = boundedInt(request.options.length, 1, 256, '长度');
  const alphabet = ({ alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', hex: '0123456789abcdef', password: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}:,.?' })[optionText(request.options, 'alphabet')]!;
  const output: string[] = [];
  for (let i = 0; i < count; i++) {
    let result: string;
    if (request.action === 'uuid') {
      const bytes = requireCrypto().getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = bytesToHex(bytes);
      result = optionBool(request.options, 'hyphens') ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : hex;
    } else result = randomString(length, alphabet);
    output.push(optionBool(request.options, 'uppercase') ? result.toUpperCase() : result);
  }
  return { output: output.join('\n'), summary: `已使用加密随机源生成 ${count} 项` };
}

export async function processHash(request: ToolRequest): Promise<ToolResult> {
  const api = requireCrypto().subtle;
  const algorithm = optionText(request.options, 'algorithm');
  let buffer: ArrayBuffer;
  if (request.action === 'hmac') {
    const keyText = optionText(request.options, 'key');
    if (!keyText) throw new Error('请输入 HMAC 密钥。');
    const key = await api.importKey('raw', encoder.encode(keyText), { name: 'HMAC', hash: algorithm }, false, ['sign']);
    buffer = await api.sign('HMAC', key, encoder.encode(request.input));
  } else buffer = await api.digest(algorithm, encoder.encode(request.input));
  const bytes = new Uint8Array(buffer);
  return { output: optionText(request.options, 'output') === 'base64' ? encodeBase64Bytes(bytes) : bytesToHex(bytes), summary: `${request.action === 'hmac' ? 'HMAC-' : ''}${algorithm} · ${bytes.length * 8} bit` };
}

export function processJwt(request: ToolRequest): ToolResult {
  const token = request.input.trim().replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1]) throw new Error('JWT 应为 header.payload.signature 三段；不支持 JWE 加密令牌。');
  const header = jsonParse(decodeUtf8(decodeBase64Bytes(parts[0], true)));
  const payload = jsonParse(decodeUtf8(decodeBase64Bytes(parts[1], true)));
  if (!isRecord(header) || !isRecord(payload)) throw new Error('JWT Header 与 Payload 必须是 JSON 对象。');
  const times: Record<string, string> = Object.create(null);
  for (const key of ['iat', 'nbf', 'exp']) {
    if (!Object.hasOwn(payload, key)) continue;
    const numeric = Number(jsonStringify(payload[key], 0));
    if (Number.isFinite(numeric) && Math.abs(numeric) <= 8.64e12) times[key] = new Date(numeric * 1000).toISOString();
  }
  return { output: jsonStringify({ header, payload, signature: parts[2], claimTimesUTC: times, verified: false }), summary: '仅解码 · 未验证签名、发行方或有效期', warnings: ['解码成功不代表令牌可信；未进行任何签名验证。'], kind: 'json' };
}

export function processSql(request: ToolRequest): ToolResult {
  return { output: format(request.input, { language: optionText(request.options, 'dialect') as 'mysql' | 'postgresql' | 'sqlite' | 'sql' | 'tsql', keywordCase: optionText(request.options, 'keywordCase') as 'upper' | 'lower' | 'preserve', tabWidth: boundedInt(request.options.indent, 1, 8, '缩进') }), summary: 'SQL 格式化完成 · 未执行查询' };
}

export function processSqlIn(request: ToolRequest): ToolResult {
  const column = optionText(request.options, 'column').trim();
  if (!/^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*$/u.test(column)) throw new Error('字段名只能包含字母、数字、下划线或分隔表名的点。');
  let values = request.input.split(/\r\n|\n|\r/).map(value => value.trim()).filter(Boolean);
  if (optionBool(request.options, 'dedupe')) values = [...new Set(values)];
  if (!values.length) throw new Error('请输入至少一个值，避免生成无效的 IN ()。');
  if (optionText(request.options, 'valueType') === 'number') {
    if (values.some(value => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))) throw new Error('数字模式只能包含数值，不允许其他 SQL 片段。');
  } else values = values.map(value => {
    const escaped = optionText(request.options, 'dialect') === 'mysql' ? value.replace(/\\/g, '\\\\') : value;
    return `'${escaped.replace(/'/g, "''")}'`;
  });
  return { output: `${column} ${optionBool(request.options, 'not') ? 'NOT IN' : 'IN'} (${values.join(', ')})`, summary: `${values.length} 个值 · 仅生成 SQL 文本` };
}

export function processRegex(request: ToolRequest): ToolResult {
  const pattern = optionText(request.options, 'pattern');
  const flags = optionText(request.options, 'flags');
  if (!/^[gimsuyd]*$/.test(flags) || new Set(flags).size !== flags.length) throw new Error('标志仅支持不重复的 g i m s u y d。');
  let regex: RegExp;
  try { regex = new RegExp(pattern, flags); } catch (error) { throw new Error(`正则表达式无效：${error instanceof Error ? error.message : String(error)}`); }
  if (request.action === 'replace') {
    let total = 0; let lastEnd = 0;
    const replacement = optionText(request.options, 'replacement');
    const output = request.input.replace(regex, (matched: string, ...args: unknown[]) => {
      const hasGroups = typeof args[args.length - 1] === 'object';
      const captures = args.slice(0, hasGroups ? -3 : -2) as (string | undefined)[];
      const offset = args[args.length - (hasGroups ? 3 : 2)] as number;
      const groups = hasGroups ? args[args.length - 1] as Record<string, string | undefined> : undefined;
      total += offset - lastEnd;
      const chunks: string[] = []; let expandedLength = 0; let cursor = 0;
      const append = (value: string) => { expandedLength += value.length; assertOutputLength(total + expandedLength); chunks.push(value); };
      for (const token of replacement.matchAll(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/g)) {
        append(replacement.slice(cursor, token.index));
        const key = token[1]!;
        let value = token[0];
        if (key === '$') value = '$';
        else if (key === '&') value = matched;
        else if (key === '`') value = request.input.slice(0, offset);
        else if (key === "'") value = request.input.slice(offset + matched.length);
        else if (key[0] === '<' && groups) value = groups[key.slice(1, -1)] ?? '';
        else if (/^\d/.test(key)) {
          const group = Number(key);
          if (group > 0 && group <= captures.length) value = captures[group - 1] ?? '';
          else if (key.length === 2 && Number(key[0]) > 0 && Number(key[0]) <= captures.length) value = `${captures[Number(key[0]) - 1] ?? ''}${key[1]}`;
        }
        append(value); cursor = token.index! + token[0].length;
      }
      append(replacement.slice(cursor));
      total += expandedLength; lastEnd = offset + matched.length;
      return chunks.join('');
    });
    assertOutputLength(total + request.input.length - lastEnd);
    return { output, summary: '正则替换完成' };
  }
  const matches: { match: string; index: number; captures: (string | undefined)[]; groups?: Record<string, string>; indices?: RegExpIndicesArray }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(request.input)) !== null) {
    matches.push({ match: match[0], index: match.index, captures: match.slice(1), groups: match.groups, indices: match.indices });
    if (!regex.global) break;
    if (match[0] === '') {
      const index = regex.lastIndex;
      regex.lastIndex += regex.unicode && (request.input.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
    }
  }
  return { output: jsonStringify(matches), summary: `${matches.length} 个匹配 · 位置为 UTF-16 索引`, kind: 'json', stats: { '匹配数': matches.length } };
}
