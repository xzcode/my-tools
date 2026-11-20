import { isLosslessNumber, LosslessNumber } from 'lossless-json';
import Papa from 'papaparse';
import { parseDocument, stringify as stringifyYaml, visit } from 'yaml';
import type { ScalarTag } from 'yaml';
import type { ToolRequest, ToolResult } from './types';
import { assertDepth, isRecord, jsonParse, jsonStringify, optionBool, optionText } from './shared';

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const losslessTag: ScalarTag = {
  tag: 'tag:yaml.org,2002:float', default: true,
  identify: isLosslessNumber,
  test: JSON_NUMBER,
  resolve: value => new LosslessNumber(value),
  stringify: item => (item.value as LosslessNumber).value,
};

function normalizeYaml(value: unknown, ancestors = new Set<object>(), depth = 0, budget = { nodes: 0, text: 0 }): unknown {
  assertDepth(depth);
  budget.nodes++;
  if (typeof value === 'string') budget.text += value.length;
  if (budget.nodes > 100000 || budget.text > 16 * 1024 * 1024) throw new Error('YAML 展开后数据过大，请减少锚点引用或拆分文件。');
  if (typeof value === 'bigint') return new LosslessNumber(value.toString());
  if (isLosslessNumber(value) || value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON 不支持 YAML 的 Infinity 或 NaN。');
    return value;
  }
  if (typeof value !== 'object') throw new Error('YAML 包含无法表示为 JSON 的类型。');
  if (ancestors.has(value)) throw new Error('循环 YAML 锚点无法转换为 JSON。');
  ancestors.add(value);
  let result: unknown;
  if (Array.isArray(value)) result = value.map(item => normalizeYaml(item, ancestors, depth + 1, budget));
  else if (value instanceof Map) {
    const object: Record<string, unknown> = Object.create(null);
    for (const [key, item] of value) {
      if (typeof key !== 'string') throw new Error('转换为 JSON / CSV 时，YAML 键必须是字符串；请给数字键加引号。');
      object[key] = normalizeYaml(item, ancestors, depth + 1, budget);
    }
    result = object;
  } else throw new Error('YAML 包含不支持的自定义对象。');
  ancestors.delete(value);
  return result;
}

function readYaml(input: string): unknown {
  const document = parseDocument(input, { intAsBigInt: true, uniqueKeys: true, merge: false });
  if (document.errors.length) throw new Error(`YAML 无效：${document.errors[0]!.message}`);
  if (document.warnings.length) throw new Error(`YAML 存在不支持的标记：${document.warnings[0]!.message}`);
  visit(document, { Scalar(_key, node) {
    if (typeof node.value === 'number' && node.source && JSON_NUMBER.test(node.source)) node.value = new LosslessNumber(node.source);
  } });
  return normalizeYaml(document.toJS({ mapAsMap: true, maxAliasCount: 50 }));
}

function readCsv(input: string, hasHeader: boolean): unknown {
  const parsed = Papa.parse<string[]>(input, { header: false, dynamicTyping: false, skipEmptyLines: true });
  const errors = parsed.errors.filter(error => error.code !== 'UndetectableDelimiter');
  if (errors.length) throw new Error(`CSV 无效：${errors[0]!.message}${errors[0]!.row === undefined ? '' : `（第 ${errors[0]!.row! + 1} 行）`}`);
  if (!hasHeader) return parsed.data;
  const [fields, ...rows] = parsed.data;
  if (!fields) return [];
  if (fields.some(field => !field.trim())) throw new Error('CSV 列名不能为空。');
  if (new Set(fields).size !== fields.length) throw new Error('CSV 存在重复列名，请先修改列名以避免数据丢失。');
  return rows.map((row, index) => {
    if (row.length !== fields.length) throw new Error(`CSV 第 ${index + 2} 行有 ${row.length} 列，列名为 ${fields.length} 列。`);
    const record: Record<string, string> = Object.create(null);
    fields.forEach((field, column) => { record[field] = row[column]!; });
    return record;
  });
}

function cellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : jsonStringify(value, 0);
}
function writeCsv(value: unknown, header: boolean, escapeFormulae: boolean): string {
  if (!Array.isArray(value)) throw new Error('CSV 输出需要对象数组或二维数组。');
  if (!value.length) return '';
  const config = { newline: '\n', escapeFormulae, header };
  if (value.every(Array.isArray)) return Papa.unparse(value.map(row => row.map(cellValue)), { ...config, header: false });
  if (!value.every(isRecord)) throw new Error('CSV 输出需要结构一致的对象数组或二维数组。');
  const fields = [...new Set(value.flatMap(row => Object.keys(row)))];
  if (fields.length * value.length > 2000000) throw new Error('CSV 展开后超过 200 万个单元格，请拆分数据或统一字段。');
  const data = value.map(row => fields.map(field => Object.hasOwn(row, field) ? cellValue(row[field]) : ''));
  return Papa.unparse({ fields, data }, config);
}

export function processConvert(request: ToolRequest): ToolResult {
  const from = optionText(request.options, 'from'); const to = optionText(request.options, 'to');
  const value = from === 'json' ? jsonParse(request.input) : from === 'yaml' ? readYaml(request.input) : readCsv(request.input, optionBool(request.options, 'csvHeader'));
  const output = to === 'json' ? jsonStringify(value) : to === 'yaml' ? stringifyYaml(value, { customTags: [losslessTag], lineWidth: 0, indent: 2 }) : writeCsv(value, optionBool(request.options, 'csvHeader'), optionBool(request.options, 'escapeFormulae'));
  return { output, summary: `${from.toUpperCase()} → ${to.toUpperCase()}`, kind: to === 'json' ? 'json' : 'text', warnings: to === 'csv' && optionBool(request.options, 'escapeFormulae') ? ['CSV 中以 =、+、-、@、Tab、回车开头的值会加单引号，以防电子表格执行公式。'] : undefined };
}
