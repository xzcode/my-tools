import type { ToolRequest, ToolResult } from './types';
import { optionText, optionBool, jsonStringify, displayEscapes } from './shared';

export function processPacket(request: ToolRequest): ToolResult {
  // Query/form canonicalization is explicit. Never trim values, infer a
  // payment provider's rules, or reserialize a JSON value implicitly.
  const raw=request.input;
  const excluded=new Set(optionText(request.options,'exclude').split(',').map(x=>x.trim()).filter(Boolean));
  const included=new Set(optionText(request.options,'include').split(',').map(x=>x.trim()).filter(Boolean));
  const decoding=optionText(request.options,'decoding'), sort=optionText(request.options,'sort'), duplicate=optionText(request.options,'duplicate');
  const decode=(v:string)=> {
    try { return decoding==='raw'?v:decodeURIComponent(decoding==='form'?v.replace(/\+/g,' '):v); }
    catch { throw Error('报文包含无效百分号编码。'); }
  };
  const seen=new Set<string>();
  let pairs:{key:string;value:string}[]=[];
  if (raw.length) for (const part of raw.split('&')) {
    const i=part.indexOf('=');
    if (i<0) throw Error('每个参数必须是 key=value 格式。');
    const key=decode(part.slice(0,i)),value=decode(part.slice(i+1));
    if (!key) throw Error('参数名称不能为空。');
    if (seen.has(key) && duplicate==='reject') throw Error('存在重复参数：'+key);
    seen.add(key);
    if (excluded.has(key) || (included.size&&!included.has(key)) || (optionBool(request.options,'skipEmpty') && value==='')) continue;
    pairs.push({key,value});
  }
  if (sort!=='none') pairs=pairs.sort((a,b)=>(a.key<b.key?-1:a.key>b.key?1:0)*(sort==='asc'?1:-1));
  const sep=displayEscapes(optionText(request.options,'separator'));
  const encode=(v:string)=>optionText(request.options,'outputEncoding')==='percent'?encodeURIComponent(v):v;
  const output=pairs.map(p=>optionText(request.options,'joinMode')==='values'?encode(p.value):encode(p.key)+'='+encode(p.value)).join(sep);
  return {output, summary: pairs.length+' 个参与签名的参数', warnings: ['按显式规则生成待签名原文；不包含任何支付平台预设。重复键保留原始相对顺序。']};
}
