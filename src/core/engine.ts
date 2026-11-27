import { processPhone } from './phone';
import { defaultOptions, getTool } from './catalog';
import type { ToolRequest, ToolResult } from './types';
import { compareJson, processJson } from './json-tools';
import { processBase64, processUrl } from './encoding';
import { compareText, processJoin, processText } from './text-tools';
import { processHash, processJwt, processRegex, processSql, processSqlIn, processTimestamp, processUuid } from './developer-tools';
import { processConvert } from './convert-tools';
import { processCurl } from './curl-parser';
import { processAes, processPassword } from './crypto-tools';

/** Run in a dedicated, disposable Worker. Regex and diff must not block the UI. */
export async function executeTool(request: ToolRequest): Promise<ToolResult> {
  const tool = getTool(request.toolId);
  if (!tool) throw new Error('未找到此工具。');
  if (!tool.actions.some(action => action.id === request.action)) throw new Error('此工具不支持指定操作。');
  if (typeof request.input !== 'string' || (request.secondaryInput !== undefined && typeof request.secondaryInput !== 'string')) throw new Error('输入必须是文本。');
  const normalized: ToolRequest = { ...request, options: { ...defaultOptions(tool), ...request.options } };
  for (const option of tool.options) {
    const value = normalized.options[option.key];
    if (option.type === 'checkbox' && typeof value !== 'boolean') throw new Error(`${option.label}必须是布尔值。`);
    if (option.type === 'select' && !option.choices?.some(choice => choice.value === value)) throw new Error(`${option.label}选项无效。`);
    if ((option.type === 'text' || option.type === 'textarea') && typeof value !== 'string') throw new Error(`${option.label}必须是文本。`);
    if (option.type === 'number' && (!Number.isInteger(Number(value)) || Number(value) < (option.min ?? -Infinity) || Number(value) > (option.max ?? Infinity))) throw new Error(`${option.label}超出范围。`);
  }
  let result: ToolResult;
  switch (tool.id) {
    case 'json': result = processJson(normalized); break;
    case 'string-join': result = processJoin(normalized); break;
    case 'text': result = processText(normalized); break;
    case 'base64': result = processBase64(normalized); break;
    case 'url': result = processUrl(normalized); break;
    case 'timestamp': result = processTimestamp(normalized); break;
    case 'uuid': result = processUuid(normalized); break;
    case 'hash': result = await processHash(normalized); break;
    case 'jwt': result = processJwt(normalized); break;
    case 'sql': result = processSql(normalized); break;
    case 'sql-in': result = processSqlIn(normalized); break;
    case 'regex': result = processRegex(normalized); break;
    case 'text-diff': result = compareText(normalized); break;
    case 'json-diff': result = compareJson(normalized); break;
    case 'convert': result = processConvert(normalized); break;
    case 'curl': result = processCurl(normalized); break;
    case 'aes': result = await processAes(normalized); break;
    case 'phone': result = processPhone(normalized); break;
    case 'svga': result = { output: '请在 SVGA 文件预览界面打开本地动画文件。' }; break;
    case 'password': result = processPassword(normalized); break;
    default: throw new Error('工具尚未实现。');
  }
  return result;
}
