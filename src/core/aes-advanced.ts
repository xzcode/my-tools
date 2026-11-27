import type { ToolRequest, ToolResult } from './types';
import { encoder, isRecord, jsonParse, jsonStringify, optionText } from './shared';
import { bytesToHex, decodeBase64Bytes, decodeUtf8, encodeBase64Bytes, hexToBytes } from './encoding';

type Encoding = 'utf8' | 'hex' | 'base64';
type CipherMode = 'GCM' | 'CBC' | 'ECB';
type Padding = 'pkcs7' | 'none';
const CBC_BLOCK_BYTES = 16;

/**
 * Compatibility only: AES/ECB/PKCS5Padding from Java.
 * WebCrypto intentionally has no ECB. The first block of CBC with zero IV
 * equals AES-ECB of one block; CBC decryption can be unchained by XORing
 * the previous ciphertext block. No AES rounds are implemented here.
 */
const ECB_WARNING = 'ECB 仅用于兼容已有 Java AES/ECB/PKCS5Padding：重复明文块泄露模式，且不验证篡改。新系统应使用 GCM。';

async function processLegacyEcb(
  request: ToolRequest, keyBytes: Uint8Array, keyBits: number,
  dataEncoding: Encoding, cipherEncoding: Encoding, crypto: Crypto,
): Promise<ToolResult> {
  const padding = optionText(request.options, 'padding') as Padding;
  const iv = new Uint8Array(CBC_BLOCK_BYTES); // internal zero IV; ECB has no IV parameter
  const key = await crypto.subtle.importKey(
    'raw', Uint8Array.from(keyBytes), 'AES-CBC', false,
    request.action === 'encrypt' ? ['encrypt'] : ['encrypt', 'decrypt'],
  );
  if (request.action === 'encrypt') {
    const input = parseBytes(request.input, dataEncoding, '明文');
    if (padding === 'none' && input.length % CBC_BLOCK_BYTES) {
      throw new Error('ECB NoPadding 明文长度必须是 16 字节的整数倍。');
    }
    const pad = padding === 'pkcs7' ? CBC_BLOCK_BYTES - input.length % CBC_BLOCK_BYTES : 0;
    const payload = new Uint8Array(input.length + pad);
    payload.set(input);
    if (pad) payload.fill(pad, input.length);
    const output = new Uint8Array(payload.length);
    // Bound concurrency to avoid overwhelming the platform crypto backend.
    for (let offset = 0; offset < payload.length; offset += 32 * CBC_BLOCK_BYTES) {
      const n = Math.min(32, (payload.length - offset) / CBC_BLOCK_BYTES);
      const blocks = await Promise.all(Array.from({ length: n }, (_, i) => {
        const at = offset + i * CBC_BLOCK_BYTES;
        return crypto.subtle.encrypt(
          { name: 'AES-CBC', iv }, key,
          Uint8Array.from(payload.subarray(at, at + CBC_BLOCK_BYTES)),
        );
      }));
      blocks.forEach((b, i) => output.set(new Uint8Array(b).subarray(0, CBC_BLOCK_BYTES), offset + i * CBC_BLOCK_BYTES));
    }
    return {
      output: renderBytes(output, cipherEncoding),
      summary: 'AES-' + keyBits + '-ECB ' + (padding === 'none' ? 'NoPadding' : 'Java PKCS5Padding') + ' 加密完成 · 无 IV',
      warnings: [ECB_WARNING],
    };
  }

  const ciphertext = parseBytes(request.input, cipherEncoding, '密文');
  if (ciphertext.length % CBC_BLOCK_BYTES || (padding === 'pkcs7' && !ciphertext.length)) {
    throw new Error('ECB 密文长度必须是 16 字节的整数倍，PKCS5/PKCS7 密文不能是空的。');
  }
  if (!ciphertext.length) return { output: '', summary: 'AES-' + keyBits + '-ECB NoPadding 解密完成', warnings: [ECB_WARNING] };
  // A synthetic final encrypted padding block satisfies WebCrypto CBC's
  // required PKCS7 unpadding without changing the existing ciphertext.
  const last = ciphertext.subarray(ciphertext.length - CBC_BLOCK_BYTES);
  const synthetic = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: Uint8Array.from(last) }, key, new Uint8Array(0),
  ));
  const extended = new Uint8Array(ciphertext.length + CBC_BLOCK_BYTES);
  extended.set(ciphertext);
  extended.set(synthetic, ciphertext.length);
  const bytes = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv }, key, extended,
  ));
  for (let i = CBC_BLOCK_BYTES; i < bytes.length; i++) {
    bytes[i] = bytes[i]! ^ ciphertext[i - CBC_BLOCK_BYTES]!;
  }

  let length = bytes.length;
  if (padding === 'pkcs7') {
    const pad = bytes[length - 1]!;
    let invalid = Number(pad < 1 || pad > CBC_BLOCK_BYTES);
    for (let i = 0; i < CBC_BLOCK_BYTES; i++) {
      if (i < pad) invalid |= bytes[length - 1 - i]! ^ pad;
    }
    if (invalid) throw new Error('ECB PKCS5Padding 填充校验失败：Key、密文或 Padding 可能不匹配（ECB 不认证密文）。');
    length -= pad;
  }
  return {
    output: renderBytes(bytes.subarray(0, length), dataEncoding),
    summary: 'AES-' + keyBits + '-ECB ' + (padding === 'none' ? 'NoPadding' : 'Java PKCS5Padding') + ' 解密完成 · 无 IV',
    warnings: [ECB_WARNING],
  };
}



function requireCrypto(): Crypto {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持 Web Crypto 安全加密 API。');
  }
  return globalThis.crypto;
}

function parseBytes(value: string, format: string, label: string): Uint8Array {
  if (format === 'utf8') return encoder.encode(value);
  if (format === 'hex') {
    try { return hexToBytes(value.trim()); } catch { throw new Error(label + ' 必须是合法的 Hex 字节。'); }
  }
  if (format === 'base64') {
    try { return decodeBase64Bytes(value); } catch { throw new Error(label + ' 必须是合法的 Base64 字节。'); }
  }
  throw new Error(label + ' 的编码格式无效。');
}

function renderBytes(bytes: Uint8Array, format: Encoding): string {
  if (format === 'utf8') return decodeUtf8(bytes);
  return format === 'hex' ? bytesToHex(bytes) : encodeBase64Bytes(bytes);
}

function tagBits(options: ToolRequest['options']): number {
  const bits = Number(options.tagLength);
  if (![96, 104, 112, 120, 128].includes(bits)) throw new Error('GCM Tag 长度不受支持。');
  return bits;
}

/**
 * Advanced mode is interoperability-oriented: a literal AES key and IV are
 * supplied, not derived from a passphrase. GCM's raw output is ciphertext||tag,
 * as produced by Web Crypto and Java Cipher.doFinal. Detached-tag mode emits
 * JSON with separate ciphertext and tag fields, using the selected encoding.
 */
export async function processAdvancedAes(request: ToolRequest): Promise<ToolResult> {
  const { action, options } = request;
  const mode = optionText(options, 'cipherMode') as CipherMode;
  const keySize = Number(options.keySize);
  const plaintextEncoding = optionText(options, 'dataEncoding') as Encoding;
  const ciphertextEncoding = optionText(options, 'cipherEncoding') as Encoding;
  const keyBytes = parseBytes(optionText(options, 'rawKey'), optionText(options, 'keyEncoding'), 'Key');
  const requiredKeyBytes = keySize / 8;
  if (![128, 192, 256].includes(keySize) || keyBytes.length !== requiredKeyBytes) {
    throw new Error('Key 长度必须与所选 AES-' + keySize + ' 匹配：需要 ' + requiredKeyBytes + ' 字节，当前为 ' + keyBytes.length + ' 字节；高级模式不会对 Key 自动做哈希或补齐。');
  }
  const crypto = requireCrypto();
  // ECB ignores IV completely, including any old input hidden in the UI.
  if (mode === 'ECB') return processLegacyEcb(request, keyBytes, keySize, plaintextEncoding, ciphertextEncoding, crypto);
  const iv = parseBytes(optionText(options, 'iv'), optionText(options, 'ivEncoding'), 'IV');
  const requiredIvBytes = mode === 'GCM' ? 12 : CBC_BLOCK_BYTES;
  if (iv.length !== requiredIvBytes) {
    throw new Error(mode + ' 模式的 IV 必须恰好 ' + requiredIvBytes + ' 字节，当前为 ' + iv.length + ' 字节。');
  }
  // CBC NoPadding decrypt uses an auxiliary CBC encryption of a synthetic
  // padding block; request both key usages only for that specific path.
  const usages: KeyUsage[] = mode === 'CBC' && action === 'decrypt' && optionText(options, 'padding') === 'none'
    ? ['encrypt', 'decrypt']
    : action === 'encrypt' ? ['encrypt'] : ['decrypt'];
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(keyBytes), 'AES-' + mode, false, usages);
  const warning = mode === 'GCM'
    ? '高级模式的 IV 由你管理：同一 Key 下 GCM 加密绝不能重复使用 IV。请每次加密生成新的随机 IV，并与密文一起保存。'
    : 'CBC 只提供保密性，不提供密文完整性认证；切勿依赖它检测篡改。可控制新系统时优先选择 GCM。';

  if (mode === 'GCM') {
    const bits = tagBits(options);
    const tagLen = bits / 8;
    const aadText = optionText(options, 'aad');
    const aad = aadText ? parseBytes(aadText, optionText(options, 'aadEncoding'), 'AAD') : undefined;
    const params: AesGcmParams = {
      name: 'AES-GCM', iv: Uint8Array.from(iv), tagLength: bits,
      ...(aad ? { additionalData: Uint8Array.from(aad) } : {}),
    };
    const detached = optionText(options, 'tagFormat') === 'detached';
    if (action === 'encrypt') {
      const plaintext = parseBytes(request.input, plaintextEncoding, '明文');
      const encrypted = new Uint8Array(await crypto.subtle.encrypt(params, key, Uint8Array.from(plaintext)));
      const output = detached
        ? jsonStringify({
            ciphertext: renderBytes(encrypted.subarray(0, -tagLen), ciphertextEncoding),
            tag: renderBytes(encrypted.subarray(-tagLen), ciphertextEncoding),
          })
        : renderBytes(encrypted, ciphertextEncoding);
      return {
        output, kind: detached ? 'json' : 'text',
        summary: 'AES-' + keySize + '-GCM 加密完成 · Tag ' + bits + ' bit · ' + ciphertextEncoding,
        warnings: [warning],
      };
    }
    let payload: Uint8Array;
    if (detached) {
      const record = jsonParse(request.input);
      if (!isRecord(record) || typeof record.ciphertext !== 'string' || typeof record.tag !== 'string') {
        throw new Error('独立 Tag 模式需要 JSON：{"ciphertext":"...","tag":"..."}。');
      }
      const cipher = parseBytes(record.ciphertext, ciphertextEncoding, '密文');
      const tag = parseBytes(record.tag, ciphertextEncoding, 'Tag');
      if (tag.length !== tagLen) throw new Error('独立 Tag 长度与选定的 GCM Tag 位数不匹配。');
      payload = new Uint8Array(cipher.length + tag.length);
      payload.set(cipher);
      payload.set(tag, cipher.length);
    } else payload = parseBytes(request.input, ciphertextEncoding, '密文');
    if (payload.length < tagLen) throw new Error('GCM 密文过短，缺少完整 Tag。');
    try {
      const plaintext = new Uint8Array(await crypto.subtle.decrypt(params, key, Uint8Array.from(payload)));
      return {
        output: renderBytes(plaintext, plaintextEncoding),
        summary: 'AES-' + keySize + '-GCM 解密成功 · Tag 已认证',
      };
    } catch {
      throw new Error('GCM 认证失败：Key、IV、AAD、Tag、密文或参数不匹配。');
    }
  }

  // Web Crypto AES-CBC uses PKCS#7 padding, equivalent to Java's
  // AES/CBC/PKCS5Padding for a 16-byte AES block.
  const padding = optionText(options, 'padding') as Padding;
  if (action === 'encrypt') {
    const plaintext = parseBytes(request.input, plaintextEncoding, '明文');
    if (padding === 'none' && plaintext.length % CBC_BLOCK_BYTES !== 0) {
      throw new Error('CBC NoPadding 模式的明文长度必须是 16 字节的整数倍。');
    }
    const encrypted = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: Uint8Array.from(iv) }, key, Uint8Array.from(plaintext),
    ));
    // For block-aligned input, CBC's mandatory PKCS#7 block is appended AFTER
    // the requested plaintext. Remove that final encrypted block for NoPadding.
    const raw = padding === 'none' ? encrypted.subarray(0, plaintext.length) : encrypted;
    return {
      output: renderBytes(raw, ciphertextEncoding),
      summary: 'AES-' + keySize + '-CBC ' + (padding === 'none' ? 'NoPadding' : 'PKCS7 / Java PKCS5Padding') + ' 加密完成',
      warnings: [warning],
    };
  }

  const ciphertext = parseBytes(request.input, ciphertextEncoding, '密文');
  if (ciphertext.length % CBC_BLOCK_BYTES !== 0 || (padding === 'pkcs7' && !ciphertext.length)) {
    throw new Error('CBC 密文长度必须是 16 字节的整数倍；PKCS7 密文不能是空字符串。');
  }
  if (padding === 'none' && ciphertext.length === 0) {
    return { output: '', summary: 'AES-' + keySize + '-CBC NoPadding 解密完成', warnings: [warning] };
  }

  let toDecrypt = ciphertext;
  if (padding === 'none') {
    // Web Crypto always removes PKCS#7 padding on CBC decryption. To handle
    // raw NoPadding input, append a synthetic encrypted PKCS#7 block, computed
    // using the LAST original ciphertext block as IV and an empty message.
    // Decrypting this extended message strips only the synthetic padding.
    const lastCipherBlock = ciphertext.subarray(ciphertext.length - CBC_BLOCK_BYTES);
    const synthetic = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: Uint8Array.from(lastCipherBlock) }, key, new Uint8Array(0),
    ));
    toDecrypt = new Uint8Array(ciphertext.length + CBC_BLOCK_BYTES);
    toDecrypt.set(ciphertext);
    toDecrypt.set(synthetic, ciphertext.length);
  }
  let decrypted: Uint8Array;
  try {
    decrypted = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: Uint8Array.from(iv) }, key, Uint8Array.from(toDecrypt),
    ));
  } catch {
    throw new Error('CBC 解密失败：密钥、IV、密文或 Padding 不正确（CBC 不验证完整性）。');
  }
  return {
    output: renderBytes(decrypted, plaintextEncoding),
    summary: 'AES-' + keySize + '-CBC ' + (padding === 'none' ? 'NoPadding' : 'PKCS7 / Java PKCS5Padding') + ' 解密完成',
    warnings: [warning],
  };
}
