import { executeTool } from '../core/engine';
import type { ToolRequest } from '../core/types';

self.addEventListener('message', async (event: MessageEvent<{ id: number; request: ToolRequest }>) => {
  const { id, request } = event.data;
  try {
    const result = await executeTool(request);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : '处理失败，请检查输入内容。' });
  }
});
