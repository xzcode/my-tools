import { describe, it, expect, beforeAll } from 'vitest';
import { createPrivateKey, createPublicKey, createSign, createVerify, constants } from 'node:crypto';
import { executeTool } from '../src/core/engine';
import { decodeBase64Bytes, decodeUtf8 } from '../src/core/encoding';
import { readKeyBundle, type KeyBundle } from '../src/core/key-tools';
import { newWorkspace, newToolTab, snapshotWorkspace, historySafeTab } from '../src/core/workspace';
import type { OptionValue } from '../src/core/types';

function run(toolId:string,action:string,input:string,options:Record<string,OptionValue>={},secondaryInput?:string) {
  return executeTool({toolId,action,input,options,secondaryInput});
}
function file(bundle:KeyBundle,suffix:string) {
  const entry=bundle.files.find(f=>f.name.endsWith(suffix))!;
  return decodeUtf8(decodeBase64Bytes(entry.base64));
}
describe('platform-neutral key tools',()=>{
  let rsa:KeyBundle, priv:string, pub:string;
  beforeAll(async()=>{
    rsa=readKeyBundle((await run('keygen','generate','fixture',{pkcs1:true,pem:true,der:true,base64:true})).output);
    priv=file(rsa,'_private_pkcs8.pem');pub=file(rsa,'_public_spki.pem');
  },20000);
  it('generates one RSA key pair across all formats and rejects unsafe names',async()=>{
    expect(rsa.folder).toBe('fixture_RSA_2048');
    expect(rsa.files).toHaveLength(13);
    expect(createPublicKey(createPrivateKey(priv)).export({format:'pem',type:'spki'})).toBe(pub);
    expect(createPrivateKey(file(rsa,'_private_pkcs1.pem')).export({format:'pem',type:'pkcs8'})).toBe(priv);
    expect(JSON.parse((await run('key-match','match',file(rsa,'_public_pkcs1.pem'),{},file(rsa,'_private_pkcs1.pem'))).output).matches).toBe(true);
    const other=readKeyBundle((await run('keygen','generate','different')).output);
    expect(JSON.parse((await run('key-match','match',file(other,'_public_spki.pem'),{},priv)).output).matches).toBe(false);
    for(const name of ['../bad','CON','AUX.txt','bad/name','bad.']) await expect(run('keygen','generate',name)).rejects.toThrow('名称');
  },20000);
  it('extracts public keys and converts PKCS1, PKCS8 and base64 DER',async()=>{
    expect((await run('key-format','public',file(rsa,'_private_pkcs1.pem'))).output).toBe(pub);
    const converted=await run('key-format','convert',priv,{format:'pkcs1'});
    expect(converted.output).toBe(file(rsa,'_private_pkcs1.pem'));
    const info=JSON.parse((await run('key-format','inspect',file(rsa,'_private_pkcs8.base64.txt'))).output);
    expect(info.modulusLength).toBe(2048);expect(info.fingerprint).toBe(rsa.fingerprint);
  });
  it('matches Node/OpenSSL RSA signatures and detects modified data',async()=>{
    const input='签名 & UTF-8';
    const out=await run('signature','sign',input,{},priv);
    expect(createVerify('SHA256').update(input).verify(pub,out.output,'base64')).toBe(true);
    const oracle=createSign('SHA512').update(input).sign(priv,'base64');
    expect(JSON.parse((await run('signature','verify',input,{algorithm:'RSA-SHA512',signature:oracle},pub)).output).verified).toBe(true);
    expect(JSON.parse((await run('signature','verify',input+'!',{algorithm:'RSA-SHA512',signature:oracle},pub)).output).verified).toBe(false);
    const pss=await run('signature','sign',input,{algorithm:'RSA-PSS-SHA256',saltLength:32},priv);
    expect(createVerify('SHA256').update(input).verify({key:pub,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32},pss.output,'base64')).toBe(true);
  });
  it('supports DER ECDSA signatures and key agreement',async()=>{
    const ec=readKeyBundle((await run('keygen','generate','ec',{profile:'ECDSA-P-256'})).output);
    const ecPriv=file(ec,'_private_pkcs8.pem'),ecPub=file(ec,'_public_spki.pem');
    const sig=await run('signature','sign','hello',{algorithm:'ECDSA-SHA256'},ecPriv);
    expect(createVerify('SHA256').update('hello').verify(ecPub,sig.output,'base64')).toBe(true);
    const oracle=createSign('SHA256').update('hello').sign(ecPriv,'base64');
    expect(JSON.parse((await run('signature','verify','hello',{algorithm:'ECDSA-SHA256',signature:oracle},ecPub)).output).verified).toBe(true);
    const a=readKeyBundle((await run('keygen','generate','a',{profile:'ECDH-P-256'})).output);
    const b=readKeyBundle((await run('keygen','generate','b',{profile:'ECDH-P-256'})).output);
    const shared=await run('key-agreement','derive',file(a,'_private_pkcs8.pem'),{},file(b,'_public_spki.pem'));
    expect((await run('key-agreement','derive',file(b,'_private_pkcs8.pem'),{},file(a,'_public_spki.pem'))).output).toBe(shared.output);
  });
  it('RSA OAEP handles Unicode and rejects oversized input or the wrong label',async()=>{
    const cipher=await run('rsa-crypto','encrypt','你好',{label:'test'},pub);
    expect((await run('rsa-crypto','decrypt',cipher.output,{label:'test'},priv)).output).toBe('你好');
    await expect(run('rsa-crypto','decrypt',cipher.output,{label:'other'},priv)).rejects.toThrow('解密失败');
    await expect(run('rsa-crypto','encrypt','x'.repeat(191),{},pub)).rejects.toThrow('长度');
  });
  it('uses explicit generic packet rules and preserves duplicate order',async()=>{
    const result=await run('packet-signing','build','b=2&a=1&a=3&sign=ignore&x=');
    expect(result.output).toBe('a=1&a=3&b=2&x=');
    expect((await run('packet-signing','build','x=a+b&z=%26',{decoding:'form'})).output).toBe('x=a b&z=&');
    await expect(run('packet-signing','build','a=1&a=2',{duplicate:'reject'})).rejects.toThrow('重复');
    await expect(run('packet-signing','build','x=%ZZ',{decoding:'form'})).rejects.toThrow('编码');
  });
  it('keeps all new key tool contents out of history and full-save snapshots',()=>{
    const ws=newWorkspace();ws.mode='full';const t=newToolTab('signature');
    t.input='PRIVATE_CONTENT';t.secondaryInput=priv;t.options.signature='PRIVATE_SIGNATURE';t.result={output:'PRIVATE_RESULT'};ws.tabs.push(t);
    ws.history.push({id:'h',at:1,type:'run',tab:historySafeTab(t)});
    const encoded=JSON.stringify(snapshotWorkspace(ws));
    expect(encoded).not.toContain('PRIVATE_CONTENT');expect(encoded).not.toContain('PRIVATE_SIGNATURE');expect(encoded).not.toContain('PRIVATE_RESULT');expect(encoded).not.toContain('BEGIN PRIVATE KEY');
  });
});
