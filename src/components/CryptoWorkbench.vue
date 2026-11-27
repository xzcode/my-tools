<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { FolderOpen, KeyRound, Copy, Download, Play, Eye, EyeOff, RefreshCw, ShieldCheck, Trash2 } from '@lucide/vue';
import { getTool } from '../core/catalog';
import type { ToolTab } from '../core/workspace';
import type { ToolOption } from '../core/types';
import { encodeBase64Bytes } from '../core/encoding';
import { isDesktop, openBinaryFile, writeClipboard, saveTextFile } from '../platform/desktop';
import { getKeyDirectory, chooseKeyDirectory, saveKeys, listKeys, readKey, openKeyDirectory, renameKeySet, deleteKeySet, type KeyFile, type KeySet } from '../platform/crypto-tools';

const props=defineProps<{tab:ToolTab; running:boolean}>();
const emit=defineEmits<{(e:'run'):void;(e:'clear'):void}>();
const tool=computed(()=>getTool(props.tab.toolId)!);
const desktop=isDesktop(), directory=ref(''), savedDirectory=ref(''), savedName=ref(''), sets=ref<KeySet[]>([]);
const selectedSet=ref(''), selectedFile=ref(''), libraryOpen=ref(false), notice=ref(''), error=ref(''), saving=ref(false);
const revealed=ref<Record<string,boolean>>({});
const manageAction=ref<'rename'|'delete'|''>(''),manageName=ref('');
const managedSet=computed(()=>sets.value.find(s=>s.name===selectedSet.value)?.managed===true);
const managing=ref(false);
const opts=computed(()=>props.tab.options);
const isGen=computed(()=>props.tab.toolId==='keygen');
const isSignature=computed(()=>props.tab.toolId==='signature');
const isCert=computed(()=>props.tab.toolId==='certificate');
const isStore=computed(()=>props.tab.toolId==='keystore');
const certGenerate=computed(()=>isCert.value&&['csr','self-sign'].includes(props.tab.action));
const certVerify=computed(()=>isCert.value&&props.tab.action==='verify-chain');
const alg=computed(()=>String(opts.value.algorithm??''));
const isSecretGen=computed(()=>/^(AES-|SM4$|ChaCha20$|HMAC$)/.test(alg.value));
const aead=computed(()=>alg.value.endsWith('-GCM')||alg.value.endsWith('ChaCha20-Poly1305'));
const keyInput=computed(()=>['keycheck','signature','asymmetric'].includes(props.tab.toolId)||certGenerate.value||certVerify.value||(isStore.value&&props.tab.action==='pack'));
const inputKey=computed(()=>['keyconvert','keycheck'].includes(props.tab.toolId)||(isCert.value&&!certGenerate.value)||(isStore.value&&props.tab.action==='pack'));
const needsInput=computed(()=>!isGen.value&&!certGenerate.value);
const inputLabel=computed(()=>props.tab.toolId==='keycheck'?'公钥 / 证书':props.tab.toolId==='keyconvert'?'待转换密钥 / 证书':isCert.value?'X.509 证书':isStore.value?(props.tab.action==='pack'?'叶证书及证书链 PEM':'密钥容器（Base64 / Hex）'):isSignature.value?'原始报文 / 待签名内容':props.tab.toolId==='kdf'?'口令 / 输入密钥':'输入内容');
const secondaryLabel=computed(()=>props.tab.toolId==='keycheck'?'私钥':props.tab.toolId==='signature'?(props.tab.action==='sign'?'签名私钥':'验签公钥 / 证书'):props.tab.toolId==='asymmetric'?(props.tab.action==='encrypt'?'加密公钥 / 证书':'解密私钥'):certVerify.value?'中间证书 PEM（可选）':isStore.value?'待打包私钥':'证书签发私钥');
const outputObject=computed(()=>{try{return JSON.parse(props.tab.result?.output??'null') as Record<string,unknown>|null;}catch{return null;}});
const files=computed<KeyFile[]>(()=>Array.isArray(outputObject.value?.files)?outputObject.value.files as KeyFile[]:[]);
const visibleOptions=computed(()=>tool.value.options.filter((option:ToolOption)=>{
 const k=option.key, id=tool.value.id;
 if(k==='signature')return isSignature.value&&props.tab.action==='verify';
 if(id==='keygen'){
   if(k==='bits')return alg.value==='RSA';
   if(k==='randomBytes')return alg.value==='HMAC';
   if(k==='secretEncoding')return isSecretGen.value;
   if(['privateFormat','publicFormat','fileEncoding','exportPassphrase'].includes(k))return !isSecretGen.value;
 }
 if(id==='keyconvert'&&props.tab.action==='extract-public'&&['privateFormat','exportPassphrase'].includes(k))return false;
 if(isSignature.value){
   if(['mgfDigest','saltLength'].includes(k))return String(opts.value.signatureAlgorithm).startsWith('RSA-PSS-');
   if(['sm2UserId','sm2IdEncoding'].includes(k))return opts.value.signatureAlgorithm==='SM2-SM3';
   if(k==='responseField')return opts.value.messageMode==='json-response';
   if(k==='signatureField')return opts.value.messageMode!=='raw';
   if(['sortFields','skipEmpty','excludeFields','kvSeparator','joinSeparator'].includes(k))return ['query','query-decoded','json-params'].includes(String(opts.value.messageMode));
   if(k==='keyPassphrase')return props.tab.action==='sign';
 }
 if(id==='asymmetric'){
   if(['oaepDigest','mgfDigest','oaepLabel'].includes(k))return alg.value==='RSA-OAEP';
   if(k==='keyPassphrase')return props.tab.action==='decrypt';
 }
 if(id==='symmetric'){
   if(['iv','ivEncoding'].includes(k))return !alg.value.endsWith('-ECB');
   if(k==='padding')return /-(CBC|ECB)$/.test(alg.value);
   if(['aad','aadEncoding'].includes(k))return aead.value;
 }
 if(id==='crypto-hash'&&['keyEncoding','rawKey'].includes(k))return props.tab.action==='hmac'&&!['CRC32','BLAKE3'].includes(alg.value);
 if(id==='kdf'){
   if(k==='iterations')return alg.value==='PBKDF2';
   if(k==='digest')return alg.value==='PBKDF2'||alg.value==='HKDF';
   if(['info','infoEncoding'].includes(k))return alg.value==='HKDF';
   if(k.startsWith('scrypt'))return alg.value==='scrypt';
   if(['memoryKiB','timeCost','parallelism'].includes(k))return alg.value==='Argon2id';
 }
 if(isCert.value){
   if(k==='keyPassphrase')return certGenerate.value;
   if(['commonName','organization','organizationalUnit','countryCode','keyName','sanDns','sanIp'].includes(k))return certGenerate.value;
   if(['validDays','isCa'].includes(k))return props.tab.action==='self-sign';
   if(['trustRoots','verifyHost'].includes(k))return certVerify.value;
 }
 if(isStore.value){
   if(k==='entryPassphrase')return opts.value.storeFormat==='JKS'&&props.tab.action!=='inspect';
   if(k==='alias')return props.tab.action==='pack'||(opts.value.storeFormat==='JKS'&&props.tab.action==='extract');
   if(['keyEncoding','keyPassphrase'].includes(k))return props.tab.action==='pack';
   if(k==='storeEncoding')return props.tab.action!=='pack';
   if(k==='exportPassphrase')return props.tab.action==='extract';
   if(k==='keyName')return props.tab.action!=='inspect';
 }
 return true;
}));
function setOption(key:string,value:string|number|boolean){props.tab.options[key]=value;}
function setAction(value:string){props.tab.action=value;}
async function importRoots(){const file=await attempt(()=>openBinaryFile());if(!file)return;const data=Uint8Array.from(file.bytes);try{const text=new TextDecoder('utf-8',{fatal:true}).decode(data).trim();if(text.startsWith('-----BEGIN CERTIFICATE-----')){props.tab.options.trustRoots=text;return;}}catch{}props.tab.options.trustRoots=encodeBase64Bytes(data);}
function msg(reason:unknown){return reason instanceof Error?reason.message:String(reason);}
async function attempt<T>(fn:()=>Promise<T>):Promise<T|undefined>{error.value='';try{return await fn();}catch(e){error.value=msg(e);return undefined;}}
async function refresh(){
 if(!desktop)return;
 const dir=await attempt(getKeyDirectory);if(dir!==undefined)directory.value=dir;
 const values=await attempt(listKeys);if(values)sets.value=values;
}
async function chooseDirectory(){
 const dir=await attempt(chooseKeyDirectory);if(dir){directory.value=dir;savedDirectory.value='';savedName.value='';await refresh();notice.value='默认保存目录已更新，下次启动仍会使用。';}
}
async function save(){
 if(!files.value.length)return;
 const name=String(opts.value.keyName??'').trim();
 if(!name){error.value='请输入密钥 / 文件夹名称';return;}
 saving.value=true;
 try{const path=await attempt(()=>saveKeys(name,files.value));if(path){savedDirectory.value=path;savedName.value=name;notice.value='已保存到 '+path;await refresh();}}
 finally{saving.value=false;}
}
async function importInput(target:'input'|'secondaryInput'|'signature',asKey=false){
 const tab=props.tab, file=await attempt(()=>openBinaryFile());
 if(!file)return;
 const data=Uint8Array.from(file.bytes);
 let value=encodeBase64Bytes(data);
 if(asKey){
   try{
     const decoded=new TextDecoder('utf-8',{fatal:true}).decode(data).trim();
     if(decoded.startsWith('-----BEGIN ')||decoded.startsWith('{')||decoded.startsWith('ssh-')||/^[A-Za-z0-9+/=\s]+$/.test(decoded))value=decoded;
   }catch{/* binary DER, already encoded */}
   tab.options.keyEncoding='auto';
 }else if(target==='signature'){
   tab.options.signatureEncoding='base64';
 }else if(tab.toolId==='keystore'&&tab.action!=='pack'){
   tab.options.storeEncoding='base64';
 }else{
   if(['asymmetric','symmetric'].includes(tab.toolId)&&tab.action==='decrypt')tab.options.outputEncoding='base64';
   else tab.options.dataEncoding='base64';
   if(tab.toolId==='signature')tab.options.messageMode='raw';
 }
 if(target==='signature')tab.options.signature=value;else tab[target]=value;
 notice.value='已导入 '+file.name;
}
async function importLibrary(target:'input'|'secondaryInput'){
 if(!selectedSet.value||!selectedFile.value)return;
 const value=await attempt(()=>readKey(selectedSet.value,selectedFile.value));
 if(value!==undefined){props.tab[target]=value;props.tab.options.keyEncoding='auto';if(isStore.value&&props.tab.action!=='pack')props.tab.options.storeEncoding='base64';notice.value='已从本地密钥库导入 '+selectedFile.value;libraryOpen.value=false;}
}
async function copy(value:string){const ok=await attempt(async()=>{await writeClipboard(value);return true;});if(ok)notice.value='已复制';}
function toggleFile(name:string){revealed.value={...revealed.value,[name]:!revealed.value[name]};}
function isPrivate(f:KeyFile){return f.name.startsWith('private_')||f.name.startsWith('secret_')||f.name.startsWith('keystore.');}
function randomHex(n:number){return Array.from(crypto.getRandomValues(new Uint8Array(n)),b=>b.toString(16).padStart(2,'0')).join('');}
function generateIv(){
 const algorithm=alg.value;
 const n=algorithm==='XChaCha20-Poly1305'?24:algorithm.endsWith('-GCM')||algorithm==='ChaCha20-Poly1305'?12:/^(3?DES)-/.test(algorithm)?8:16;
 setOption('ivEncoding','hex');setOption('iv',randomHex(n));
}
watch(()=>opts.value.algorithm,()=>{
 if(isGen.value&&alg.value!=='RSA'&&!isSecretGen.value){opts.value.privateFormat='PKCS8';opts.value.publicFormat='SPKI';}
 if(tool.value.id==='symmetric'&&alg.value.endsWith('-ECB'))opts.value.iv='';
});
watch(()=>props.tab.result,()=>{revealed.value={};savedDirectory.value='';savedName.value='';});
watch(selectedSet,()=>{selectedFile.value=sets.value.find(s=>s.name===selectedSet.value)?.files[0]??'';manageAction.value='';manageName.value='';});
function startManage(action:'rename'|'delete'){manageAction.value=action;manageName.value=action==='rename'?selectedSet.value:'';}
async function confirmManage(){
 const name=selectedSet.value;
 if(!managedSet.value||!manageName.value.trim()||managing.value)return;
 managing.value=true;
 try{
 if(manageAction.value==='delete'){
   if(manageName.value!==name){error.value='请输入准确的密钥组名称';return;}
   const ok=await attempt(async()=>{await deleteKeySet(name,manageName.value,directory.value);return true;});
   if(ok){notice.value='已删除密钥组 '+name;selectedSet.value='';manageAction.value='';await refresh();}
 }else if(manageAction.value==='rename'){
   const target=manageName.value.trim();const path=await attempt(()=>renameKeySet(name,target,directory.value));
   if(path){notice.value='已重命名至 '+path;await refresh();selectedSet.value=target;manageAction.value='';}
 }
 }finally{managing.value=false;}
}
watch(()=>opts.value.algorithm,value=>{if(tool.value.id==='crypto-hash'&&['BLAKE3','CRC32'].includes(String(value)))props.tab.action='hash';});

onMounted(()=>{void refresh();});
</script>
<template>
 <div class="crypto-workbench">
  <div class="crypto-actions"><div class="action-tabs" aria-label="处理操作"><button v-for="op in tool.actions.filter(op=>!(tool.id==='crypto-hash'&&['CRC32','BLAKE3'].includes(alg)&&op.id==='hmac'))" :key="op.id" :class="{selected:tab.action===op.id}" :aria-pressed="tab.action===op.id" @click="setAction(op.id)">{{op.label}}</button></div><span class="native-label"><ShieldCheck :size="15"/> 本地 OpenSSL</span></div>
  <div v-if="!desktop" class="warning-banner">浏览器仅用于界面预览；密码学运算与密钥目录管理需在桌面安装版中使用。</div>
  <div class="crypto-options">
   <label v-for="o in visibleOptions" :key="o.key" class="crypto-option" :class="{'wide':o.type==='textarea'||o.key==='keyName','check':o.type==='checkbox'}">
    <template v-if="o.type==='checkbox'"><input type="checkbox" :aria-label="o.label" :checked="opts[o.key]===true" @change="setOption(o.key,($event.target as HTMLInputElement).checked)"/><span>{{o.label}}</span></template>
    <template v-else><span>{{o.label}}</span><select v-if="o.type==='select'" :aria-label="o.label" :value="opts[o.key]" @change="setOption(o.key,($event.target as HTMLSelectElement).value)"><option v-for="choice in o.choices" :key="choice.value" :value="choice.value">{{choice.label}}</option></select>
     <textarea v-else-if="o.type==='textarea'" :aria-label="o.label" rows="3" :value="String(opts[o.key]??'')" @input="setOption(o.key,($event.target as HTMLTextAreaElement).value)" spellcheck="false"/>
     <input v-else-if="o.type==='number'" :aria-label="o.label" type="number" :min="o.min" :value="opts[o.key]" @input="setOption(o.key,Number(($event.target as HTMLInputElement).value))"/>
     <input v-else :aria-label="o.label" :type="['rawKey','keyPassphrase','exportPassphrase','storePassphrase','entryPassphrase'].includes(o.key)?'password':'text'" :value="opts[o.key]" :placeholder="o.description??''" autocomplete="off" spellcheck="false" @input="setOption(o.key,($event.target as HTMLInputElement).value)"/>
    </template>
   </label>
  </div>
  <div v-if="certVerify" class="crypto-inline"><button class="secondary-button" @click="importRoots">导入本地信任根证书</button><small>不会联网查询证书或自动信任系统根证书。</small></div>
  <div v-if="tool.id==='symmetric'&&!alg.endsWith('-ECB')" class="crypto-inline"><button type="button" class="secondary-button" @click="generateIv">生成随机 IV / Nonce</button><small v-if="aead">同一密钥下不可复用 Nonce；16 字节 Tag 附在密文末尾。</small></div>
  <div v-if="isSignature&&tab.action==='verify'" class="crypto-inline"><button class="secondary-button" @click="importInput('signature')">从二进制签名文件导入</button><small>报文包含签名字段时可留空；按原始字节验证。</small></div>
  <div v-if="isGen||['keyconvert','certificate','keystore'].includes(tool.id)" class="crypto-directory">
   <div class="crypto-label"><strong>默认密钥存储路径</strong><span>修改后自动保存</span></div>
   <div class="crypto-inline"><input readonly aria-label="默认密钥保存路径" :value="directory" :placeholder="desktop?'正在读取目录…':'桌面版可设置保存目录'"/><button class="secondary-button" :disabled="!desktop" @click="chooseDirectory"><FolderOpen :size="15"/>修改目录</button><button class="secondary-button" :disabled="!desktop" @click="attempt(()=>openKeyDirectory())">打开目录</button></div>
   <small v-if="opts.keyName">保存到：{{directory}} / {{opts.keyName}} /</small>
  </div>
  <div v-if="inputKey||keyInput||isGen||isStore" class="crypto-library">
   <button class="secondary-button" type="button" :disabled="!desktop" @click="libraryOpen=!libraryOpen;refresh()"><KeyRound :size="15"/>本地密钥库 <span>{{sets.length}}</span></button>
   <div v-if="libraryOpen" class="crypto-library-panel"><div class="crypto-inline"><select v-model="selectedSet" aria-label="密钥组"><option value="">选择密钥组</option><option v-for="s in sets" :key="s.name" :value="s.name">{{s.name}}</option></select><select v-model="selectedFile" aria-label="密钥文件"><option value="">选择文件</option><option v-for="f in sets.find(s=>s.name===selectedSet)?.files||[]" :key="f" :value="f">{{f}}</option></select><button class="secondary-button" @click="refresh"><RefreshCw :size="14"/>刷新</button><button class="secondary-button" :disabled="!selectedSet" @click="attempt(()=>openKeyDirectory(selectedSet))">打开位置</button></div><div class="crypto-inline"><button v-if="inputKey||(isStore&&tab.action!=='pack')" class="secondary-button" :disabled="!selectedFile" @click="importLibrary('input')">导入主输入</button><button v-if="keyInput" class="secondary-button" :disabled="!selectedFile" @click="importLibrary('secondaryInput')">导入密钥输入</button><button v-if="managedSet" class="secondary-button" @click="startManage('rename')">重命名密钥组</button><button v-if="managedSet" class="secondary-button" @click="startManage('delete')">删除密钥组</button></div>
    <div v-if="manageAction" class="crypto-inline"><label>{{manageAction==='rename'?'新名称':'确认删除：输入当前密钥组完整名称'}}<input v-model="manageName" aria-label="密钥组确认名称"/></label><button class="secondary-button" :disabled="managing" @click="confirmManage">确认{{manageAction==='rename'?'重命名':'删除'}}</button><button class="text-button" @click="manageAction=''">取消</button></div>
    <small v-if="manageAction==='delete'">将永久删除 Toolbox EX 创建的这一组文件，不会自动删除其他文件或工作台历史。</small>
   </div>
  </div>
  <div v-if="needsInput||keyInput" class="crypto-inputs" :class="{paired:needsInput&&keyInput}">
   <div v-if="needsInput" class="crypto-editor"><div class="crypto-label"><label for="crypto-input">{{inputLabel}}</label><button class="small-action" @click="importInput('input',inputKey)"><FolderOpen :size="14"/>文件导入</button></div><textarea id="crypto-input" v-model="tab.input" spellcheck="false" autocomplete="off" rows="7" placeholder="粘贴内容或从本地文件导入"></textarea></div>
   <div v-if="keyInput" class="crypto-editor"><div class="crypto-label"><label for="crypto-key">{{secondaryLabel}}</label><button class="small-action" @click="importInput('secondaryInput',true)"><FolderOpen :size="14"/>文件导入</button></div><textarea id="crypto-key" v-model="tab.secondaryInput" spellcheck="false" autocomplete="off" rows="7" placeholder="PEM / DER Base64 / Hex / JWK / OpenSSH"></textarea></div>
  </div>
  <div class="crypto-footer"><button class="text-button" @click="emit('clear')"><Trash2 :size="15"/>清空</button><span v-if="running">原生任务正在运算，完成后显示结果。</span><button class="primary-button" :disabled="running||!desktop" @click="emit('run')"><Play :size="15"/>{{tool.actions.find(a=>a.id===tab.action)?.label}}</button></div>
  <div v-if="tab.error||error" class="error-banner" role="alert">{{tab.error||error}}</div>
  <div v-for="w in tab.result?.warnings??[]" :key="w" class="warning-banner">{{w}}</div>
  <div v-if="tab.result" class="crypto-result"><div class="crypto-label"><strong>{{tab.result.summary||'处理结果'}} <span v-if="tab.stale" class="stale-label">待重新处理</span></strong><button v-if="!files.length" class="small-action" @click="copy(tab.result.output)"><Copy :size="14"/>复制结果</button></div>
   <template v-if="files.length"><div class="crypto-file-grid"><div v-for="f in files" :key="f.name" class="crypto-file"><div class="crypto-label"><strong>{{f.name}}</strong><button v-if="isPrivate(f)" class="small-action" @click="toggleFile(f.name)"><EyeOff v-if="revealed[f.name]" :size="14"/><Eye v-else :size="14"/>{{revealed[f.name]?'隐藏':'显示'}}</button><button class="small-action" @click="copy(f.data)"><Copy :size="14"/>复制</button></div><textarea v-if="!isPrivate(f)||revealed[f.name]" readonly :value="f.data" rows="7" spellcheck="false"></textarea><div v-else class="crypto-hidden">私钥内容已隐藏 · 点击显示或直接保存</div></div></div><small v-if="outputObject?.fingerprintSha256" class="fingerprint">SHA-256 公钥指纹：{{outputObject.fingerprintSha256}}</small><div class="crypto-inline"><button class="primary-button" :disabled="saving||!desktop" @click="save"><Download :size="15"/>保存到命名目录</button><button v-if="savedDirectory" class="secondary-button" @click="attempt(()=>openKeyDirectory(savedName))">打开文件位置</button><small v-if="savedDirectory">{{savedDirectory}}</small></div></template>
   <template v-else><div v-if="isSignature&&outputObject" class="crypto-signed"><div v-if="typeof outputObject.valid==='boolean'" :class="outputObject.valid?'success-text':'error-text'">{{outputObject.valid?'验签通过':'验签失败'}}</div><div v-if="typeof outputObject.signature==='string'" class="crypto-editor"><div class="crypto-label"><strong>签名值</strong><button class="small-action" @click="copy(String(outputObject.signature))">复制签名</button></div><textarea readonly rows="4" :value="outputObject.signature"></textarea></div><div class="crypto-editor"><div class="crypto-label"><strong>实际参与签名 / 验签的内容</strong><button class="small-action" @click="copy(String(outputObject.signedContent))">复制原文</button></div><textarea readonly rows="5" :value="String(outputObject.signedContent??'')"></textarea></div></div><textarea v-else readonly aria-label="处理结果" :value="tab.result.output" rows="8" spellcheck="false"></textarea><div class="crypto-inline"><button class="secondary-button" @click="attempt(()=>saveTextFile(tab.result!.output,tool.id+'-result.json'))">导出结果</button></div></template>
  </div>
  <p v-if="notice" class="crypto-notice" role="status">{{notice}}</p>
 </div>
</template>
<style scoped>
.crypto-workbench {min-width:0;padding:0 16px 14px}
.crypto-actions,.crypto-label,.crypto-inline,.crypto-footer {display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.crypto-actions {padding:12px 0;border-bottom:1px solid var(--border);justify-content:space-between}
.native-label,.crypto-label>span,.crypto-workbench small,.crypto-notice {color:var(--secondary);font-size:12px}
.native-label {display:flex;align-items:center;gap:5px}
.crypto-options {display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;padding:15px 0}
.crypto-option {display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px;color:var(--secondary)}
.crypto-option.wide {grid-column:1/-1}.crypto-option.check {flex-direction:row;align-items:center;align-self:center}
.crypto-workbench input:not([type=checkbox]),.crypto-workbench select,.crypto-workbench textarea {border:1px solid var(--border);border-radius:6px;background:var(--input);color:var(--text);font:inherit;padding:8px;min-width:0;width:100%;box-sizing:border-box}
.crypto-workbench input:not([type=checkbox]),.crypto-workbench select {min-height:34px}.crypto-workbench textarea {font-family:ui-monospace,monospace;font-size:12px;resize:vertical;line-height:1.5}
.crypto-directory,.crypto-library,.crypto-inputs,.crypto-result {padding:12px 0;border-top:1px solid var(--border)}
.crypto-directory .crypto-inline {margin:8px 0}.crypto-inline input,.crypto-inline select {flex:1;min-width:120px}
.crypto-label {justify-content:space-between;margin-bottom:6px;font-size:13px}
.crypto-label label,.crypto-label strong {font-weight:600;flex:1}
.crypto-inputs,.crypto-file-grid {display:grid;gap:12px}.crypto-inputs.paired,.crypto-file-grid {grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.crypto-editor,.crypto-file {min-width:0}.crypto-file {padding:10px;border:1px solid var(--border);border-radius:7px}
.crypto-hidden {min-height:120px;display:flex;align-items:center;justify-content:center;background:var(--subtle);border-radius:5px;color:var(--secondary);font-size:12px;text-align:center}
.crypto-footer {justify-content:flex-end;padding:12px 0}.crypto-footer>span {flex:1;color:var(--secondary);font-size:12px}
.crypto-library-panel {padding:10px;background:var(--subtle);border:1px solid var(--border);border-radius:7px;margin-top:8px}
.crypto-result>.crypto-inline,.crypto-library-panel>.crypto-inline+.crypto-inline {margin-top:10px}.fingerprint {display:block;overflow-wrap:anywhere;margin:8px 0}
.crypto-notice {overflow-wrap:anywhere;margin-bottom:0}
</style>
