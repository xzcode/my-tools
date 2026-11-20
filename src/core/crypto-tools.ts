import type { ToolRequest, ToolResult } from './types';
import { boundedInt, encoder, isRecord, jsonParse, jsonStringify, optionBool, optionText } from './shared';
import { decodeBase64Bytes, decodeUtf8, encodeBase64Bytes } from './encoding';

const AES_FORMAT = 'my-tools-aes-gcm';
const AES_ITERATIONS = 600_000;
const AES_SALT_BYTES = 16;
const AES_IV_BYTES = 12;
const AES_TAG_BYTES = 16;

function safeCrypto(): Crypto {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) {
    throw new Error('此环境未提供安全 Web Crypto API，无法执行加解密或密码生成。');
  }
  return globalThis.crypto;
}

async function aesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = safeCrypto().subtle;
  const baseKey = await subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: Uint8Array.from(salt), iterations: AES_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * This is a versioned self-contained AES-256-GCM format, NOT OpenSSL/CryptoJS
 * salted output and NOT AES-CBC/ECB. ciphertext includes the 128-bit GCM tag.
 * Every encryption derives a fresh key and uses a fresh random 96-bit IV.
 */
export async function processAes(request: ToolRequest): Promise<ToolResult> {
  const passphrase = optionText(request.options, 'password');
  if (passphrase.length < 8 || !passphrase.trim()) {
    throw new Error('请输入至少 8 个字符的加密口令；建议使用更长的随机口令。');
  }
  if (passphrase.length > 1024) throw new Error('加密口令不能超过 1024 个字符。');
  const crypto = safeCrypto();

  if (request.action === 'encrypt') {
    const salt = crypto.getRandomValues(new Uint8Array(AES_SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
    const key = await aesKey(passphrase, salt);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(request.input),
    ));
    return {
      output: jsonStringify({
        format: AES_FORMAT,
        version: 1,
        algorithm: 'AES-256-GCM',
        kdf: 'PBKDF2-HMAC-SHA256',
        iterations: AES_ITERATIONS,
        salt: encodeBase64Bytes(salt),
        iv: encodeBase64Bytes(iv),
        ciphertext: encodeBase64Bytes(ciphertext),
      }),
      summary: 'AES-256-GCM 加密完成 · 随机盐与 IV 已包含在密文中',
      kind: 'json',
    };
  }

  const record = jsonParse(request.input);
  if (!isRecord(record)
    || record.format !== AES_FORMAT
    || String(record.version) !== '1'
    || record.algorithm !== 'AES-256-GCM'
    || record.kdf !== 'PBKDF2-HMAC-SHA256'
    || String(record.iterations) !== String(AES_ITERATIONS)
    || typeof record.salt !== 'string'
    || typeof record.iv !== 'string'
    || typeof record.ciphertext !== 'string') {
    throw new Error('密文格式或版本不受支持；本工具只解密自身生成的 AES-256-GCM JSON 格式。');
  }

  const salt = decodeBase64Bytes(record.salt);
  const iv = decodeBase64Bytes(record.iv);
  const ciphertext = decodeBase64Bytes(record.ciphertext);
  if (salt.length !== AES_SALT_BYTES || iv.length !== AES_IV_BYTES || ciphertext.length < AES_TAG_BYTES) {
    throw new Error('密文的 salt、IV 或认证标签长度无效。');
  }

  const key = await aesKey(passphrase, salt);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Uint8Array.from(iv) },
      key,
      Uint8Array.from(ciphertext),
    );
  } catch {
    throw new Error('AES 认证失败：口令错误或密文已被修改。');
  }
  return {
    output: decodeUtf8(new Uint8Array(plaintext)),
    summary: 'AES-256-GCM 解密并通过完整性认证',
  };
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}:,.?';
const CONFUSABLE = /[O0Il1|]/g;

/** Uniform cryptographic random integers (rejection sampling, no modulo bias). */
class SecurePicker {
  private bytes = new Uint8Array(0);
  private index = 0;
  nextInt(max: number): number {
    if (!Number.isInteger(max) || max < 1 || max > 256) throw new Error('字符集范围无效。');
    const limit = 256 - (256 % max);
    for (;;) {
      if (this.index >= this.bytes.length) {
        this.bytes = safeCrypto().getRandomValues(new Uint8Array(256));
        this.index = 0;
      }
      const value = this.bytes[this.index++]!;
      if (value < limit) return value % max;
    }
  }
  select(alphabet: string): string {
    return alphabet[this.nextInt(alphabet.length)]!;
  }
}

export function processPassword(request: ToolRequest): ToolResult {
  safeCrypto();
  const length = boundedInt(request.options.length, 12, 128, '密码长度');
  const count = boundedInt(request.options.count, 1, 50, '生成数量');
  const excludeSimilar = optionBool(request.options, 'excludeSimilar');
  const groups = [
    optionBool(request.options, 'lowercase') ? LOWER : '',
    optionBool(request.options, 'uppercase') ? UPPER : '',
    optionBool(request.options, 'digits') ? DIGITS : '',
    optionBool(request.options, 'symbols') ? SYMBOLS : '',
  ].filter(Boolean).map(group => excludeSimilar ? group.replace(CONFUSABLE, '') : group);
  if (!groups.length) throw new Error('至少选择一种密码字符类型。');

  const alphabet = groups.join('');
  const picker = new SecurePicker();
  const passwords: string[] = [];
  for (let n = 0; n < count; n++) {
    // Satisfy every selected character category, then securely shuffle.
    const chars = groups.map(group => picker.select(group));
    while (chars.length < length) chars.push(picker.select(alphabet));
    for (let i = chars.length - 1; i > 0; i--) {
      const j = picker.nextInt(i + 1);
      [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }
    passwords.push(chars.join(''));
  }
  return {
    output: passwords.join('\n'),
    summary: '已用安全随机源生成 ' + count + ' 条 ' + length + ' 字符密码',
    warnings: ['密码只保留在当前会话内存中；复制后请存入可信的密码管理器。'],
  };
}
