import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultOptions, getTool, tools } from '../src/core/catalog';
import { duplicateTab, historyBefore, newToolTab, newWorkspace, restoreUnifiedWorkspace, snapshotWorkspace } from '../src/core/workspace';
import { useWorkspace } from '../src/composables/useWorkspace';
import { initialWorkspace } from '../src/core/aes-workspace';
import { phoneCountries, inspectPhone, processPhone } from '../src/core/phone';
import { prepareSvga, validateSvgaMetadata } from '../src/core/svga';
import { modernSvga, legacySvga } from './fixtures/svga';

describe('unified workspace',()=>{
 it('provides independent tabs for every registered tool',()=>{
   expect(tools).toHaveLength(31);
   for(const tool of tools){const a=newToolTab(tool.id),b=newToolTab(tool.id);a.input='secret';expect(a.id).not.toBe(b.id);expect(b.input).toBe('');expect(b.options).toEqual(defaultOptions(tool));}
 });
 it('does not cap tab counts, templates or history and restores every record',()=>{
   const ws=useWorkspace();
   try {
     for(const toolId of ['json','aes']){
       ws.selectTool(toolId);
       for(let n=1;n<120;n++)expect(ws.create()).toBe(true);
       expect(ws.tabs.value).toHaveLength(120);
       ws.active.value.input=toolId+' fixture';
     }
     for(let n=0;n<40;n++)expect(ws.saveTemplate('Template '+n)).toBe(true);
     for(let n=0;n<240;n++)ws.addHistory(ws.active.value,'run');
     expect(ws.state.value.history).toHaveLength(240);
     ws.state.value.mode='full';
     const restored=restoreUnifiedWorkspace(JSON.stringify(snapshotWorkspace(ws.state.value)));
     expect(restored.tabs).toHaveLength(240);
     expect(restored.history).toHaveLength(240);
     expect(restored.templates).toHaveLength(40);
     for(const id of ['json','aes'])expect(restored.tabs.find(t=>t.id===restored.activeIds[id])?.input).toBe(id+' fixture');
     ws.close(ws.active.value.id);
     expect(ws.tabs.value).toHaveLength(119);
     expect(ws.reopen()).toBe('aes');
     expect(ws.active.value.input).toBe('aes fixture');
     expect(ws.tabs.value).toHaveLength(120);
   }finally{ws.dispose();}
 });
 it('roundtrips a workspace above the former 32 MiB cap without truncation',()=>{
   const w=newWorkspace();w.mode='full';
   const text='x'.repeat(33*1024*1024);
   w.tabs[0]!.input=text;
   const json=JSON.stringify(snapshotWorkspace(w));
   expect(json.length).toBeGreaterThan(32*1024*1024);
   expect(restoreUnifiedWorkspace(json).tabs[0]!.input).toBe(text);
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
 it('rejects invalid files and invalid metadata',()=>{expect(()=>prepareSvga(Buffer.from('bad file'))).toThrow();expect(()=>validateSvgaMetadata({videoSize:{width:10000,height:48},FPS:12,frames:2,sprites:[]})).toThrow();});
});
