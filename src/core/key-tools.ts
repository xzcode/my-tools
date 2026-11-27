import type { ToolRequest, ToolResult } from './types';
import { bytesToHex, decodeBase64Bytes, decodeUtf8, encodeBase64Bytes, hexToBytes } from './encoding';
import { encoder, optionText, optionBool, jsonStringify } from './shared';

export const keyProfiles = ['RSA', 'ECDSA-P-256', 'ECDSA-P-384', 'ECDSA-P-521', 'ECDH-P-256', 'ECDH-P-384', 'ECDH-P-521', 'Ed25519', 'X25519'] as const;
export const signatureProfiles = ['RSA-SHA256', 'RSA-SHA384', 'RSA-SHA512', 'RSA-SHA1', 'RSA-PSS-SHA256', 'RSA-PSS-SHA384', 'RSA-PSS-SHA512', 'ECDSA-SHA256', 'ECDSA-SHA384', 'ECDSA-SHA512', 'Ed25519'] as const;
export type KeyProfile = typeof keyProfiles[number];
type KeyRole = 'private' | 'public';
type KeyFormat = 'pkcs8' | 'spki';
export interface KeyBundleFile { name: string; base64: string }
export interface KeyBundle { format: 'my-tools-key-bundle-v1'; name: string; folder: string; algorithm: string; fingerprint: string; files: KeyBundleFile[] }

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw Error('当前运行环境不支持 Web Crypto。');
  return crypto.subtle;
}
function buffer(bytes: Uint8Array): ArrayBuffer { return Uint8Array.from(bytes).buffer; }
function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return result;
}
function der(tag: number, content: Uint8Array): Uint8Array {
  if (content.length < 128) return concat(Uint8Array.of(tag, content.length), content);
  const len: number[] = [];
  for (let n = content.length; n; n = Math.floor(n / 256)) len.unshift(n & 255);
  return concat(Uint8Array.of(tag, 128 | len.length, ...len), content);
}
function element(data: Uint8Array, offset = 0) {
  const start = offset;
  const tag = data[offset++], first = data[offset++];
  if (tag === undefined || first === undefined) throw Error('DER 结构不完整。');
  let length = first;
  if (first >= 128) {
    const count = first & 127;
    if (count === 0 || count > 3 || offset + count > data.length || data[offset] === 0) throw Error('DER 长度无效。');
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + data[offset++]!;
    if (length < 128) throw Error('DER 长度不是规范编码。');
  }
  const end = offset + length;
  if (end > data.length) throw Error('DER 数据截断。');
  return { tag, start, end, value: data.subarray(offset, end), encoded: data.subarray(start, end) };
}
function children(data: Uint8Array): ReturnType<typeof element>[] {
  const root = element(data);
  if (root.tag !== 0x30 || root.end !== data.length) throw Error('需要完整 DER SEQUENCE。');
  const out = [];
  for (let n = 0; n < root.value.length;) {
    const el = element(root.value, n); out.push(el); n = el.end;
  }
  return out;
}
// rsaEncryption + NULL, as defined for unrestrained RSA keys.
const rsaIdentifier = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);
function wrapRsaPkcs1(data: Uint8Array, role: KeyRole): Uint8Array {
  const parts = children(data);
  const count = role === 'private' ? 9 : 2;
  if (parts.length !== count || parts.some(p => p.tag !== 2)) throw Error('不是受支持的双素数 RSA PKCS1 密钥。');
  return role === 'private'
    ? der(0x30, concat(Uint8Array.of(2, 1, 0), rsaIdentifier, der(4, data)))
    : der(0x30, concat(rsaIdentifier, der(3, concat(Uint8Array.of(0), data))));
}
function unwrapRsa(data: Uint8Array, role: KeyRole): Uint8Array {
  const parts = children(data);
  const identifier = parts[role === 'private' ? 1 : 0];
  if (!identifier || bytesToHex(identifier.encoded) !== bytesToHex(rsaIdentifier)) throw Error('该密钥不是通用 RSA 密钥，不能输出 PKCS1。');
  const field = parts[role === 'private' ? 2 : 1];
  if (!field || field.tag !== (role === 'private' ? 4 : 3) || (role === 'public' && field.value[0] !== 0)) throw Error('RSA 密钥封装无效。');
  const pkcs1 = role === 'private' ? field.value : field.value.subarray(1);
  wrapRsaPkcs1(pkcs1, role);
  return Uint8Array.from(pkcs1);
}
function pem(data: Uint8Array, label: string) {
  return '-----BEGIN ' + label + '-----\n' + (encodeBase64Bytes(data).match(/.{1,64}/g) || []).join('\n') + '\n-----END ' + label + '-----\n';
}
function parseKey(input: string, role: KeyRole, profile: string): { der: Uint8Array; format: KeyFormat } {
  const text = input.trim();
  if (!text) throw Error(role === 'private' ? '请输入私钥。' : '请输入公钥。');
  const match = /^-----BEGIN ([A-Z0-9 ]+)-----\s*([A-Za-z0-9+/=\r\n\t ]+?)\s*-----END \1-----$/.exec(text);
  let bytes = decodeBase64Bytes(match ? match[2]! : text);
  const label = match?.[1];
  if (label === 'RSA PRIVATE KEY' || label === 'RSA PUBLIC KEY') {
    if (profile !== 'RSA' || label !== (role === 'private' ? 'RSA PRIVATE KEY' : 'RSA PUBLIC KEY')) throw Error('RSA 密钥类型与选定用途不符。');
    bytes = wrapRsaPkcs1(bytes, role);
  } else {
    if (label && label !== (role === 'private' ? 'PRIVATE KEY' : 'PUBLIC KEY')) throw Error('不支持此 PEM 类型；请选择未加密 PKCS8/SPKI 或 RSA PKCS1。');
    if (!label && profile === 'RSA') {
      const parts = children(bytes);
      if (parts.length && parts.every(p => p.tag === 2)) bytes = wrapRsaPkcs1(bytes, role);
    }
  }
  return { der: bytes, format: role === 'private' ? 'pkcs8' : 'spki' };
}
function keyAlgorithm(profile: string, rsa: RsaHashedImportParams['name'] = 'RSASSA-PKCS1-v1_5', hash = 'SHA-256'): AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams {
  if (profile === 'RSA') return { name: rsa, hash };
  if (profile.startsWith('ECDSA-')) return { name: 'ECDSA', namedCurve: profile.slice(6) };
  if (profile.startsWith('ECDH-')) return { name: 'ECDH', namedCurve: profile.slice(5) };
  if (profile === 'Ed25519' || profile === 'X25519') return { name: profile };
  throw Error('不支持的密钥算法。');
}
function usages(profile: string, role: KeyRole, rsa = 'RSASSA-PKCS1-v1_5'): KeyUsage[] {
  if (profile.startsWith('ECDH-') || profile === 'X25519') return role === 'private' ? ['deriveBits'] : [];
  if (rsa === 'RSA-OAEP' && profile === 'RSA') return role === 'private' ? ['decrypt'] : ['encrypt'];
  return role === 'private' ? ['sign'] : ['verify'];
}
async function importKey(input: string, role: KeyRole, profile: string, rsa = 'RSASSA-PKCS1-v1_5', hash = 'SHA-256'): Promise<CryptoKey> {
  const decoded = parseKey(input, role, profile);
  try { return await subtle().importKey(decoded.format, buffer(decoded.der), keyAlgorithm(profile, rsa, hash), true, usages(profile, role, rsa)); }
  catch { throw Error('密钥无效、算法/曲线不匹配，或当前 WebView 不支持此算法。'); }
}
async function publicFromPrivate(key: CryptoKey): Promise<CryptoKey> {
  const jwk = await subtle().exportKey('jwk', key);
  const clean: JsonWebKey = jwk.kty === 'RSA' ? { kty: 'RSA', n: jwk.n, e: jwk.e }
    : jwk.kty === 'EC' ? { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }
    : { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
  const algorithm = key.algorithm as Algorithm & { namedCurve?: string; hash?: Algorithm };
  const publicUsages: KeyUsage[] = algorithm.name === 'ECDH' || algorithm.name === 'X25519' ? [] : algorithm.name === 'RSA-OAEP' ? ['encrypt'] : ['verify'];
  return subtle().importKey('jwk', clean, algorithm, true, publicUsages);
}
async function fingerprint(key: CryptoKey): Promise<string> {
  const spki = await subtle().exportKey('spki', key.type === 'private' ? await publicFromPrivate(key) : key);
  return 'SHA256:' + encodeBase64Bytes(new Uint8Array(await subtle().digest('SHA-256', spki)), false, false);
}
export function validateKeyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || encoder.encode(trimmed).length > 80 || trimmed === '.' || trimmed === '..' || /[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(trimmed) || /[. ]$/.test(trimmed) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(trimmed)) throw Error('密钥名称无效（最长 80 UTF-8 字节；不能使用路径分隔符或系统保留名称）。');
  return trimmed;
}
async function generatePair(profile: string, bits: number): Promise<CryptoKeyPair> {
  const params = profile === 'RSA'
    ? { name: 'RSASSA-PKCS1-v1_5', modulusLength: bits, publicExponent: Uint8Array.of(1,0,1), hash: 'SHA-256' }
    : keyAlgorithm(profile);
  try {
    const pair = await subtle().generateKey(params, true, [...new Set([...usages(profile, 'private'), ...usages(profile, 'public')])]);
    if (!('privateKey' in pair)) throw Error('不是公私钥算法。');
    return pair;
  } catch { throw Error('密钥生成失败：当前 WebView 可能不支持该算法或规格。'); }
}
export async function processKeygen(request: ToolRequest): Promise<ToolResult> {
  const name = validateKeyName(request.input), profile = optionText(request.options, 'profile');
  const bits = Number(optionText(request.options, 'bits'));
  if (!['pem','der','base64'].some(k => optionBool(request.options,k))) throw Error('至少选择一种输出编码。');
  const pair = await generatePair(profile, bits);
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey)), spki = new Uint8Array(await subtle().exportKey('spki', pair.publicKey));
  const fp = await fingerprint(pair.publicKey);
  const algorithm = profile === 'RSA' ? 'RSA_' + bits : profile;
  const files: KeyBundleFile[] = [];
  const add = (filename: string, bytes: Uint8Array) => files.push({ name: filename, base64: encodeBase64Bytes(bytes) });
  const formats = [{ role: 'private', format: 'pkcs8', label: 'PRIVATE KEY', data: pkcs8 }, { role: 'public', format: 'spki', label: 'PUBLIC KEY', data: spki }];
  if (profile === 'RSA' && optionBool(request.options, 'pkcs1')) formats.push(
    { role: 'private', format: 'pkcs1', label: 'RSA PRIVATE KEY', data: unwrapRsa(pkcs8, 'private') },
    { role: 'public', format: 'pkcs1', label: 'RSA PUBLIC KEY', data: unwrapRsa(spki, 'public') });
  for (const item of formats) {
    const base = name + '_' + item.role + '_' + item.format;
    if (optionBool(request.options, 'pem')) add(base + '.pem', encoder.encode(pem(item.data,item.label)));
    if (optionBool(request.options, 'der')) add(base + '.der', item.data);
    if (optionBool(request.options, 'base64')) add(base + '.base64.txt', encoder.encode(encodeBase64Bytes(item.data)));
  }
  add(name + '_key-info.json', encoder.encode(JSON.stringify({ name, algorithm, fingerprint: fp, createdAt: new Date().toISOString() }, null, 2)));
  const bundle: KeyBundle = { format: 'my-tools-key-bundle-v1', name, folder: name + '_' + algorithm, algorithm, fingerprint: fp, files };
  return { output: JSON.stringify(bundle, null, 2), kind: 'json', summary: algorithm + ' · ' + files.length + ' 个文件 · ' + fp,
    warnings: ['私钥未加密；请保存至可信目录，勿上传或分享。密钥工具的内容不会进入工作台历史或持久化存档。'] };
}
export function readKeyBundle(output: string): KeyBundle {
  // Only parses the tool's own generated envelope, never canonicalizes user JSON.
  const value = JSON.parse(output) as KeyBundle;
  if (value?.format !== 'my-tools-key-bundle-v1' || typeof value.name !== 'string' || typeof value.folder !== 'string' || !Array.isArray(value.files) || !value.files.length || value.files.length > 13 ||
      !value.files.every(f => typeof f.name === 'string' && typeof f.base64 === 'string')) throw Error('无效的密钥生成结果。');
  return value;
}
export async function processKeyMatch(request: ToolRequest): Promise<ToolResult> {
  const profile = optionText(request.options, 'profile');
  const publicKey = await importKey(request.input, 'public', profile), privateKey = await importKey(request.secondaryInput || '', 'private', profile);
  const actual = await fingerprint(publicKey), derived = await fingerprint(privateKey), matches = actual === derived;
  return { output: jsonStringify({ matches, publicFingerprint: actual, derivedFingerprint: derived }), kind: 'json', summary: matches ? '公私钥匹配' : '公私钥不匹配' };
}
export async function processKeyInspect(request: ToolRequest): Promise<ToolResult> {
  const role: KeyRole = optionText(request.options, 'role') === 'public' ? 'public' : 'private';
  const profile = optionText(request.options, 'profile');
  const key = await importKey(request.input, role, profile);
  const fp = await fingerprint(key);
  const algo = key.algorithm as KeyAlgorithm & { modulusLength?: number; namedCurve?: string };
  if (request.action === 'inspect') return { output: jsonStringify({ algorithm: algo.name, profile, role, modulusLength: algo.modulusLength ?? null, curve: algo.namedCurve ?? null, fingerprint: fp }), kind: 'json', summary: '密钥解析完成' };
  const resultKey = request.action === 'public' && role === 'private' ? await publicFromPrivate(key) : key;
  const resultRole = resultKey.type === 'private' ? 'private' : 'public';
  let bytes = new Uint8Array(await subtle().exportKey(resultRole === 'private' ? 'pkcs8' : 'spki', resultKey));
  const pkcs1 = optionText(request.options,'format') === 'pkcs1';
  if (pkcs1) {
    if (profile !== 'RSA') throw Error('PKCS1 仅适用于 RSA。');
    bytes = unwrapRsa(bytes, resultRole);
  }
  const encoding = optionText(request.options, 'encoding');
  const label = (pkcs1 ? 'RSA ' : '') + (resultRole === 'private' ? 'PRIVATE KEY' : 'PUBLIC KEY');
  return { output: encoding === 'hex' ? bytesToHex(bytes) : encoding === 'base64' ? encodeBase64Bytes(bytes) : pem(bytes,label), summary: fp };
}
function dataBytes(input: string, encoding: string) {
  return encoding === 'hex' ? hexToBytes(input) : encoding === 'base64' ? decodeBase64Bytes(input) : encoder.encode(input);
}
function outputBytes(bytes: Uint8Array, encoding: string) {
  return encoding === 'hex' ? bytesToHex(bytes) : encoding === 'base64url' ? encodeBase64Bytes(bytes,true,false) : encoding === 'utf8' ? decodeUtf8(bytes) : encodeBase64Bytes(bytes);
}
function signatureBytes(text: string, encoding: string) {
  return encoding === 'hex' ? hexToBytes(text) : decodeBase64Bytes(text,encoding === 'base64url');
}
function signatureParams(profile: string, curve: string, salt: number) {
  if (profile === 'Ed25519') return { profile, hash: 'SHA-256', algorithm: { name: 'Ed25519' }, rsa: 'RSASSA-PKCS1-v1_5' };
  const digest = profile.split('SHA').at(-1);
  const hash = 'SHA-' + digest;
  if (profile.startsWith('ECDSA-')) return { profile: 'ECDSA-' + curve, hash, algorithm: { name: 'ECDSA', hash }, rsa: 'RSASSA-PKCS1-v1_5' };
  const pss = profile.startsWith('RSA-PSS-');
  const rsa = pss ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5';
  return { profile: 'RSA', hash, algorithm: pss ? { name: rsa, saltLength: salt } : { name: rsa }, rsa };
}
// Web Crypto returns IEEE P1363 fixed-width ECDSA signatures. Convert only
// their representation (not the signature operation) for OpenSSL/Java DER.
function p1363ToDer(raw: Uint8Array): Uint8Array {
  if (raw.length % 2 || !raw.length) throw Error('ECDSA 签名长度无效。');
  const size = raw.length/2;
  const integer = (value: Uint8Array) => {
    let i=0; while (i<value.length-1 && value[i]===0) i++;
    const body=value.subarray(i);
    return der(2, body[0]! & 128 ? concat(Uint8Array.of(0),body) : body);
  };
  return der(0x30, concat(integer(raw.subarray(0,size)),integer(raw.subarray(size))));
}
function derToP1363(raw: Uint8Array, width: number): Uint8Array {
  const parts=children(raw);
  if (parts.length!==2 || parts.some(p=>p.tag!==2)) throw Error('ECDSA DER 签名格式无效。');
  const values=parts.map(p=>{
    let v=p.value;
    if (!v.length || v[0]! & 128 || (v.length>1 && v[0]===0 && !(v[1]! & 128))) throw Error('ECDSA DER 整数非规范。');
    if (v.length>1 && v[0]===0) v=v.subarray(1);
    if (v.length>width) throw Error('ECDSA DER 整数超出曲线范围。');
    const fixed=new Uint8Array(width);fixed.set(v,width-v.length);return fixed;
  });
  return concat(...values);
}
export async function processSignature(request: ToolRequest): Promise<ToolResult> {
  const profile = optionText(request.options,'algorithm'), curve = optionText(request.options,'curve');
  const salt = Number(request.options.saltLength);
  const params = signatureParams(profile,curve,salt);
  const signing = request.action === 'sign';
  const key = await importKey(request.secondaryInput || '', signing?'private':'public', params.profile, params.rsa, params.hash);
  const data = dataBytes(request.input,optionText(request.options,'dataEncoding'));
  const encoding = optionText(request.options,'signatureEncoding'), ec = profile.startsWith('ECDSA-');
  const useDer = ec && optionText(request.options,'ecdsaFormat') === 'der';
  const warnings = profile === 'RSA-SHA1' ? ['SHA-1 仅用于旧系统兼容；新系统请使用 SHA-256 或更强的算法。'] : [];
  if (signing) {
    let raw = new Uint8Array(await subtle().sign(params.algorithm,key,buffer(data)));
    if (useDer) raw=p1363ToDer(raw);
    return { output: outputBytes(raw,encoding), summary: profile + ' · ' + raw.length + ' 字节', warnings };
  }
  const signature = optionText(request.options,'signature');
  if (!signature.trim()) throw Error('请输入待验证的签名值。');
  let raw=signatureBytes(signature,encoding);
  if (useDer) raw=derToP1363(raw,curve==='P-521'?66:curve==='P-384'?48:32);
  const verified=await subtle().verify(params.algorithm,key,buffer(raw),buffer(data));
  return { output: jsonStringify({ verified, algorithm: profile, fingerprint: await fingerprint(key) }), kind:'json', summary: verified?'签名验证通过':'签名验证不通过',warnings };
}
export async function processRsaOaep(request: ToolRequest): Promise<ToolResult> {
  const encrypt = request.action === 'encrypt', hash = optionText(request.options,'hash');
  const key = await importKey(request.secondaryInput || '',encrypt?'public':'private','RSA','RSA-OAEP',hash);
  const label = encoder.encode(optionText(request.options,'label'));
  const params = { name: 'RSA-OAEP', label: buffer(label) };
  const encoding = optionText(request.options,'cipherEncoding');
  if (encrypt) {
    const data = dataBytes(request.input,optionText(request.options,'dataEncoding'));
    const modulus = (key.algorithm as RsaHashedKeyAlgorithm).modulusLength / 8;
    const hashBytes = Number(hash.split('-')[1]) / 8;
    if (data.length > modulus - 2*hashBytes - 2) throw Error('明文超过 RSA-OAEP 单次加密长度；请使用混合加密，不自动分块。');
    const encrypted=await subtle().encrypt(params,key,buffer(data));
    return { output: outputBytes(new Uint8Array(encrypted),encoding),summary:'RSA-OAEP / '+hash };
  }
  const ciphertext=signatureBytes(request.input,encoding);
  let plaintext: ArrayBuffer;
  try { plaintext=await subtle().decrypt(params,key,buffer(ciphertext)); }
  catch { throw Error('RSA-OAEP 解密失败：密钥、哈希、Label 或密文不匹配。'); }
  return { output: outputBytes(new Uint8Array(plaintext),optionText(request.options,'dataEncoding')),summary:'RSA-OAEP / '+hash };
}
export async function processKeyAgreement(request: ToolRequest): Promise<ToolResult> {
  const profile = optionText(request.options,'profile');
  if (!(profile.startsWith('ECDH-') || profile==='X25519')) throw Error('请选择密钥协商算法。');
  const priv=await importKey(request.input,'private',profile), pub=await importKey(request.secondaryInput||'','public',profile);
  const width=profile.endsWith('P-521')?528:profile.endsWith('P-384')?384:256;
  const shared=new Uint8Array(await subtle().deriveBits({ name:priv.algorithm.name, public:pub },priv,width));
  return {output:outputBytes(shared,optionText(request.options,'encoding')),summary:'原始共享秘密 · '+shared.length+' 字节',warnings:['原始共享秘密不能直接当作加密密钥；使用 HKDF 等密钥派生算法。']};
}
