import { encodeBase64Bytes, decodeBase64Bytes } from '../core/encoding';

export type BinaryRequest = { action: 'encode'; bytes: Uint8Array; urlSafe: boolean; padding: boolean } | { action: 'decode'; input: string; urlSafe: boolean };

self.addEventListener('message', (event: MessageEvent<BinaryRequest>) => {
  try {
    const request = event.data;
    if (request.action === 'encode') {
      if (request.bytes.length > 5 * 1024 * 1024) throw new Error('单个文件不能超过 5 MiB。');
      self.postMessage({ output: encodeBase64Bytes(request.bytes, request.urlSafe, request.padding) });
    } else {
      if (request.input.length > 8 * 1024 * 1024) throw new Error('Base64 内容过大，请使用小于 5 MiB 的原始文件。');
      const bytes = decodeBase64Bytes(request.input, request.urlSafe);
      if (bytes.length > 5 * 1024 * 1024) throw new Error('解码后的文件不能超过 5 MiB。');
      self.postMessage({ bytes });
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '文件编解码失败。' });
  }
});
