import { describe, expect, it } from 'vitest';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { executeTool } from '../src/core/engine';
import { defaultOptions, getTool } from '../src/core/catalog';
import type { OptionValue } from '../src/core/types';

function aes(input: string, action: 'encrypt' | 'decrypt', changes: Record<string, OptionValue> = {}) {
  const tool = getTool('aes')!;
  return executeTool({
    toolId: 'aes',
    action,
    input,
    options: { ...defaultOptions(tool), profile: 'advanced', ...changes },
  });
}
const aes128 = {
  cipherMode: 'CBC', keySize: '128', keyEncoding: 'hex',
  rawKey: '2b7e151628aed2a6abf7158809cf4f3c',
  ivEncoding: 'hex', iv: '000102030405060708090a0b0c0d0e0f',
  dataEncoding: 'hex', cipherEncoding: 'hex', padding: 'none',
};

describe('advanced AES interoperability', () => {
  it('matches NIST AES-128-CBC NoPadding test vector byte-for-byte', async () => {
    const plain = '6bc1bee22e409f96e93d7e117393172a';
    const expected = '7649abac8119b246cee98e9b12e9197d';
    expect((await aes(plain, 'encrypt', aes128)).output).toBe(expected);
    expect((await aes(expected, 'decrypt', aes128)).output).toBe(plain);
  });

  it('CBC PKCS7 equals Java AES/CBC/PKCS5Padding semantics and Node crypto', async () => {
    const key = Buffer.from('1234567890123456');
    const iv = Buffer.from('abcdefghijklmnop');
    const message = '你好，Java AES/CBC/PKCS5Padding 👋';
    const opts = {
      cipherMode: 'CBC', keySize: '128', keyEncoding: 'utf8',
      rawKey: key.toString('utf8'), ivEncoding: 'utf8', iv: iv.toString('utf8'),
      padding: 'pkcs7', dataEncoding: 'utf8', cipherEncoding: 'base64',
    };
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const expected = Buffer.concat([cipher.update(message, 'utf8'), cipher.final()]).toString('base64');
    expect((await aes(message, 'encrypt', opts)).output).toBe(expected);
    expect((await aes(expected, 'decrypt', opts)).output).toBe(message);
    expect((await aes('', 'encrypt', opts)).output).toBe(Buffer.concat([
      createCipheriv('aes-128-cbc', key, iv).update(''),
      createCipheriv('aes-128-cbc', key, iv).final(),
    ]).toString('base64')); // same IV/key and empty payload
  });

  it.each([128, 192, 256])('GCM AES-%i ciphertext+tag matches Node crypto', async bits => {
    const key = Buffer.alloc(bits / 8, 0x42);
    const iv = Buffer.from('101112131415161718191a1b', 'hex');
    const aad = 'authenticated additional data';
    const text = '中文 GCM with emoji 👋';
    const opts = {
      cipherMode: 'GCM', keySize: String(bits), keyEncoding: 'hex', rawKey: key.toString('hex'),
      ivEncoding: 'hex', iv: iv.toString('hex'), dataEncoding: 'utf8',
      cipherEncoding: 'hex', tagLength: '128', tagFormat: 'appended',
      aad, aadEncoding: 'utf8',
    };
    const node = createCipheriv('aes-' + bits + '-gcm', key, iv);
    node.setAAD(Buffer.from(aad));
    const cipher = Buffer.concat([node.update(text, 'utf8'), node.final()]);
    const expected = Buffer.concat([cipher, node.getAuthTag()]);
    expect((await aes(text, 'encrypt', opts)).output).toBe(expected.toString('hex'));
    expect((await aes(expected.toString('hex'), 'decrypt', opts)).output).toBe(text);
    const separated = JSON.parse((await aes(text, 'encrypt', { ...opts, tagFormat: 'detached' })).output);
    expect(separated).toEqual({ ciphertext: cipher.toString('hex'), tag: node.getAuthTag().toString('hex') });
    expect((await aes(JSON.stringify(separated), 'decrypt', { ...opts, tagFormat: 'detached' })).output).toBe(text);
    await expect(aes(expected.toString('hex'), 'decrypt', { ...opts, aad: 'wrong' })).rejects.toThrow('认证失败');
  });

  it('supports binary plaintext with Base64, CBC NoPadding and multiple blocks', async () => {
    const key = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
    const iv = Buffer.from('101112131415161718191a1b1c1d1e1f', 'hex');
    const bytes = Buffer.from('00ff0a800102030405060708090a0b0c0102030405060708090a0b0c0d0e0f10', 'hex');
    const opts = { ...aes128, rawKey: key.toString('base64'), keyEncoding: 'base64', iv: iv.toString('base64'), ivEncoding: 'base64', dataEncoding: 'base64', cipherEncoding: 'base64' };
    const reference = createCipheriv('aes-128-cbc', key, iv);
    reference.setAutoPadding(false);
    const expected = Buffer.concat([reference.update(bytes), reference.final()]);
    const result = await aes(bytes.toString('base64'), 'encrypt', opts);
    expect(result.output).toBe(expected.toString('base64'));
    expect((await aes(result.output, 'decrypt', opts)).output).toBe(bytes.toString('base64'));
    expect((await aes('', 'encrypt', opts)).output).toBe('');
    expect((await aes('', 'decrypt', opts)).output).toBe('');
  });

  it('handles GCM alternate tag sizes and rejects tampering', async () => {
    const key = Buffer.alloc(16, 0xab);
    const iv = Buffer.alloc(12, 0x17);
    for (const bits of [96, 104, 112, 120, 128]) {
      const opts = {
        cipherMode: 'GCM', keySize: '128', keyEncoding: 'hex', rawKey: key.toString('hex'),
        ivEncoding: 'hex', iv: iv.toString('hex'), dataEncoding: 'utf8',
        cipherEncoding: 'base64', tagLength: String(bits), tagFormat: 'appended',
      };
      const encrypted = (await aes('tag test', 'encrypt', opts)).output;
      expect((await aes(encrypted, 'decrypt', opts)).output).toBe('tag test');
      const tampered = Buffer.from(encrypted, 'base64');
      tampered[tampered.length - 1]! ^= 0xff;
      await expect(aes(tampered.toString('base64'), 'decrypt', opts)).rejects.toThrow('认证失败');
    }
  });

  it('rejects mismatched exact Key and IV byte lengths, invalid text and padding', async () => {
    await expect(aes('ok', 'encrypt', { ...aes128, rawKey: '0011' })).rejects.toThrow('Key 长度');
    await expect(aes('ok', 'encrypt', { ...aes128, iv: '0001' })).rejects.toThrow('IV 必须');
    await expect(aes('ok', 'encrypt', { ...aes128, rawKey: 'gghh' })).rejects.toThrow('合法的 Hex');
    await expect(aes('abc', 'encrypt', aes128)).rejects.toThrow('Hex');
    await expect(aes('010203', 'encrypt', aes128)).rejects.toThrow('16 字节');
    await expect(aes('ff', 'decrypt', aes128)).rejects.toThrow('整数倍');
    await expect(aes('Z', 'decrypt', { ...aes128, cipherEncoding: 'base64' })).rejects.toThrow('Base64');
  });

  it('CBC is explicitly unauthenticated and GCM warns against IV reuse', async () => {
    expect((await aes('hello', 'encrypt', { ...aes128, padding: 'pkcs7', dataEncoding: 'utf8' })).warnings?.join('')).toContain('不提供密文完整性');
    expect((await aes('hello', 'encrypt', {
      cipherMode: 'GCM', keySize: '128', keyEncoding: 'hex', rawKey: '00'.repeat(16),
      ivEncoding: 'hex', iv: '00'.repeat(12),
    })).warnings?.join('')).toContain('不能重复使用 IV');
  });

  it('existing v0.2.0 simple JSON remains decryptable unchanged', async () => {
    const key = 'a test-only password with enough length';
    const previous = await executeTool({ toolId: 'aes', action: 'encrypt', input: 'legacy AES payload 👋', options: { password: key } });
    const parsed = JSON.parse(previous.output);
    expect(parsed.format).toBe('my-tools-aes-gcm');
    expect((await executeTool({ toolId: 'aes', action: 'decrypt', input: previous.output, options: { password: key, profile: 'simple' } })).output).toBe('legacy AES payload 👋');
  });

  it('detached tag input rejects malformed structure and missing tag bytes', async () => {
    const options = { cipherMode: 'GCM', keySize: '128', keyEncoding: 'hex', rawKey: '11'.repeat(16), ivEncoding: 'hex', iv: '22'.repeat(12), tagFormat: 'detached', cipherEncoding: 'hex' };
    await expect(aes('abc', 'decrypt', options)).rejects.toThrow('JSON');
    await expect(aes('{"ciphertext":"abcd","tag":"00"}', 'decrypt', options)).rejects.toThrow('Tag 长度');
  });
});
