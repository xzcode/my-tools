import { isLosslessNumber, parse, stringify } from 'lossless-json';
import type { OptionValue } from './types';

export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export function assertOutputLength(length: number): void {
  if (length > MAX_OUTPUT_BYTES) throw new Error('预计输出超过 16 MiB，请减少输入或调整选项。');
}
export const encoder = new TextEncoder();
export const optionText = (options: Record<string, OptionValue>, key: string) => String(options[key] ?? '');
export const optionBool = (options: Record<string, OptionValue>, key: string) => options[key] === true;
export function boundedInt(value: OptionValue | undefined, min: number, max: number, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}须为 ${min}～${max} 的整数。`);
  return n;
}
export function jsonParse(input: string): unknown {
  try { return parse(input); } catch (error) { throw new Error(`JSON 无效：${error instanceof Error ? error.message : String(error)}`); }
}
export function jsonStringify(value: unknown, space: string | number = 2): string {
  const output = stringify(value, null, space);
  if (output === undefined) throw new Error('此值无法转换为 JSON。');
  return output;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !isLosslessNumber(value);
}
export function assertDepth(depth: number): void {
  if (depth > 128) throw new Error('数据嵌套超过 128 层，请拆分后处理。');
}
export function sortedJson(value: unknown, depth = 0): unknown {
  assertDepth(depth);
  if (Array.isArray(value)) return value.map(item => sortedJson(item, depth + 1));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value).sort()) result[key] = sortedJson(value[key], depth + 1);
  return result;
}
export function normalizedLines(input: string, options: Record<string, OptionValue>): string[] {
  let lines = input.split(/\r\n|\n|\r/);
  if (optionBool(options, 'trim')) lines = lines.map(line => line.trim());
  if (optionBool(options, 'skipEmpty')) lines = lines.filter(line => line.length > 0);
  return lines;
}
export function displayEscapes(input: string): string {
  return input.replace(/\\([nrt\\])/g, (_match, escape: string) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\' })[escape]!);
}
