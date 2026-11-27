import { encodeBase64Bytes, decodeBase64Bytes } from '../core/encoding';

export type BinaryRequest = { action: 'encode'; bytes: Uint8Array; urlSafe: boolean; padding: boolean } | { action: 'decode'; input: string; urlSafe: boolean };

self.addEventListener('message', (event: MessageEvent<BinaryRequest>) => {
  try {
    const request = event.data;
    if (request.action === 'encode') {
      self.postMessage({ output: encodeBase64Bytes(request.bytes, request.urlSafe, request.padding) });
    } else {
      const bytes = decodeBase64Bytes(request.input, request.urlSafe);
      self.postMessage({ bytes });
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '文件编解码失败。' });
  }
});
