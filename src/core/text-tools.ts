import { diffLines, diffWordsWithSpace } from 'diff';
import type { ToolRequest, ToolResult } from './types';
import { assertOutputLength, displayEscapes, normalizedLines, optionBool, optionText } from './shared';

export function processJoin(request: ToolRequest): ToolResult {
  let lines = normalizedLines(request.input, request.options);
  if (optionBool(request.options, 'dedupe')) lines = [...new Set(lines)];
  const quote = ({ none: '', single: "'", double: '"', backtick: '`' })[optionText(request.options, 'quote')] ?? '';
  const prefix = optionText(request.options, 'prefix');
  const suffix = optionText(request.options, 'suffix');
  const separator = displayEscapes(optionText(request.options, 'separator'));
  assertOutputLength(lines.reduce((sum, line) => sum + line.length, 0) + lines.length * (prefix.length + suffix.length + quote.length * 2) + Math.max(0, lines.length - 1) * separator.length);
  return { output: lines.map(line => `${quote}${prefix}${line}${suffix}${quote}`).join(separator), summary: `已拼接 ${lines.length} 项` };
}

export function processText(request: ToolRequest): ToolResult {
  const { input, action, options } = request;
  let output: string;
  if (action === 'upper') output = input.toLocaleUpperCase();
  else if (action === 'lower') output = input.toLocaleLowerCase();
  else if (action === 'replace') {
    const find = optionText(options, 'find');
    if (!find) throw new Error('查找文本不能为空。');
    const replacement = optionText(options, 'replace');
    let count = 0; let index = input.indexOf(find);
    while (index !== -1) { count++; index = input.indexOf(find, index + find.length); }
    assertOutputLength(input.length + count * (replacement.length - find.length));
    output = input.split(find).join(replacement);
  } else if (action === 'html-escape') output = input.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  else if (action === 'html-unescape') output = input.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (full: string, entity: string) => {
    if (entity.startsWith('#')) {
      const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : full;
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' })[entity.toLowerCase()] ?? full;
  });
  else {
    let lines = normalizedLines(input, options);
    if (action === 'dedupe') lines = [...new Set(lines)];
    else if (action === 'sort' || action === 'sort-desc') {
      const collator = new Intl.Collator('zh-CN', { numeric: true });
      lines.sort(collator.compare);
      if (action === 'sort-desc') lines.reverse();
    }
    output = lines.join('\n');
  }
  return { output, summary: `${output.length} 个 UTF-16 代码单元 · ${output.split('\n').length} 行` };
}

export function compareText(request: ToolRequest): ToolResult {
  let left = request.input;
  let right = request.secondaryInput ?? '';
  if (optionBool(request.options, 'ignoreWhitespace')) {
    left = left.split(/\r?\n/).map(line => line.trim()).join('\n');
    right = right.split(/\r?\n/).map(line => line.trim()).join('\n');
  }
  if (left.length + right.length > 512 * 1024) throw new Error('文本对比合计限 512 KiB 字符，请拆分较大的文本。');
  const changes = optionText(request.options, 'mode') === 'words'
    ? diffWordsWithSpace(left, right, { timeout: 1500, maxEditLength: 10000 })
    : diffLines(left, right, { timeout: 1500, maxEditLength: 10000 });
  if (!changes) throw new Error('差异过多或对比超时，请缩小文本后重试。');
  const diff = changes.map(change => ({ type: change.added ? 'add' as const : change.removed ? 'remove' as const : 'equal' as const, text: change.value }));
  const added = changes.filter(change => change.added).reduce((sum, change) => sum + (change.count ?? 0), 0);
  const removed = changes.filter(change => change.removed).reduce((sum, change) => sum + (change.count ?? 0), 0);
  const unit = optionText(request.options, 'mode') === 'words' ? '个词元' : '行';
  const output = changes.map(change => {
    const prefix = change.added ? '+ ' : change.removed ? '- ' : '  ';
    return change.value.split(/(?<=\n)/).map(line => `${prefix}${line}`).join('');
  }).join('');
  return { output, diff, kind: 'diff', summary: added || removed ? `新增 ${added} ${unit} · 删除 ${removed} ${unit}` : '两段文本相同', stats: { '新增': added, '删除': removed } };
}
