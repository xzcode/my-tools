import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToolRunner } from '../src/composables/useToolRunner';
import { useBinaryRunner } from '../src/composables/useBinaryRunner';
import type { ToolRequest } from '../src/core/types';

class WorkerDouble {
  static instances: WorkerDouble[] = [];
  static failConstruction = false;
  static failPost = false;
  onmessage: ((event: { data: Record<string, unknown> }) => void) | null = null;
  onerror: (() => void) | null = null;
  message: Record<string, unknown> = {};
  terminated = false;

  constructor() {
    if (WorkerDouble.failConstruction) throw new Error('Blocked by policy');
    WorkerDouble.instances.push(this);
  }
  postMessage(message: Record<string, unknown>) {
    if (WorkerDouble.failPost) throw new Error('DataCloneError');
    this.message = message;
  }
  terminate() { this.terminated = true; }
  respond(data: Record<string, unknown>) { this.onmessage?.({ data }); }
}

const request: ToolRequest = { toolId: 'json', action: 'format', input: '{"a":1}', options: {} };

beforeEach(() => {
  vi.useFakeTimers();
  WorkerDouble.instances = [];
  WorkerDouble.failConstruction = false;
  WorkerDouble.failPost = false;
  vi.stubGlobal('Worker', WorkerDouble);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('worker isolation and recovery', () => {
  it('terminates the worker after successful computation and resets running state', async () => {
    const runner = useToolRunner();
    const pending = runner.run(request);
    const worker = WorkerDouble.instances[0]!;
    expect(runner.running.value).toBe(true);
    worker.respond({ id: worker.message.id, result: { output: '{\n  "a": 1\n}' } });
    expect((await pending).output).toContain('\n');
    expect(worker.terminated).toBe(true);
    expect(runner.running.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a previous run and ignores messages from the terminated worker', async () => {
    const runner = useToolRunner();
    const previous = runner.run(request);
    const rejected = expect(previous).rejects.toThrow('取消');
    const oldWorker = WorkerDouble.instances[0]!;
    const next = runner.run({ ...request, input: '{"b":2}' });
    await rejected;
    oldWorker.respond({ id: oldWorker.message.id, result: { output: 'stale' } });
    expect(runner.running.value).toBe(true);
    const worker = WorkerDouble.instances[1]!;
    worker.respond({ id: worker.message.id, result: { output: 'fresh' } });
    expect((await next).output).toBe('fresh');
  });

  it('interrupts a pathological regular expression after two seconds', async () => {
    const runner = useToolRunner();
    const pending = runner.run({ ...request, toolId: 'regex' });
    const rejected = expect(pending).rejects.toThrow('2 秒');
    await vi.advanceTimersByTimeAsync(2000);
    await rejected;
    expect(WorkerDouble.instances[0]!.terminated).toBe(true);
    expect(runner.running.value).toBe(false);
  });

  it('bounds non-regex computation at ten seconds', async () => {
    const runner = useToolRunner();
    const pending = runner.run(request);
    const rejected = expect(pending).rejects.toThrow('10 秒');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(runner.running.value).toBe(false);
  });

  it('cleans up and reports a worker crash without retaining the running state', async () => {
    const runner = useToolRunner();
    const pending = runner.run(request);
    WorkerDouble.instances[0]!.onerror?.();
    await expect(pending).rejects.toThrow('异常');
    expect(runner.running.value).toBe(false);
    expect(WorkerDouble.instances[0]!.terminated).toBe(true);
  });

  it('recovers if the environment refuses to create a worker', async () => {
    WorkerDouble.failConstruction = true;
    const runner = useToolRunner();
    await expect(runner.run(request)).rejects.toThrow('无法启动');
    expect(runner.running.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminates the worker if structured cloning rejects the request', async () => {
    WorkerDouble.failPost = true;
    const runner = useToolRunner();
    await expect(runner.run(request)).rejects.toThrow('无法传递');
    expect(runner.running.value).toBe(false);
    expect(WorkerDouble.instances[0]!.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns binary bytes without converting them through UTF-8', async () => {
    const runner = useBinaryRunner();
    const pending = runner.runBinary({ action: 'decode', input: '/wA=', urlSafe: false });
    const bytes = new Uint8Array([255, 0]);
    WorkerDouble.instances[0]!.respond({ bytes });
    expect((await pending).bytes).toEqual(bytes);
    expect(runner.busy.value).toBe(false);
    expect(WorkerDouble.instances[0]!.terminated).toBe(true);
  });

  it('resets binary busy state when worker creation is blocked', async () => {
    WorkerDouble.failConstruction = true;
    const runner = useBinaryRunner();
    await expect(runner.runBinary({ action: 'decode', input: 'AA==', urlSafe: false })).rejects.toThrow('无法启动');
    expect(runner.busy.value).toBe(false);
  });

  it('cancels a binary computation and releases its timeout', async () => {
    const runner = useBinaryRunner();
    const pending = runner.runBinary({ action: 'encode', bytes: new Uint8Array([1, 2, 3]), urlSafe: false, padding: true });
    runner.cancelBinary();
    await expect(pending).rejects.toThrow('取消');
    expect(runner.busy.value).toBe(false);
    expect(WorkerDouble.instances[0]!.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
