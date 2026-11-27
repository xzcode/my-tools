import { zipSync, zlibSync } from 'fflate';
import { deflateSync } from 'node:zlib';

function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([head, body, tail]);
}
const hdr = Buffer.alloc(13); hdr.writeUInt32BE(2, 0); hdr.writeUInt32BE(2, 4); hdr[8] = 8; hdr[9] = 6;
const pixels = Buffer.from([0,255,0,0,255,255,0,0,255,0,255,0,0,255,255,0,0,255]);
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',hdr),pngChunk('IDAT',deflateSync(pixels)),pngChunk('IEND',Buffer.alloc(0))]);
const layout = {x:0,y:0,width:2,height:2};
const transform = {a:1,b:0,c:0,d:1,tx:0,ty:0};
const frames = [{alpha:1,layout,transform},{alpha:1,layout,transform:{...transform,tx:10}}];
export function legacySvga(): Buffer {
  const spec={version:'1.5',movie:{viewBox:{width:64,height:48},fps:12,frames:2},images:{pixel:'pixel.png'},sprites:[{imageKey:'pixel',frames}]};
  return Buffer.from(zipSync({'movie.spec':Buffer.from(JSON.stringify(spec)),'pixel.png':png}));
}
const varint = (n:number): Buffer => { const bytes:number[]=[]; while(n>127){bytes.push((n&127)|128);n>>>=7;}bytes.push(n);return Buffer.from(bytes); };
const msg = (id:number,b:Buffer) => Buffer.concat([varint(id*8+2),varint(b.length),b]);
const float = (id:number,v:number) => {const b=Buffer.alloc(5);b[0]=id*8+5;b.writeFloatLE(v,1);return b;};
const int = (id:number,v:number) => Buffer.concat([varint(id*8),varint(v)]);
const str = (id:number,v:string) => msg(id,Buffer.from(v));
export function modernSvga(): Buffer {
 const params=Buffer.concat([float(1,64),float(2,48),int(3,12),int(4,2)]);
 const image=Buffer.concat([str(1,'pixel'),msg(2,png)]);
 const fs=frames.map(f=>msg(2,Buffer.concat([float(1,f.alpha),msg(2,Buffer.concat(Object.values(f.layout).map((v,i)=>float(i+1,v)))),msg(3,Buffer.concat(Object.values(f.transform).map((v,i)=>float(i+1,v))))])));
 const sprite=Buffer.concat([str(1,'pixel'),...fs]);
 return Buffer.from(zlibSync(Buffer.concat([str(1,'2.0'),msg(2,params),msg(3,image),msg(4,sprite)])));
}
