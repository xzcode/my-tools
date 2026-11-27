import { computed, nextTick, ref, watch } from 'vue';
import { isNativeCrypto } from '../core/crypto-catalog';
import { executeCrypto } from '../platform/crypto-tools';
import { getTool } from '../core/catalog';
import { newWorkspace, newToolTab, duplicateTab, clone, toolDefaults, safeOptions, tabName, snapshotWorkspace, restoreUnifiedWorkspace, historyBefore, builtInTemplates } from '../core/workspace';
import type { ToolTab, HistoryEntry, SaveMode } from '../core/workspace';
import type { ToolResult, ToolRequest } from '../core/types';
import { useToolRunner } from './useToolRunner';
import { useBinaryRunner } from './useBinaryRunner';
import { loadAesWorkspace, saveAesWorkspace, clearAesWorkspace } from '../platform/aes-workspace';

type Runner = ReturnType<typeof useToolRunner>;
type BinaryRunner = ReturnType<typeof useBinaryRunner>;
export function useWorkspace() {
  const state = ref(newWorkspace()), toolId = ref('json'), ready = ref(false), restored = ref(false), blocked = ref(false);
  const saveStatus = ref<'idle'|'pending'|'saving'|'saved'|'error'>('idle'), saveError = ref('');
  const jobs = ref<string[]>([]), batchJobs=ref<string[]>([]), binaryJobs=ref<string[]>([]);
  const runners=new Map<string,Runner>(), binaryRunners=new Map<string,BinaryRunner>(), tokens=new Map<string,number>();
  const tabs=computed(()=>state.value.tabs.filter(t=>t.toolId===toolId.value));
  const active=computed(()=>tabs.value.find(t=>t.id===state.value.activeIds[toolId.value])??tabs.value[0]!);
  const running=computed(()=>!!active.value&&jobs.value.includes(active.value.id));
  const batchRunning=computed(()=>!!active.value&&batchJobs.value.includes(active.value.id));
  const binaryBusy=computed(()=>!!active.value&&binaryJobs.value.includes(active.value.id));
  const closed=computed(()=>state.value.history.filter(h=>h.tab.toolId===toolId.value&&h.type==='closed'));
  const templates=computed(()=>[...builtInTemplates,...state.value.templates]);
  let timer:ReturnType<typeof setTimeout>|undefined, queue:Promise<void>=Promise.resolve();
  let revision=0,lastSaved=-1,paused=false;
  function selectTool(id:string) {
    if(!getTool(id)) return;
    if(!state.value.tabs.some(t=>t.toolId===id)) {
      // Each tool gets its own independent tab allowance.
      const t=newToolTab(id);state.value.tabs.push(t);state.value.activeIds[id]=t.id;
    }
    toolId.value=id;
  }
  async function initialize() {
    try {
      const saved=await loadAesWorkspace();
      if(saved){ state.value=restoreUnifiedWorkspace(saved);restored.value=true; }
      selectTool('json');
      saveStatus.value=saved?'saved':'idle';
    } catch(e){blocked.value=true;saveError.value=e instanceof Error?e.message:String(e);saveStatus.value='error';}
    finally{ready.value=true;}
  }
  function schedule(){
    if(!ready.value||paused||blocked.value)return;
    revision++;saveStatus.value='pending';clearTimeout(timer);timer=setTimeout(()=>{void flush();},500);
  }
  // Coalesce deep traversal across synchronous edits, including close-many operations.
  watch(state,schedule,{deep:true,flush:'pre'});
  watch([()=>active.value?.id,()=>active.value?.input,()=>active.value?.secondaryInput,()=>active.value?.action,()=>active.value?.options],([id],[old])=>{
    if(!active.value||id!==old)return;
    if(active.value.result)active.value.stale=true;active.value.error='';
  },{deep:true,flush:'sync'});
  async function flush():Promise<boolean>{
    // Observe all pending edits before deciding if the previous snapshot is current.
    await nextTick();
    clearTimeout(timer);
    if(!ready.value||paused)return true;
    if(blocked.value)return false;
    const at=revision;if(lastSaved===at&&saveStatus.value==='saved')return true;
    let json:string;
    try{json=JSON.stringify(snapshotWorkspace(state.value));}
    catch(e){saveError.value=e instanceof Error?e.message:String(e);saveStatus.value='error';return false;}
    saveStatus.value='saving';
    const task=queue.catch(()=>undefined).then(()=>saveAesWorkspace(json));queue=task;
    try{await task;lastSaved=at;if(revision===at){saveStatus.value='saved';saveError.value='';}return true;}
    catch(e){saveStatus.value='error';saveError.value=e instanceof Error?e.message:String(e);return false;}
  }
  async function flushLatest(){
    for(let i=0;i<4;i++){await nextTick();const at=revision;if(!await flush())return false;await nextTick();if(at===revision)return true;}
    saveStatus.value='error';saveError.value='工作台仍在变化，请停止任务后重试。';return false;
  }
  async function setMode(mode:SaveMode){
    if(blocked.value)return false;
    const previous=state.value.mode;state.value.mode=mode;
    if(await flushLatest())return true;
    state.value.mode=previous;await nextTick();clearTimeout(timer);saveStatus.value='error';return false;
  }
  function select(id:string){const t=state.value.tabs.find(t=>t.id===id);if(t){state.value.activeIds[t.toolId]=id;toolId.value=t.toolId;}}
  function canCreate(id=toolId.value){return !!getTool(id);}
  function create(){
    if(!canCreate())return false;
    let n=1;while(tabs.value.some(t=>t.name===tabName(toolId.value,n)))n++;
    const t=newToolTab(toolId.value,tabName(toolId.value,n));state.value.tabs.push(t);select(t.id);return true;
  }
  function rename(id:string,name:string){const t=state.value.tabs.find(t=>t.id===id);name=name.trim().slice(0,100);if(!t||!name)return false;t.name=name;return true;}
  function duplicate(id:string){const t=state.value.tabs.find(t=>t.id===id);if(!t||!canCreate(t.toolId))return false;const copy=duplicateTab(t);state.value.tabs.splice(state.value.tabs.indexOf(t)+1,0,copy);select(copy.id);return true;}
  function stop(id=active.value.id){
    tokens.set(id,(tokens.get(id)??0)+1);
    runners.get(id)?.cancel();binaryRunners.get(id)?.cancelBinary();
    jobs.value=jobs.value.filter(x=>x!==id);batchJobs.value=batchJobs.value.filter(x=>x!==id);binaryJobs.value=binaryJobs.value.filter(x=>x!==id);
    const t=state.value.tabs.find(t=>t.id===id);t?.batch.forEach(b=>{if(b.state==='running'){b.state='error';b.error='已取消';}});
  }
  function addHistory(tab:ToolTab,type:HistoryEntry['type']){
    const entry:HistoryEntry={id:crypto.randomUUID(),at:Date.now(),type,tab:clone(tab)};
    entry.tab.batch=entry.tab.batch.map(b=>({...b,state:b.state==='running'?'waiting':b.state}));
    state.value.history.unshift(entry);
  }
  function close(id:string){
    const t=state.value.tabs.find(t=>t.id===id);if(!t)return;
    const siblings=state.value.tabs.filter(x=>x.toolId===t.toolId),pos=siblings.indexOf(t);
    stop(id);runners.delete(id);binaryRunners.delete(id);tokens.delete(id);addHistory(t,'closed');
    const next=state.value.tabs.filter(x=>x.id!==id);
    const left=next.filter(x=>x.toolId===t.toolId);
    if(!left.length){const replacement=newToolTab(t.toolId);next.push(replacement);state.value.activeIds[t.toolId]=replacement.id;}
    else if(state.value.activeIds[t.toolId]===id)state.value.activeIds[t.toolId]=left[Math.min(pos,left.length-1)]!.id;
    state.value.tabs=next;
  }
  function closeOthers(id:string,right=false){
    const current=tabs.value;const i=current.findIndex(t=>t.id===id);if(i<0)return;select(id);
    for(const t of right?current.slice(i+1):current.filter(t=>t.id!==id))close(t.id);
  }
  function restoreHistory(id:string){
    const h=state.value.history.find(x=>x.id===id);if(!h||!canCreate(h.tab.toolId))return null;
    const t=clone(h.tab);t.id=crypto.randomUUID();t.error='';state.value.tabs.push(t);select(t.id);return t.toolId;
  }
  function reopen(){const h=closed.value[0];return h?restoreHistory(h.id):null;}
  function removeHistory(id:string){state.value.history=state.value.history.filter(h=>h.id!==id);}
  function clearHistory(cutoff?:number,filter?:string){
    const ids=new Set(cutoff===undefined?state.value.history.filter(h=>!filter||h.tab.toolId===filter).map(h=>h.id):historyBefore(state.value.history,cutoff,filter).map(h=>h.id));
    state.value.history=state.value.history.filter(h=>!ids.has(h.id));return ids.size;
  }
  function reorder(source:string,target:string){
    const a=[...state.value.tabs],from=a.findIndex(x=>x.id===source),to=a.findIndex(x=>x.id===target);
    if(from<0||to<0||from===to||a[from]!.toolId!==a[to]!.toolId)return;
    const t=a.splice(from,1)[0]!;a.splice(to,0,t);state.value.tabs=a;
  }
  function moveSelection(direction:number){const i=tabs.value.findIndex(t=>t.id===active.value.id);select(tabs.value[(i+direction+tabs.value.length)%tabs.value.length]!.id);}
  function applyTemplate(id:string){const t=templates.value.find(x=>x.id===id);if(t&&toolId.value==='aes')active.value.options={...active.value.options,...t.options,iv:'',aad:''};}
  function saveTemplate(name:string,id?:string){
    name=name.trim().slice(0,100);if(!name||toolId.value!=='aes')return false;
    const opts=safeOptions('aes',active.value.options),t=state.value.templates.find(x=>x.id===id);
    if(t){t.name=name;t.options=opts;return true;}
    state.value.templates.push({id:crypto.randomUUID(),name,options:opts});return true;
  }
  function removeTemplate(id:string){state.value.templates=state.value.templates.filter(t=>t.id!==id);}
  function clearActive(){
    const t=active.value;stop(t.id);t.input='';t.secondaryInput='';t.result=null;t.error='';t.stale=false;t.elapsed=0;t.outputView='text';t.fileName='';t.binarySourceName='';t.batch=[];t.batchVisible=false;
    for(const k of ['key','password','rawKey','iv','aad','keyPassphrase','exportPassphrase','signature'])if(k in t.options)t.options[k]='';
  }
  function requestFor(t:ToolTab):ToolRequest{return{toolId:t.toolId,action:t.action,input:t.input,secondaryInput:t.secondaryInput,options:{...t.options}};}
  function runnerFor(id:string){let r=runners.get(id);if(!r){r=useToolRunner();runners.set(id,r);}return r;}
  function live(t:ToolTab,token:number){return tokens.get(t.id)===token&&state.value.tabs.some(x=>x.id===t.id);}
  function begin(t:ToolTab){const n=(tokens.get(t.id)??0)+1;tokens.set(t.id,n);jobs.value=[...jobs.value,t.id];return n;}
  function busy(t:ToolTab){return jobs.value.includes(t.id)||batchJobs.value.includes(t.id)||binaryJobs.value.includes(t.id);}
  async function runActive(){
    const t=active.value;if(busy(t)||t.toolId==='svga')return;
    const req=requestFor(t);
    const before=clone(t),token=begin(t),start=performance.now();t.error='';if(t.result)t.stale=true;
    try{
      const result=await (isNativeCrypto(t.toolId)?executeCrypto(req):runnerFor(t.id).run(req));if(!live(t,token))return;
      t.result=result;t.stale=JSON.stringify(req)!==JSON.stringify(requestFor(t));t.elapsed=Math.max(1,Math.round(performance.now()-start));t.outputView=result.diff?'diff':'text';
      addHistory({...before,result,stale:false,error:'',elapsed:t.elapsed,outputView:t.outputView},'run');
    }catch(e){if(live(t,token))t.error=e instanceof Error?e.message:String(e);}
    finally{if(live(t,token))jobs.value=jobs.value.filter(x=>x!==t.id);}
  }
  async function runBatch(t=active.value){
    if(!t.batch.length||busy(t))return;
    const token=(tokens.get(t.id)??0)+1;tokens.set(t.id,token);batchJobs.value=[...batchJobs.value,t.id];
    const req=requestFor(t);
    for(const item of t.batch){item.state='waiting';item.output=undefined;item.error=undefined;}
    for(const item of t.batch){
      if(!live(t,token))break;item.state='running';
      try{const value=await runnerFor(t.id).run({...req,input:item.input});if(!live(t,token))break;
        item.output=value.output;item.state='done';
      }catch(e){if(!live(t,token))break;item.error=e instanceof Error?e.message:String(e);item.state='error';}
    }
    if(live(t,token)){batchJobs.value=batchJobs.value.filter(x=>x!==t.id);addHistory(t,'run');}
  }
  function binaryRunnerFor(id:string){let r=binaryRunners.get(id);if(!r){r=useBinaryRunner();binaryRunners.set(id,r);}return r;}
  async function runBinary(t:ToolTab,request:Parameters<BinaryRunner['runBinary']>[0]){
    if(busy(t))throw Error('当前标签正在处理任务。');const token=(tokens.get(t.id)??0)+1;tokens.set(t.id,token);binaryJobs.value=[...binaryJobs.value,t.id];
    try{const result=await binaryRunnerFor(t.id).runBinary(request);return live(t,token)?result:undefined;}
    finally{if(live(t,token))binaryJobs.value=binaryJobs.value.filter(x=>x!==t.id);}
  }
  function recordResult(t:ToolTab,result:ToolResult){if(!state.value.tabs.some(x=>x.id===t.id))return;t.result=result;t.stale=false;addHistory(t,'run');}
  async function erase(){
    paused=true;clearTimeout(timer);await queue.catch(()=>undefined);
    try{const warning=await clearAesWorkspace();for(const t of state.value.tabs)stop(t.id);runners.clear();binaryRunners.clear();tokens.clear();const fresh=newWorkspace();if(toolId.value!=='json'){const t=newToolTab(toolId.value);fresh.tabs.push(t);fresh.activeIds[t.toolId]=t.id;}state.value=fresh;blocked.value=false;lastSaved=-1;saveStatus.value=warning?'error':'idle';saveError.value=warning??'';return true;}
    catch(e){saveStatus.value='error';saveError.value=e instanceof Error?e.message:String(e);return false;}finally{await nextTick();paused=false;}
  }
  function dispose(){paused=true;clearTimeout(timer);for(const t of state.value.tabs)stop(t.id);runners.clear();binaryRunners.clear();}
  return {state,toolId,tabs,active,running,batchRunning,binaryBusy,closed,templates,jobs,batchJobs,binaryJobs,ready,restored,blocked,saveStatus,saveError,
    initialize,flush,flushLatest,setMode,selectTool,select,create,canCreate,rename,duplicate,stop,close,closeOthers,reopen,restoreHistory,removeHistory,clearHistory,reorder,moveSelection,applyTemplate,saveTemplate,removeTemplate,clearActive,runActive,runBatch,runBinary,recordResult,addHistory,erase,dispose,defaults:toolDefaults};
}
