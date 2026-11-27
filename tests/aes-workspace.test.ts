import { describe, expect, it } from 'vitest';
import { createCipheriv } from 'node:crypto';
import { executeTool } from '../src/core/engine';
import { initialWorkspace, newTab, copyConfig, configOptions, snapshotWorkspace, restoreWorkspace } from '../src/core/aes-workspace';
import type { OptionValue } from '../src/core/types';

const key = '0123456789abcdef0123456789abcdef';
const ecb: Record<string, OptionValue> = { profile: 'advanced', cipherMode: 'ECB', keySize: '256', keyEncoding: 'utf8', rawKey: key, padding: 'pkcs7', cipherEncoding: 'base64', dataEncoding: 'utf8' };
function aes(action: string, input: string, options: Record<string, OptionValue>) {
  return executeTool({ toolId: 'aes', action, input, options });
}
describe('AES ciphertext prefix', () => {
  it('appends after encoding and removes exactly once before decryption', async () => {
    const message = '你好，Java AES 👋';
    const prefix = '{ENC} 中文 + [x].* ';
    const native = createCipheriv('aes-256-ecb', Buffer.from(key), null);
    const raw = Buffer.concat([native.update(message, 'utf8'), native.final()]).toString('base64');
    expect((await aes('encrypt', message, { ...ecb, prefix })).output).toBe(prefix + raw);
    expect((await aes('decrypt', prefix + raw, { ...ecb, prefix })).output).toBe(message);
    await expect(aes('decrypt', raw, { ...ecb, prefix })).rejects.toThrow('前缀不匹配');
    await expect(aes('decrypt', 'x' + prefix + raw, { ...ecb, prefix })).rejects.toThrow('前缀不匹配');
    await expect(aes('decrypt', prefix + prefix + raw, { ...ecb, prefix })).rejects.toThrow();
  });
  it('keeps empty prefix backward compatible', async () => {
    const raw = await aes('encrypt', 'abc', ecb);
    expect((await aes('encrypt', 'abc', { ...ecb, prefix: '' })).output).toBe(raw.output);
    expect((await aes('decrypt', raw.output, { ...ecb, prefix: '' })).output).toBe('abc');
  });
  it('applies the wrapper to CBC, GCM raw/detached and simple JSON', async () => {
    const cases: Record<string, OptionValue>[] = [
      { ...ecb, cipherMode: 'CBC', iv: 'abcdefghijklmnop', ivEncoding: 'utf8' },
      { ...ecb, cipherMode: 'GCM', iv: '00112233445566778899aabb', ivEncoding: 'hex', tagFormat: 'appended' },
      { ...ecb, cipherMode: 'GCM', iv: 'aabbccddeeff001122334455', ivEncoding: 'hex', tagFormat: 'detached' },
      { profile: 'simple', password: 'a test-only passphrase' },
    ];
    for (const opts of cases) {
      const encrypted = await aes('encrypt', 'data 中文', { ...opts, prefix: 'v1:' });
      expect(encrypted.output.startsWith('v1:')).toBe(true);
      expect(encrypted.kind).toBe('text');
      expect((await aes('decrypt', encrypted.output, { ...opts, prefix: 'v1:' })).output).toBe('data 中文');
    }
  });
  it('rejects oversized prefixes', async () => {
    await expect(aes('encrypt', 'abc', { ...ecb, prefix: 'x'.repeat(4097) })).rejects.toThrow('4096');
  });
});
describe('AES workspace storage policy', () => {
  function sample() {
    const state = initialWorkspace();
    const tab = state.tabs[0]!;
    tab.name = 'Java project';
    tab.options = { ...tab.options, ...ecb, prefix: '{cipher}', password: 'fixture-pass', iv: 'fixture-iv', aad: 'fixture-aad' };
    tab.input = 'fixture input';
    tab.result = { output: 'fixture output', summary: 'done' };
    state.closed = [newTab('Closed', { ...tab.options })];
    state.tabs.push(newTab('Other'));
    state.templates = [{ id: 'custom', name: 'Template', options: { ...tab.options } }];
    return state;
  }
  it('configuration and duplicate exclude sensitive values', () => {
    const state = sample();
    const json = JSON.stringify(snapshotWorkspace(state));
    for (const value of [key, '{cipher}', 'fixture-pass', 'fixture-iv', 'fixture-aad', 'fixture input', 'fixture output']) {
      expect(json).not.toContain(value);
      expect(JSON.stringify(copyConfig(state.tabs[0]!))).not.toContain(value);
      expect(JSON.stringify(configOptions(state.tabs[0]!.options))).not.toContain(value);
    }
    const restored = restoreWorkspace(json);
    expect(restored.tabs[0]!.name).toBe('Java project');
    expect(restored.tabs[0]!.options.cipherMode).toBe('ECB');
    expect(restored.closed[0]!.name).toBe('Closed');
    expect(restored.templates).toHaveLength(1);
  });
  it('explicit full save honors selected fields and preserves order', () => {
    const state = sample();
    state.mode = 'full';
    state.fields.iv = false;
    state.fields.output = false;
    state.activeId = state.tabs[1]!.id;
    const restored = restoreWorkspace(JSON.stringify(snapshotWorkspace(state)));
    expect(restored.mode).toBe('full');
    expect(restored.activeId).toBe(state.activeId);
    expect(restored.tabs[0]!.options.rawKey).toBe(key);
    expect(restored.tabs[0]!.options.prefix).toBe('{cipher}');
    expect(restored.tabs[0]!.options.iv).toBe('');
    expect(restored.tabs[0]!.input).toBe('fixture input');
    expect(restored.tabs[0]!.result).toBeNull();
    expect(restored.closed[0]!.options.rawKey).toBe(key);
    expect(restored.templates[0]!.options.rawKey).toBeUndefined();
  });
  it('off mode clears session payload and malformed documents are rejected', () => {
    const state = sample();
    state.mode = 'off';
    const serialized = JSON.stringify(snapshotWorkspace(state));
    expect(serialized).not.toContain('Java project');
    expect(restoreWorkspace(serialized).mode).toBe('off');
    expect(restoreWorkspace(serialized).tabs).toHaveLength(1);
    expect(() => restoreWorkspace('{"version":2}')).toThrow();
    expect(() => restoreWorkspace('not-json')).toThrow();
  });
});
