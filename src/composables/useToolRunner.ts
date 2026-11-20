import { ref } from 'vue';
import type { ToolRequest, ToolResult } from '../core/types';

export function useToolRunner() {
  const running = ref(false);
  let worker: Worker | undefined;
  let currentId = 0;
  let pendingReject: ((reason: Error) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel(message = '处理已取消。') {
    currentId++;
    clearTimeout(timer);
    worker?.terminate();
    worker = undefined;
    running.value = false;
    pendingReject?.(new Error(message));
    pendingReject = undefined;
  }

  function run(request: ToolRequest): Promise<ToolResult> {
    cancel();
    const id = ++currentId;
    running.value = true;
    try {
      worker = new Worker(new URL('../workers/tool.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      running.value = false;
      return Promise.reject(new Error('当前环境无法启动工具处理进程，请重新打开应用后重试。'));
    }
    const activeWorker = worker;
    return new Promise((resolve, reject) => {
      pendingReject = reject;
      const finish = () => {
        clearTimeout(timer);
        activeWorker.terminate();
        if (worker === activeWorker) worker = undefined;
        pendingReject = undefined;
        running.value = false;
      };
      activeWorker.onmessage = (event: MessageEvent<{ id: number; result?: ToolResult; error?: string }>) => {
        if (event.data.id !== currentId) return;
        finish();
        if (event.data.result) resolve(event.data.result);
        else reject(new Error(event.data.error || '处理失败。'));
      };
      activeWorker.onerror = () => {
        if (id !== currentId) return;
        finish();
        reject(new Error('工具处理进程异常，已安全停止。请重试或缩小输入。'));
      };
      const timeout = request.toolId === 'regex' ? 2000 : request.toolId === 'aes' ? 30000 : 10000;
      timer = setTimeout(() => {
        if (id !== currentId) return;
        cancel(request.toolId === 'regex'
          ? '正则运行超过 2 秒，已中断。请简化表达式，避免嵌套重复量词。'
          : request.toolId === 'aes' ? 'AES 加解密超过 30 秒，已中断。请缩小输入后重试。'
          : '处理超过 10 秒，已中断。请缩小输入后重试。');
      }, timeout);
      try { activeWorker.postMessage({ id, request }); }
      catch {
        finish();
        reject(new Error('无法传递处理内容，已安全停止。'));
      }
    });
  }

  return { running, run, cancel };
}
