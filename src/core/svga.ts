import { Unzip, UnzipInflate, Unzlib, zipSync } from 'fflate';

export const SVGA_FILE_LIMIT = 5 * 1024 * 1024;
export const SVGA_EXPANDED_LIMIT = 32 * 1024 * 1024;
export interface PreparedSvga { version: 1 | 2; bytes: Uint8Array; expanded: number }

// Bound actual inflation, not merely the untrusted size advertised by ZIP headers.
// Normalize legacy ZIP archives so the downstream parser sees only validated entries.
export function prepareSvga(bytes: Uint8Array): PreparedSvga {
  if (bytes.length < 4 || bytes.length > SVGA_FILE_LIMIT) throw Error('SVGA 文件为空、格式无效或超过 5 MiB。');
  let expanded = 0;
  function account(size: number) {
    expanded += size;
    if (expanded > SVGA_EXPANDED_LIMIT) throw Error('SVGA 解压数据超过 32 MiB，已停止预览。');
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) {
    const files: Record<string, Uint8Array> = Object.create(null);
    const seen = new Set<string>();
    const unzip = new Unzip(file => {
      const name = file.name;
      if (seen.size >= 512 || seen.has(name) || !/^[\w .-]{1,200}$/.test(name) || name === '.' || name === '..') throw Error('SVGA ZIP 含无效或过多的文件。');
      if (!/^(movie\.spec|movie\.binary|[\w .-]+\.(png|jpe?g|webp|mp3|aac|wav))$/i.test(name)) throw Error('SVGA ZIP 含不支持的文件类型。');
      if ((file.originalSize ?? 0) > SVGA_EXPANDED_LIMIT || ![0, 8].includes(file.compression)) throw Error('SVGA ZIP 数据超限或压缩格式不支持。');
      seen.add(name);
      const parts: Uint8Array[] = []; let size = 0;
      file.ondata = (error, data, final) => {
        if (error) throw error;
        account(data.length); size += data.length;
        parts.push(data);
        if (final) {
          const merged = new Uint8Array(size); let offset = 0;
          for (const part of parts) { merged.set(part, offset); offset += part.length; }
          files[name] = merged;
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    for (let i = 0; i < bytes.length; i += 8192) unzip.push(bytes.subarray(i, i + 8192), i + 8192 >= bytes.length);
    if (Object.keys(files).length !== seen.size || !files['movie.spec']) throw Error('SVGA 1.x ZIP 缺少完整的 movie.spec。');
    const spec = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['movie.spec']));
    if (!spec || typeof spec !== 'object' || !spec.movie || !Array.isArray(spec.sprites)) throw Error('SVGA 1.x 动画描述无效。');
    return { version: 1, bytes: zipSync(files, { level: 0 }), expanded };
  }
  if ((bytes[0]! & 15) !== 8 || ((bytes[0]! << 8) + bytes[1]!) % 31 !== 0) throw Error('无法识别 SVGA 1.x ZIP 或 2.x Zlib 格式。');
  const inflate = new Unzlib(data => account(data.length));
  for (let i = 0; i < bytes.length; i += 8192) inflate.push(bytes.subarray(i, i + 8192), i + 8192 >= bytes.length);
  if (!expanded) throw Error('SVGA 2.x 动画数据为空。');
  return { version: 2, bytes, expanded };
}
export function validateSvgaMetadata(video: { videoSize: { width: number; height: number }; FPS: number; frames: number; sprites?: unknown[] }) {
  const width = Number(video?.videoSize?.width), height = Number(video?.videoSize?.height);
  const fps = Number(video?.FPS), frames = Number(video?.frames);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 8_388_608 ||
      !Number.isInteger(frames) || frames < 1 || frames > 3600 || !Number.isFinite(fps) || fps < 1 || fps > 120 ||
      !Array.isArray(video.sprites) || video.sprites.length > 512) throw Error('SVGA 尺寸、帧率、帧数或图层数量超出安全预览范围。');
  return { width, height, fps, frames, duration: frames / fps, layers: video.sprites.length };
}
