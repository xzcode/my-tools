import { isLosslessNumber } from 'lossless-json';
import type { ToolRequest, ToolResult } from './types';
import { assertDepth, assertOutputLength, isRecord, jsonParse, jsonStringify, optionText, sortedJson } from './shared';

function parsePath(path: string): string[] {
  if (path === '' || path === '$') return [];
  if (path.startsWith('/')) return path.slice(1).split('/').map(part => {
    if (/~[^01]|~$/.test(part)) throw new Error('JSON Pointer 只允许 ~0 与 ~1 转义。');
    return part.replace(/~1/g, '/').replace(/~0/g, '~');
  });
  const parts: string[] = [];
  let rest = path.startsWith('$') ? path.slice(1) : `.${path}`;
  while (rest) {
    const dot = /^\.([^.[\]]+)/.exec(rest);
    if (dot) { parts.push(dot[1]!); rest = rest.slice(dot[0].length); continue; }
    const index = /^\[(0|[1-9]\d*)\]/.exec(rest);
    if (index) { parts.push(index[1]!); rest = rest.slice(index[0].length); continue; }
    const key = /^\[("(?:[^"\\]|\\.)*")\]/.exec(rest);
    if (key) { parts.push(JSON.parse(key[1]!) as string); rest = rest.slice(key[0].length); continue; }
    throw new Error('路径格式无效。请使用 $.key[0]、$["key"] 或 /key/0；不支持通配符。');
  }
  return parts;
}

function resolvePath(root: unknown, path: string): unknown {
  let value = root;
  for (const key of parsePath(path)) {
    if (value === null || typeof value !== 'object' || isLosslessNumber(value) || !Object.hasOwn(value, key)) throw new Error(`路径不存在：${path}`);
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) throw new Error(`数组索引无效：${key}`);
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function treeOverview(root: unknown): ToolResult {
  const lines: string[] = [];
  let count = 0;
  function visit(value: unknown, path: string, depth: number): void {
    assertDepth(depth);
    if (++count > 3000) throw new Error('树形概览最多显示 3000 个节点，请通过路径提取缩小范围。');
    const prefix = '  '.repeat(depth);
    if (Array.isArray(value)) {
      lines.push(`${prefix}${path}  Array(${value.length})`);
      value.forEach((item, index) => visit(item, `[${index}]`, depth + 1));
    } else if (isRecord(value)) {
      lines.push(`${prefix}${path}  Object(${Object.keys(value).length})`);
      Object.entries(value).forEach(([key, item]) => visit(item, JSON.stringify(key), depth + 1));
    } else {
      const display = jsonStringify(value, 0);
      lines.push(`${prefix}${path}  ${display.length > 160 ? `${display.slice(0, 160)}…` : display}`);
    }
  }
  visit(root, '$', 0);
  return { output: lines.join('\n'), summary: `${count} 个节点`, kind: 'text' };
}

export function processJson(request: ToolRequest): ToolResult {
  const { input, action, options } = request;
  const indent = optionText(options, 'indent') === 'tab' ? '\t' : Number(options.indent);
  if (action === 'escape') return { output: JSON.stringify(input), summary: '已转义为 JSON 字符串' };
  if (action === 'unescape') {
    const result = jsonParse(input);
    if (typeof result !== 'string') throw new Error('反转义需要一个包含两侧双引号的 JSON 字符串。');
    return { output: result, summary: '已还原字符串' };
  }
  const value = jsonParse(input);
  if (action === 'validate') return { output: jsonStringify(value, indent), summary: 'JSON 语法正确 · 大整数精度已保留', kind: 'json' };
  if (action === 'tree') return treeOverview(value);
  if (action === 'path') return { output: jsonStringify(resolvePath(value, optionText(options, 'path')), indent), summary: `已提取 ${optionText(options, 'path')}`, kind: 'json' };
  return { output: jsonStringify(action === 'sort' ? sortedJson(value) : value, action === 'minify' ? 0 : indent), summary: '处理完成 · 大整数精度已保留', kind: 'json' };
}

function numericKey(value: unknown): string | undefined {
  if (!isLosslessNumber(value)) return undefined;
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.value)!;
  const fraction = parts[3] ?? '';
  let digits = `${parts[2]}${fraction}`.replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = BigInt(parts[4] ?? '0') - BigInt(fraction.length);
  const trim = digits.length - digits.replace(/0+$/, '').length;
  exponent += BigInt(trim);
  digits = digits.slice(0, digits.length - trim);
  return `${parts[1]}${digits}e${exponent}`;
}

export function compareJson(request: ToolRequest): ToolResult {
  const before = jsonParse(request.input);
  const after = jsonParse(request.secondaryInput ?? '');
  const changes: { path: string; type: string; before?: unknown; after?: unknown }[] = [];
  let pathCharacters = 0;
  const addChange = (change: typeof changes[number]) => {
    if (changes.length >= 10000) throw new Error('差异超过 10000 项，请拆分数据后比较。');
    pathCharacters += change.path.length;
    assertOutputLength(pathCharacters);
    changes.push(change);
  };
  const pathFor = (path: string, key: string) => `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
  function visit(left: unknown, right: unknown, path: string, depth: number): void {
    assertDepth(depth);
    if (changes.length >= 10000) throw new Error('差异超过 10000 项，请拆分数据后比较。');
    if (Object.is(left, right)) return;
    if (isLosslessNumber(left) && isLosslessNumber(right) && numericKey(left) === numericKey(right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const child = `${path}/${index}`;
        if (index >= left.length) addChange({ path: child, type: 'added', after: right[index] });
        else if (index >= right.length) addChange({ path: child, type: 'removed', before: left[index] });
        else visit(left[index], right[index], child, depth + 1);
      }
    } else if (isRecord(left) && isRecord(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        const child = pathFor(path, key);
        if (!Object.hasOwn(left, key)) addChange({ path: child, type: 'added', after: right[key] });
        else if (!Object.hasOwn(right, key)) addChange({ path: child, type: 'removed', before: left[key] });
        else visit(left[key], right[key], child, depth + 1);
      }
    } else addChange({ path, type: 'changed', before: left, after: right });
    if (changes.length > 10000) throw new Error('差异超过 10000 项，请拆分数据后比较。');
  }
  visit(before, after, '', 0);
  return { output: jsonStringify(changes), summary: changes.length ? `${changes.length} 处结构差异（路径为 JSON Pointer）` : '结构完全一致（忽略对象键名顺序与数字表示差异）', kind: 'json', stats: { '差异': changes.length } };
}
