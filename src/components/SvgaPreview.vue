<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FolderOpen, Play, Pause, Square, SkipBack, SkipForward, Trash2, Film, LoaderCircle } from '@lucide/vue';
import type { Player, Parser } from 'svga.lite';
import type { ToolTab } from '../core/workspace';
import type { ToolResult } from '../core/types';
import { decodeBase64Bytes } from '../core/encoding';
import { prepareSvga, validateSvgaMetadata } from '../core/svga';

const props = defineProps<{ tab: ToolTab }>();
const emit = defineEmits<{ (e:'open'):void; (e:'clear'):void; (e:'loaded', tab: ToolTab, value: ToolResult):void }>();
const canvas = ref<HTMLCanvasElement>();
const loading = ref(false), error = ref(''), playing = ref(false), loop = ref(true), frame = ref(0);
const background = ref('checker');
const meta = ref<({ format: string; fileBytes: number } & ReturnType<typeof validateSvgaMetadata>) | null>(null);
const duration = computed(() => meta.value ? meta.value.duration.toFixed(2) : '0.00');
let player: Player | undefined, parser: Parser | undefined, generation = 0;
function dispose() {
  try { parser?.destroy(); } catch { /* malformed parse */ }
  parser = undefined;
  try { player?.destroy(); } catch { /* already disposed */ }
  player = undefined;
}
async function bounded<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([task, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
}
function seek(value: number) {
  if (!player || !meta.value) return;
  try {
    player.pause(); playing.value = false;
    frame.value = Math.min(meta.value.frames - 1, Math.max(0, Math.floor(value)));
    player.currentFrame = frame.value;
    // svga.lite has no public seek API. Its pinned v1.6 renderer draws a
    // specific frame using currentFrame; keep this isolated in this adapter.
    const renderer = (player as Player & { _renderer?: { drawFrame: (index:number)=>void } })._renderer;
    if (!renderer) throw Error('当前播放器不支持逐帧定位。');
    renderer.drawFrame(frame.value);
  } catch (e) { error.value = e instanceof Error ? e.message : '帧定位失败。'; }
}
async function load() {
  const token = ++generation, tab = props.tab;
  dispose(); playing.value = false; loading.value = false; error.value = ''; meta.value = null; frame.value = 0;
  if (!tab.input) return;
  loading.value = true;
  try {
    const bytes = decodeBase64Bytes(tab.input);
    const prepared = prepareSvga(bytes);
    const library = await import('svga.lite');
    if (token !== generation) return;
    // Use parser workers. The library's disableWorker option requires eval,
    // which is deliberately not enabled by the desktop CSP.
    const ParserClass = prepared.version === 1 ? (await import('svga.lite/parser.1x')).default : library.Parser;
    if (token !== generation) return;
    const localParser = new ParserClass(); parser = localParser;
    const data = Uint8Array.from(prepared.bytes).buffer;
    const video = await bounded(localParser.do(data), 12000, 'SVGA 解析超时或格式损坏。');
    if (token !== generation) return;
    localParser.destroy(); parser = undefined;
    const info = validateSvgaMetadata(video);
    // Only embedded raster images are permitted. Audio and arbitrary URLs
    // are not played/loaded; reject unexpected image payloads instead.
    let imageBytes = 0;
    const images = Object.values(video.images ?? {});
    if (images.length > 512) throw Error('SVGA 内嵌图片数量超限。');
    for (const image of images) {
      if (typeof image !== 'string' || !/^(iVBO|\/9j\/2w)/.test(image) || !/^[A-Za-z0-9+/=]+$/.test(image)) throw Error('SVGA 含不支持的内嵌图片格式。');
      imageBytes += image.length;
      if (imageBytes > 48 * 1024 * 1024) throw Error('SVGA 图片数据超限。');
      if (image.startsWith('iVBO')) {
        const header = atob(image.slice(0, 44)); const b = Uint8Array.from(header, c => c.charCodeAt(0));
        const view = new DataView(b.buffer);
        const w = view.getUint32(16), h = view.getUint32(20);
        if (!w || !h || w > 4096 || h > 4096 || w*h > 8_388_608) throw Error('SVGA 内嵌图片尺寸超限。');
      }
    }
    video.dynamicElements = {};
    await nextTick();
    if (token !== generation || !canvas.value) return;
    const localPlayer = new library.Player(canvas.value); player = localPlayer;
    localPlayer.set({ loop: loop.value ? 0 : 1, cacheFrames: false, intersectionObserverRender: false });
    localPlayer.$on('process' as Parameters<Player['$on']>[0], () => { if (token === generation) frame.value = Math.min(info.frames - 1, localPlayer.currentFrame); });
    localPlayer.$on('end' as Parameters<Player['$on']>[0], () => { if (token === generation) playing.value = false; });
    await bounded(localPlayer.mount(video), 12000, 'SVGA 图片或画布初始化失败。');
    if (token !== generation) return;
    meta.value = { ...info, format: String(video.version || prepared.version + '.x'), fileBytes: bytes.length };
    localPlayer.stop(); frame.value = 0;
    const summary = info.width + ' × ' + info.height + ' · ' + info.fps + ' FPS · ' + info.frames + ' 帧';
    emit('loaded', tab, { kind:'json', output:JSON.stringify({ file: tab.fileName, ...meta.value },null,2), summary });
    if (info.frames > 1) { localPlayer.start(); playing.value = true; }
  } catch (e) {
    if (token === generation) { dispose(); meta.value = null; error.value = e instanceof Error ? e.message : String(e || 'SVGA 无法解析。'); }
  } finally { if (token === generation) loading.value = false; }
}
function play() {
  if (!player || !meta.value) return;
  try { if (playing.value) { player.pause(); playing.value = false; } else { if(frame.value >= meta.value.frames - 1) seek(0); player.resume(); playing.value = true; } }
  catch(e) { error.value = e instanceof Error ? e.message : '播放失败。'; }
}
function stop() { if(player && meta.value) { player.stop(); playing.value=false; frame.value=0; } }
watch(loop, value => { if(player) player.loop = value ? 0 : 1; });
onMounted(() => { void load(); });
watch(() => props.tab.input, () => { void load(); }, { flush:'post' });
onBeforeUnmount(() => { generation++; dispose(); });
</script>
<template>
  <div class="svga-preview">
    <div class="svga-toolbar"><button class="secondary-button" type="button" @click="emit('open')"><FolderOpen :size="16"/>打开 SVGA 文件</button><span class="file-name">{{ tab.fileName || '未选择文件' }}</span><button v-if="tab.input" type="button" class="small-action" @click="emit('clear')"><Trash2 :size="14"/>清空</button></div>
    <div class="svga-layout">
      <div class="svga-stage" :data-background="background">
        <canvas v-show="meta" ref="canvas" aria-label="SVGA 动画画布"></canvas>
        <div v-if="loading" class="svga-empty"><LoaderCircle :size="30" class="spin"/><strong>正在解析本地动画…</strong></div>
        <div v-else-if="!meta" class="svga-empty"><Film :size="38"/><strong>{{ error ? '无法预览该文件' : '打开或拖入 .svga 文件' }}</strong><span>{{ error || '支持 SVGA 1.x / 2.x · 本地文件' }}</span><button v-if="!tab.input" type="button" class="small-action" @click="emit('open')">选择本地文件</button></div>
      </div>
      <div class="svga-info">
        <strong>动画属性</strong>
        <dl><dt>版本</dt><dd>{{ meta?.format ?? '—' }}</dd><dt>画布</dt><dd>{{ meta ? meta.width + ' × ' + meta.height + ' px' : '—' }}</dd><dt>帧率</dt><dd>{{ meta ? meta.fps + ' FPS' : '—' }}</dd><dt>总帧数</dt><dd>{{ meta?.frames ?? '—' }}</dd><dt>时长</dt><dd>{{ meta ? duration + ' s' : '—' }}</dd><dt>图层</dt><dd>{{ meta?.layers ?? '—' }}</dd><dt>文件大小</dt><dd>{{ meta ? (meta.fileBytes / 1024).toFixed(1) + ' KiB' : '—' }}</dd></dl>
        <label>背景<select v-model="background" aria-label="预览背景"><option value="checker">透明棋盘格</option><option value="white">白色</option><option value="dark">深色</option></select></label>
        <label class="loop-control"><input v-model="loop" type="checkbox"/>循环播放</label>
        <small>仅在设备上处理。当前播放器不支持音频。</small>
      </div>
    </div>
    <div class="svga-controls">
      <button type="button" class="icon-button" aria-label="上一帧" :disabled="!meta" @click="seek(frame-1)"><SkipBack :size="16"/></button>
      <button type="button" class="primary-button" :aria-label="playing?'暂停动画':'播放动画'" :disabled="!meta" @click="play"><Pause v-if="playing" :size="15"/><Play v-else :size="15"/>{{ playing ? '暂停' : '播放' }}</button>
      <button type="button" class="icon-button" aria-label="停止动画" :disabled="!meta" @click="stop"><Square :size="16"/></button>
      <button type="button" class="icon-button" aria-label="下一帧" :disabled="!meta" @click="seek(frame+1)"><SkipForward :size="16"/></button>
      <input type="range" aria-label="动画帧进度" min="0" :max="Math.max(0,(meta?.frames??1)-1)" :value="frame" :disabled="!meta" @input="seek(Number(($event.target as HTMLInputElement).value))"/>
      <span class="frame-label">{{ meta ? frame + 1 : 0 }} / {{ meta?.frames ?? 0 }} 帧</span>
    </div>
    <p v-if="error && meta" class="svga-error" role="status">{{ error }}</p>
  </div>
</template>
<style scoped>
.svga-toolbar {display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)}
.file-name {flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--secondary);font-size:12px}
.svga-layout {display:grid;grid-template-columns:minmax(0,1fr) 205px;min-height:360px}
.svga-stage {position:relative;min-height:360px;display:flex;align-items:center;justify-content:center;overflow:hidden;background-color:#eee;background-image:conic-gradient(#d5d5d5 25%,#eee 0 50%,#d5d5d5 0 75%,#eee 0);background-size:20px 20px}
.svga-stage[data-background=white]{background:#fff}.svga-stage[data-background=dark]{background:#25272b}
.svga-stage canvas{display:block;max-width:100%;max-height:500px;object-fit:contain}
.svga-empty {display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--secondary);max-width:85%;text-align:center}
.svga-empty strong{color:var(--text)}.svga-empty span{font-size:12px;overflow-wrap:anywhere}
.svga-info{padding:16px;border-left:1px solid var(--border);display:flex;flex-direction:column;gap:12px}
.svga-info dl{display:grid;grid-template-columns:1fr auto;gap:10px 6px;margin:0;font-size:12px}.svga-info dt{color:var(--secondary)}.svga-info dd{margin:0;text-align:right;overflow-wrap:anywhere}
.svga-info label:not(.loop-control){display:flex;align-items:center;justify-content:space-between;gap:5px;font-size:12px}
.svga-info select{border:1px solid var(--border);border-radius:5px;padding:5px;background:var(--input);color:var(--text);max-width:130px}
.loop-control{display:flex;align-items:center;gap:6px;font-size:12px}.svga-info small{color:var(--muted);line-height:1.6}
.svga-controls{display:flex;align-items:center;gap:8px;padding:12px 15px;border-top:1px solid var(--border)}.svga-controls input[type=range]{flex:1;min-width:50px}.frame-label{white-space:nowrap;font-size:12px;color:var(--secondary)}.svga-error{padding:0 16px;color:var(--danger)}
@media(max-width:750px){.svga-layout{grid-template-columns:1fr}.svga-info{border-left:0;border-top:1px solid var(--border)}}
</style>
