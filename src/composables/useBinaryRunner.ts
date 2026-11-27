import { ref } from 'vue';
import type { BinaryRequest } from '../workers/binary.worker';

export function useBinaryRunner() {
  const busy = ref(false);
  let cancelCurrent: (() => void) | undefined;

  function cancelBinary() { cancelCurrent?.(); }

  async function runBinary(request: BinaryRequest): Promise<{ output?: string; bytes?: Uint8Array }> {
    cancelBinary();
    busy.value = true;
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try { worker = new Worker(new URL('../workers/binary.worker.ts', import.meta.url), { type: 'module' }); }
      catch {
        busy.value = false;
        reject(new Error('当前环境无法启动文件处理进程。'));
        return;
      }
      const cleanup = () => { worker.terminate(); busy.value = false; cancelCurrent = undefined; };
      cancelCurrent = () => { cleanup(); reject(new Error('文件处理已取消。')); };
      worker.onmessage = (event: MessageEvent<{ output?: string; bytes?: Uint8Array; error?: string }>) => {
        cleanup();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data);
      };
      worker.onerror = () => { cleanup(); reject(new Error('文件处理失败，请重试。')); };
      try { worker.postMessage(request); }
      catch { cleanup(); reject(new Error('无法传递文件内容，已安全停止。')); }
    });
  }

  return { busy, runBinary, cancelBinary };
}
