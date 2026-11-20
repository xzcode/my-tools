import type { ToolRequest, ToolResult } from './types';
import { jsonStringify } from './shared';

/** Small POSIX token reader. It never evaluates, expands, executes or fetches input. */
export function tokenizeCurl(input: string): string[] {
  const tokens: string[] = [];
  let token = ''; let quote: "'" | '"' | null = null; let started = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;
    if (quote === "'") {
      if (char === "'") quote = null; else token += char;
      continue;
    }
    if (char === '\\') {
      const next = input[index + 1];
      if (next === undefined) throw new Error('cURL 命令以不完整的转义符结尾。');
      if (next === '\n') { index++; continue; }
      if (next === '\r' && input[index + 2] === '\n') { index += 2; continue; }
      if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) token += '\\';
      token += next; index++; started = true; continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else {
        if (char === '$' || char === '`') throw new Error('不展开 shell 变量或命令替换，请改为字面值。');
        token += char;
      }
      continue;
    }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (/\s/.test(char)) {
      if (started) { tokens.push(token); token = ''; started = false; }
      continue;
    }
    if ([';', '|', '&', '>', '<', '`', '$', '(', ')'].includes(char)) throw new Error('只接受一条 cURL 命令，不支持管道、重定向、变量或 shell 运算符；URL 请加引号。');
    token += char; started = true;
  }
  if (quote) throw new Error('cURL 引号未闭合。');
  if (started) tokens.push(token);
  return tokens;
}

export function processCurl(request: ToolRequest): ToolResult {
  const tokens = tokenizeCurl(request.input);
  if (!tokens.length || !/^(?:curl|curl\.exe)$/.test(tokens[0]!)) throw new Error('命令须以 curl 开头。当前支持 POSIX 引号语法。');
  let url = ''; let method: string | undefined; let head = false; let useGet = false;
  const headers: { name: string; value: string }[] = [];
  const bodies: { kind: string; value: string }[] = [];
  const options: Record<string, string | boolean> = Object.create(null);
  const warnings = ['仅解析命令文本：未发起网络请求，也不会读取 @文件。'];
  const needValue = (index: number, name: string) => {
    const value = tokens[index];
    if (value === undefined) throw new Error(`${name} 缺少参数。`);
    return value;
  };
  const setUrl = (value: string) => {
    if (url) throw new Error('一次仅支持解析一个 URL。');
    url = value;
  };
  const valueFlags = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--json', '-F', '--form', '--form-string', '--url', '-u', '--user', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-o', '--output', '--connect-timeout', '--max-time', '--compressed']);
  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === '--') {
      if (index + 2 !== tokens.length) throw new Error('-- 后只支持一个 URL。');
      setUrl(needValue(index + 1, '--')); break;
    }
    if (!token.startsWith('-')) { setUrl(token); continue; }
    if (['-I', '--head'].includes(token)) { head = true; continue; }
    if (['-G', '--get'].includes(token)) { useGet = true; continue; }
    if (['-L', '--location', '-k', '--insecure', '-s', '--silent', '-S', '--show-error', '-v', '--verbose', '--compressed', '--globoff', '-g', '--fail', '-f'].includes(token)) { options[token] = true; continue; }
    const equal = token.startsWith('--') ? token.indexOf('=') : -1;
    let flag = equal > 0 ? token.slice(0, equal) : token;
    let value: string;
    if (equal > 0) value = token.slice(equal + 1);
    else if (token.length > 2 && /^-[XHduAeboF]/.test(token)) { flag = token.slice(0, 2); value = token.slice(2); }
    else { value = needValue(++index, flag); }
    if (!valueFlags.has(flag)) throw new Error(`暂不支持 cURL 选项 ${flag}；请移除此选项后解析，避免生成错误的请求。`);
    if (['-X', '--request'].includes(flag)) {
      if (!/^[A-Za-z]+$/.test(value)) throw new Error('HTTP 方法只能包含字母。');
      method = value.toUpperCase();
    } else if (['-H', '--header'].includes(flag)) {
      const separator = value.indexOf(':');
      if (separator <= 0) throw new Error('Header 需要 Name: Value 格式。');
      headers.push({ name: value.slice(0, separator).trim(), value: value.slice(separator + 1).trim() });
    } else if (flag === '--url') setUrl(value);
    else if (['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--json', '-F', '--form', '--form-string'].includes(flag)) bodies.push({ kind: flag, value });
    else options[flag] = value;
  }
  if (!url) throw new Error('未找到 URL。');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('请输入完整的 http:// 或 https:// URL。'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只支持解析 HTTP / HTTPS 请求。');
  const query: { name: string; value: string }[] = [...parsed.searchParams].map(([name, value]) => ({ name, value }));
  if (useGet && bodies.length) warnings.push('-G 会把 data 加入查询参数；下方 body 保存原始参数，请按各 data 类型确认编码。');
  if (bodies.some(item => item.kind === '--json')) {
    if (!headers.some(item => item.name.toLowerCase() === 'content-type')) headers.push({ name: 'Content-Type', value: 'application/json' });
    if (!headers.some(item => item.name.toLowerCase() === 'accept')) headers.push({ name: 'Accept', value: 'application/json' });
  }
  if (head && bodies.length && !useGet) warnings.push('命令同时包含 HEAD 与请求数据，请检查原始请求的意图。');
  return { output: jsonStringify({ method: method ?? (head ? 'HEAD' : useGet ? 'GET' : bodies.length ? 'POST' : 'GET'), url, query, headers, body: bodies, options, sendsRequest: false }), summary: '请求结构已解析 · 未执行', warnings, kind: 'json' };
}
