import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultOptions, getTool, tools } from '../src/core/catalog';
import { duplicateTab, historyBefore, newToolTab, newWorkspace, restoreUnifiedWorkspace, snapshotWorkspace, OPEN_LIMIT } from '../src/core/workspace';
import { useWorkspace } from '../src/composables/useWorkspace';
import { initialWorkspace } from '../src/core/aes-workspace';
import { phoneCountries, inspectPhone, processPhone } from '../src/core/phone';
import { prepareSvga, validateSvgaMetadata, SVGA_FILE_LIMIT } from '../src/core/svga';
import { modernSvga, legacySvga } from './fixtures/svga';

describe('unified workspace',()=>{
 it('provides independent tabs for all 27 tools',()=>{
   expect(tools).toHaveLength(27);
   for(const tool of tools){const a=newToolTab(tool.id),b=newToolTab(tool.id);a.input='secret';expect(a.id).not.toBe(b.id);expect(b.input).toBe('');expect(b.options).toEqual(defaultOptions(tool));}
 });
 it('allows 100 tabs independently for each tool and restores every tab',()=>{
   const ws=useWorkspace();
   try {
     for(const toolId of ['json','aes']){
       ws.selectTool(toolId);
       for(let n=1;n<OPEN_LIMIT;n++)expect(ws.create()).toBe(true);
       expect(ws.tabs.value).toHaveLength(100);
       expect(ws.create()).toBe(false);
       ws.active.value.input=toolId+' fixture';
     }
     expect(ws.state.value.tabs).toHaveLength(200);
     ws.state.value.mode='full';
     const restored=restoreUnifiedWorkspace(JSON.stringify(snapshotWorkspace(ws.state.value)));
     expect(restored.tabs).toHaveLength(200);
     for(const id of ['json','aes'])expect(restored.tabs.find(t=>t.id===restored.activeIds[id])?.input).toBe(id+' fixture');
     const excess=newToolTab('aes');
     restored.tabs.push(excess);
     expect(()=>restoreUnifiedWorkspace(JSON.stringify(restored))).toThrow('标签数量超限');
     ws.close(ws.active.value.id);
     expect(ws.tabs.value).toHaveLength(99);
     expect(ws.reopen()).toBe('aes');
     expect(ws.active.value.input).toBe('aes fixture');
     expect(ws.tabs.value).toHaveLength(100);
   }finally{ws.dispose();}
 });
 it('metadata-only snapshots exclude payloads, private text options and files, including history',()=>{
   const w=newWorkspace(),t=newToolTab('aes');t.input='SECRET_BODY';t.secondaryInput='SECRET_SECOND';t.options.rawKey='SECRET_KEY';t.options.prefix='SECRET_PREFIX';t.fileName='SECRET_FILE';t.result={output:'SECRET_RESULT'};
   w.tabs.push(t);w.history.push({id:'closed-a',at:10,type:'closed',tab:t});
   const raw=JSON.stringify(snapshotWorkspace(w));expect(raw).not.toContain('SECRET_');
   const r=restoreUnifiedWorkspace(raw);expect(r.history[0]?.tab.input).toBe('');expect(r.tabs[1]?.options.rawKey).toBe('');
   expect(duplicateTab(t).options.rawKey).toBe('');
 });
 it('full-save restores history and file bytes; respects each data selection',()=>{
   const w=newWorkspace(),t=newToolTab('svga');t.input='aGVsbG8=';t.fileName='test.svga';t.result={output:'metadata'};w.mode='full';w.tabs.push(t);w.history.push({id:'run-a',at:100,type:'run',tab:t});
   let r=restoreUnifiedWorkspace(JSON.stringify(snapshotWorkspace(w)));expect(r.history[0]?.tab.input).toBe(t.input);expect(r.tabs[1]?.fileName).toBe(t.fileName);
   w.fields.input=false;r=restoreUnifiedWorkspace(JSON.stringify(snapshotWorkspace(w)));expect(r.history[0]?.tab.input).toBe('');expect(r.tabs[1]?.fileName).toBe('');
 });
 it('migrates existing AES tabs and closed records',()=>{
   const old=initialWorkspace();old.mode='full';old.tabs[0]!.input='saved text';old.closed.push({...old.tabs[0]!,id:'old-closed'});
   const r=restoreUnifiedWorkspace(JSON.stringify(old));expect(r.version).toBe(2);expect(r.tabs.find(t=>t.toolId==='aes')?.input).toBe('saved text');expect(r.history[0]?.type).toBe('closed');
 });
 it('filters history by timestamp and tool',()=>{
   const a=newToolTab('json'),b=newToolTab('phone');const rows=[{id:'a',at:100,type:'closed' as const,tab:a},{id:'b',at:200,type:'run' as const,tab:b},{id:'c',at:300,type:'run' as const,tab:a}];
   expect(historyBefore(rows,250).map(h=>h.id)).toEqual(['a','b']);expect(historyBefore(rows,250,'phone').map(h=>h.id)).toEqual(['b']);
 });
 it('native metadata whitelist matches catalog actions and non-text options',()=>{
   const schema=JSON.parse(readFileSync(new URL('../src-tauri/src/workspace_options.json',import.meta.url),'utf8'));
   for(const tool of tools){expect(schema[tool.id].actions).toEqual(tool.actions.map(a=>a.id));expect(Object.keys(schema[tool.id].options).sort()).toEqual(tool.options.filter(o=>['select','checkbox','number'].includes(o.type)).map(o=>o.key).sort());}
 });
});
describe('international phone validation',()=>{
 it('defaults to China and covers over 200 numbering regions',()=>{expect(phoneCountries.length).toBeGreaterThan(200);expect(phoneCountries[0]).toMatchObject({code:'CN',dial:'+86'});expect(defaultOptions(getTool('phone')!).country).toBe('CN');});
 it('validates mainland China, Malaysia, fixed lines and malformed input',()=>{
   expect(inspectPhone('13800138000','CN')).toMatchObject({valid:true,mobile:'是',e164:'+8613800138000'});
   expect(inspectPhone('0123456789','MY')).toMatchObject({valid:true,e164:'+60123456789'});
   expect(inspectPhone('+442079460958','CN')).toMatchObject({valid:true,mobile:'否',country:'GB'});
   expect(inspectPhone('abc','CN')).toMatchObject({valid:false});
 });
 it('validates lines independently',()=>{const r=processPhone({toolId:'phone',action:'validate',input:'13800138000\n123',options:{country:'CN'}});expect(JSON.parse(r.output).map((v:{valid:boolean})=>v.valid)).toEqual([true,false]);});
});
describe('SVGA preflight',()=>{
 it('accepts generated legacy ZIP and modern zlib files',()=>{expect(prepareSvga(legacySvga()).version).toBe(1);expect(prepareSvga(modernSvga()).version).toBe(2);});
 it('rejects invalid, oversized files and invalid metadata',()=>{expect(()=>prepareSvga(Buffer.from('bad file'))).toThrow();expect(()=>prepareSvga(new Uint8Array(SVGA_FILE_LIMIT+1))).toThrow();expect(()=>validateSvgaMetadata({videoSize:{width:10000,height:48},FPS:12,frames:2,sprites:[]})).toThrow();});
});
