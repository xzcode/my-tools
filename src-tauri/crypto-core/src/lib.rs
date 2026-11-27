//! Offline crypto operations backed by OpenSSL. No shell commands, network,
//! or user-defined algorithm execution. The desktop adapter owns file access.
use base64::{engine::general_purpose::STANDARD, Engine};
use foreign_types::ForeignTypeRef;
use openssl::{
    asn1::{Asn1Integer, Asn1Time},
    bn::{BigNum, MsbOption},
    ec::{EcGroup, EcKey},
    encrypt::{Decrypter, Encrypter},
    hash::{hash, MessageDigest},
    nid::Nid,
    pkey::{HasPublic, Id, PKey, PKeyRef, Private, Public},
    pkey_ctx::PkeyCtx,
    rand::rand_bytes,
    rsa::{Padding, Rsa},
    sign::{RsaPssSaltlen, Signer, Verifier},
    symm::{decrypt_aead, encrypt_aead, Cipher, Crypter, Mode},
    x509::{X509NameBuilder, X509Req, X509ReqBuilder, X509},
};
use openssl::{md::Md, md_ctx::MdCtx, pkey_ctx::PkeyCtxRef};
use serde::{Deserialize, Serialize};
use serde_json::{json, value::RawValue, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::{fs, io::Write};

type Res<T> = Result<T, String>;
fn ssl<T>(v: Result<T, openssl::error::ErrorStack>) -> Res<T> {
    v.map_err(|e| format!("密码学运算失败：{e}"))
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub tool_id: String,
    pub action: String,
    #[serde(default)]
    pub input: String,
    #[serde(default)]
    pub secondary_input: String,
    #[serde(default)]
    pub options: BTreeMap<String, Value>,
}
impl Request {
    fn opt<'a>(&'a self, k: &str, default: &'a str) -> &'a str {
        self.options
            .get(k)
            .and_then(Value::as_str)
            .unwrap_or(default)
    }
    fn num(&self, k: &str, default: u64) -> Res<u64> {
        match self.options.get(k) {
            None => Ok(default),
            Some(v) => v
                .as_u64()
                .or_else(|| v.as_str()?.parse().ok())
                .ok_or_else(|| format!("{k} 必须是非负整数")),
        }
    }
    fn check(&self, k: &str) -> bool {
        self.options
            .get(k)
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultData {
    pub output: String,
    pub summary: String,
    pub kind: &'static str,
    pub warnings: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyFile {
    pub name: String,
    pub data: String,
    pub encoding: String,
}
fn text_output(output: String, summary: &str, warnings: Vec<String>) -> ResultData {
    ResultData {
        output,
        summary: summary.into(),
        kind: "text",
        warnings,
    }
}
fn json_output(value: Value, summary: &str, warnings: Vec<String>) -> Res<ResultData> {
    Ok(ResultData {
        output: serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?,
        summary: summary.into(),
        kind: "json",
        warnings,
    })
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn unhex(text: &str) -> Res<Vec<u8>> {
    let s: Vec<u8> = text.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if s.len() % 2 != 0 || !s.iter().all(u8::is_ascii_hexdigit) {
        return Err("Hex 格式无效".into());
    }
    s.chunks_exact(2)
        .map(|x| {
            u8::from_str_radix(std::str::from_utf8(x).unwrap_or(""), 16).map_err(|e| e.to_string())
        })
        .collect()
}
fn b64(text: &str) -> Res<Vec<u8>> {
    STANDARD
        .decode(text.split_whitespace().collect::<String>())
        .map_err(|_| "Base64 格式无效".into())
}
fn bytes(text: &str, encoding: &str) -> Res<Vec<u8>> {
    match encoding {
        "utf8" => Ok(text.as_bytes().to_vec()),
        "hex" => unhex(text),
        "base64" => b64(text),
        "ascii" => {
            if text.is_ascii() {
                Ok(text.as_bytes().to_vec())
            } else {
                Err("内容包含非 ASCII 字符".into())
            }
        }
        "utf16le" => Ok(text.encode_utf16().flat_map(u16::to_le_bytes).collect()),
        "utf16be" => Ok(text.encode_utf16().flat_map(u16::to_be_bytes).collect()),
        "gbk" | "gb18030" => {
            let enc = if encoding == "gbk" {
                encoding_rs::GBK
            } else {
                encoding_rs::GB18030
            };
            let (data, _, bad) = enc.encode(text);
            if bad {
                Err("字符无法使用选定字符集编码".into())
            } else {
                Ok(data.into_owned())
            }
        }
        _ => Err("不支持的数据编码".into()),
    }
}
fn render(data: &[u8], encoding: &str) -> Res<String> {
    match encoding {
        "base64" => Ok(STANDARD.encode(data)),
        "hex" => Ok(hex(data)),
        "utf8" => String::from_utf8(data.to_vec())
            .map_err(|_| "结果不是有效的 UTF-8，请选择 Hex 或 Base64".into()),
        _ => Err("不支持的输出编码".into()),
    }
}
fn key_bytes(text: &str, encoding: &str) -> Res<Vec<u8>> {
    if text.trim_start().starts_with("-----BEGIN ") {
        return Ok(text.trim().as_bytes().to_vec());
    }
    match encoding {
        "hex" => unhex(text),
        "auto" | "base64" => b64(text),
        _ => Err("不支持的密钥编码".into()),
    }
}
fn private(text: &str, encoding: &str, pass: &str) -> Res<PKey<Private>> {
    let data = key_bytes(text, encoding)?;
    // Always pass an explicit passphrase (including empty), never a terminal prompt.
    let result = if data.starts_with(b"-----BEGIN ") {
        PKey::private_key_from_pem_passphrase(&data, pass.as_bytes())
    } else {
        PKey::private_key_from_der(&data)
            .or_else(|_| PKey::private_key_from_pkcs8(&data))
            .or_else(|_| PKey::private_key_from_pkcs8_passphrase(&data, pass.as_bytes()))
    };
    result.map_err(|_| "无法解析私钥；检查格式、编码及私钥口令".into())
}
fn public(text: &str, encoding: &str) -> Res<PKey<Public>> {
    let data = key_bytes(text, encoding)?;
    let result = if data.starts_with(b"-----BEGIN ") {
        PKey::public_key_from_pem(&data)
            .or_else(|_| Rsa::public_key_from_pem_pkcs1(&data).and_then(PKey::from_rsa))
            .or_else(|_| X509::from_pem(&data).and_then(|x| x.public_key()))
    } else {
        PKey::public_key_from_der(&data)
            .or_else(|_| Rsa::public_key_from_der_pkcs1(&data).and_then(PKey::from_rsa))
            .or_else(|_| X509::from_der(&data).and_then(|x| x.public_key()))
    };
    result.map_err(|_| "无法解析公钥或证书；检查格式及编码".into())
}
fn label<T: HasPublic>(key: &PKeyRef<T>) -> String {
    key.id().as_raw().to_string()
}
fn fingerprint<T: HasPublic>(key: &PKeyRef<T>) -> Res<String> {
    let der = ssl(key.public_key_to_der())?;
    Ok(hex(&ssl(hash(MessageDigest::sha256(), &der))?))
}
fn is_sm2<T: HasPublic>(key: &PKeyRef<T>) -> bool {
    // SAFETY: the PKey reference owns a live EVP_PKEY and the name is NUL terminated.
    unsafe { openssl_sys::EVP_PKEY_is_a(key.as_ptr(), c"SM2".as_ptr()) == 1 }
}
extern "C" {
    fn EVP_PKEY_CTX_set1_id(
        ctx: *mut openssl_sys::EVP_PKEY_CTX,
        id: *const std::ffi::c_void,
        len: std::ffi::c_int,
    ) -> std::ffi::c_int;
}
fn sm2_id<T>(ctx: &mut PkeyCtxRef<T>, r: &Request) -> Res<()> {
    let id = bytes(
        r.opt("sm2UserId", "1234567812345678"),
        r.opt("sm2IdEncoding", "utf8"),
    )?;
    let len = i32::try_from(id.len()).map_err(|_| "SM2 ID 长度无效")?;
    // SM2 encodes ENTL as an unsigned 16-bit bit count.
    if id.len() > 8191 {
        return Err("SM2 用户 ID 的位数必须可用 16 位 ENTL 表示".into());
    }
    // SAFETY: set1_id copies the bytes; the live context and ID outlive this call.
    let rc = unsafe { EVP_PKEY_CTX_set1_id(ctx.as_ptr(), id.as_ptr().cast(), len) };
    if rc != 1 {
        return Err(format!(
            "设置 SM2 用户 ID 失败：{}",
            openssl::error::ErrorStack::get()
        ));
    }
    Ok(())
}
fn key_algorithm<T: HasPublic>(key: &PKeyRef<T>) -> String {
    let id = key.id();
    if is_sm2(key) {
        "SM2".into()
    } else if id == Id::RSA {
        "RSA".into()
    } else if id == Id::EC {
        "EC".into()
    } else if id == Id::SM2 {
        "SM2".into()
    } else if id == Id::ED25519 {
        "Ed25519".into()
    } else if id == Id::ED448 {
        "Ed448".into()
    } else if id == Id::X25519 {
        "X25519".into()
    } else if id == Id::X448 {
        "X448".into()
    } else {
        format!("OpenSSL key {}", label(key))
    }
}
fn digest(name: &str) -> Res<MessageDigest> {
    let md = match name {
        "MD5" => MessageDigest::md5(),
        "SHA1" => MessageDigest::sha1(),
        "SHA224" => MessageDigest::sha224(),
        "SHA256" => MessageDigest::sha256(),
        "SHA384" => MessageDigest::sha384(),
        "SHA512" => MessageDigest::sha512(),
        "SHA3-224" => MessageDigest::sha3_224(),
        "SHA3-256" => MessageDigest::sha3_256(),
        "SHA3-384" => MessageDigest::sha3_384(),
        "SHA3-512" => MessageDigest::sha3_512(),
        "SM3" => MessageDigest::sm3(),
        "RIPEMD160" => MessageDigest::ripemd160(),
        "BLAKE2b512" | "BLAKE2s256" => {
            MessageDigest::from_name(name).ok_or("当前 OpenSSL 不支持该摘要算法")?
        }
        _ => return Err("不支持的摘要算法".into()),
    };
    Ok(md)
}
fn legacy(alg: &str) -> Vec<String> {
    if alg.contains("MD5")
        || alg.contains("SHA1")
        || alg.contains("PKCS1")
        || alg.contains("ECB")
        || alg.contains("3DES")
    {
        vec!["此算法/模式主要用于旧系统兼容；新系统应优先使用现代认证加密或强摘要签名。".into()]
    } else {
        vec![]
    }
}
fn generate(r: &Request) -> Res<PKey<Private>> {
    match r.opt("algorithm", "RSA") {
        "RSA" => {
            let bits = u32::try_from(r.num("bits", 2048)?).map_err(|_| "RSA 长度无效")?;
            // OpenSSL itself validates key length; warn on old small keys, do not impose a product quota.
            ssl(Rsa::generate(bits).and_then(PKey::from_rsa))
        }
        "P-256" | "P-384" | "P-521" | "secp256k1" => {
            let nid = match r.opt("algorithm", "RSA") {
                "P-256" => Nid::X9_62_PRIME256V1,
                "P-384" => Nid::SECP384R1,
                "P-521" => Nid::SECP521R1,
                _ => Nid::SECP256K1,
            };
            let group = ssl(EcGroup::from_curve_name(nid))?;
            ssl(EcKey::generate(&group).and_then(PKey::from_ec_key))
        }
        "SM2" => {
            let mut ctx = ssl(PkeyCtx::new_id(Id::SM2))?;
            ssl(ctx.keygen_init())?;
            ssl(ctx.keygen())
        }
        "Ed25519" => ssl(PKey::generate_ed25519()),
        "Ed448" => ssl(PKey::generate_ed448()),
        "X25519" => ssl(PKey::generate_x25519()),
        "X448" => ssl(PKey::generate_x448()),
        _ => Err("请选择支持的非对称密钥算法".into()),
    }
}
fn file(name: &str, data: Vec<u8>, pem: bool) -> Res<KeyFile> {
    Ok(KeyFile {
        name: name.into(),
        data: if pem {
            String::from_utf8(data).map_err(|e| e.to_string())?
        } else {
            STANDARD.encode(data)
        },
        encoding: if pem { "utf8" } else { "base64" }.into(),
    })
}
fn export_private(key: &PKeyRef<Private>, format: &str, pem: bool, pass: &str) -> Res<KeyFile> {
    let data = match format {
        "PKCS8" => {
            if pass.is_empty() {
                if pem {
                    ssl(key.private_key_to_pem_pkcs8())?
                } else {
                    ssl(key.private_key_to_pkcs8())?
                }
            } else if pem {
                ssl(key.private_key_to_pem_pkcs8_passphrase(Cipher::aes_256_cbc(), pass.as_bytes()))?
            } else {
                ssl(key.private_key_to_pkcs8_passphrase(Cipher::aes_256_cbc(), pass.as_bytes()))?
            }
        }
        "PKCS1" => {
            if !pass.is_empty() {
                return Err("带口令导出请选择 PKCS8".into());
            }
            let rsa = ssl(key.rsa()).map_err(|_| "PKCS1 仅适用于 RSA 私钥")?;
            if pem {
                ssl(rsa.private_key_to_pem())?
            } else {
                ssl(rsa.private_key_to_der())?
            }
        }
        "SEC1" => {
            if !pass.is_empty() {
                return Err("带口令导出请选择 PKCS8".into());
            }
            let ec = ssl(key.ec_key()).map_err(|_| "SEC1 仅适用于 EC 私钥")?;
            if pem {
                ssl(ec.private_key_to_pem())?
            } else {
                ssl(ec.private_key_to_der())?
            }
        }
        _ => return Err("不支持的私钥格式".into()),
    };
    file(
        if pem {
            "private_key.pem"
        } else {
            "private_key.der"
        },
        data,
        pem,
    )
}
fn export_public<T: HasPublic>(key: &PKeyRef<T>, format: &str, pem: bool) -> Res<KeyFile> {
    let data = match format {
        "SPKI" => {
            if pem {
                ssl(key.public_key_to_pem())?
            } else {
                ssl(key.public_key_to_der())?
            }
        }
        "PKCS1" => {
            let rsa = ssl(key.rsa()).map_err(|_| "PKCS1 仅适用于 RSA 公钥")?;
            if pem {
                ssl(rsa.public_key_to_pem_pkcs1())?
            } else {
                ssl(rsa.public_key_to_der_pkcs1())?
            }
        }
        _ => return Err("不支持的公钥格式".into()),
    };
    file(
        if pem {
            "public_key.pem"
        } else {
            "public_key.der"
        },
        data,
        pem,
    )
}
fn key_pair_result(r: &Request, key: &PKeyRef<Private>) -> Res<ResultData> {
    let pem = r.opt("fileEncoding", "PEM") == "PEM";
    let private = export_private(
        key,
        r.opt("privateFormat", "PKCS8"),
        pem,
        r.opt("exportPassphrase", ""),
    )?;
    let public = export_public(key, r.opt("publicFormat", "SPKI"), pem)?;
    let mut warnings = Vec::new();
    if key.id() == Id::RSA && key.bits() < 2048 {
        warnings.push("低于 2048 位的 RSA 仅用于兼容旧系统。".into());
    }
    if r.opt("exportPassphrase", "").is_empty() {
        warnings.push("导出的私钥未设置口令保护；请自行保管文件。".into());
    }
    json_output(
        json!({"algorithm":key_algorithm(key),"bits":key.bits(),"fingerprintSha256":fingerprint(key)?,"files":[private,public]}),
        "公私钥已生成或转换",
        warnings,
    )
}
fn keygen(r: &Request) -> Res<ResultData> {
    let alg = r.opt("algorithm", "RSA");
    let len = match alg {
        "AES-128" | "SM4" => Some(16),
        "AES-192" => Some(24),
        "AES-256" | "ChaCha20" => Some(32),
        "HMAC" => Some(usize::try_from(r.num("randomBytes", 32)?).map_err(|_| "随机密钥长度无效")?),
        _ => None,
    };
    if let Some(len) = len {
        if len == 0 {
            return Err("随机密钥必须非空".into());
        }
        let mut key = vec![0; len];
        ssl(rand_bytes(&mut key))?;
        let output = render(&key, r.opt("secretEncoding", "hex"))?;
        let f = KeyFile {
            name: "secret_key.txt".into(),
            data: output,
            encoding: "utf8".into(),
        };
        return json_output(
            json!({"algorithm":alg,"bits":len*8,"files":[f]}),
            "随机密钥已生成",
            vec!["密钥仅在本机生成，请妥善保管。".into()],
        );
    }
    let key = generate(r)?;
    key_pair_result(r, &key)
}
fn keycheck(r: &Request) -> Res<ResultData> {
    let encoding = r.opt("keyEncoding", "auto");
    let a = private(&r.secondary_input, encoding, r.opt("keyPassphrase", ""))?;
    let b = public(&r.input, encoding)?;
    let matched = a.public_eq(&b);
    json_output(
        json!({"matched":matched,"privateFingerprintSha256":fingerprint(&a)?,"publicFingerprintSha256":fingerprint(&b)?,"algorithm":key_algorithm(&a)}),
        if matched {
            "公私钥匹配"
        } else {
            "公私钥不匹配"
        },
        vec![],
    )
}
fn keyconvert(r: &Request) -> Res<ResultData> {
    if r.action == "extract-public" {
        let key = private(
            &r.input,
            r.opt("keyEncoding", "auto"),
            r.opt("keyPassphrase", ""),
        );
        let pem = r.opt("fileEncoding", "PEM") == "PEM";
        let (f, fp) = match key {
            Ok(key) => (
                export_public(&key, r.opt("publicFormat", "SPKI"), pem)?,
                fingerprint(&key)?,
            ),
            Err(_) => {
                let key = public(&r.input, r.opt("keyEncoding", "auto"))?;
                (
                    export_public(&key, r.opt("publicFormat", "SPKI"), pem)?,
                    fingerprint(&key)?,
                )
            }
        };
        return json_output(
            json!({"fingerprintSha256":fp,"files":[f]}),
            "公钥提取或转换完成",
            vec![],
        );
    }
    let key = private(
        &r.input,
        r.opt("keyEncoding", "auto"),
        r.opt("keyPassphrase", ""),
    )?;
    key_pair_result(r, &key)
}
// Reject ambiguous duplicate top-level fields rather than silently picking one.
fn raw_fields(text: &str) -> Res<Vec<(String, Box<RawValue>)>> {
    use serde::de::{MapAccess, Visitor};
    struct Fields;
    impl<'de> Visitor<'de> for Fields {
        type Value = Vec<(String, Box<RawValue>)>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a JSON object with unique keys")
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            let mut result = Vec::new();
            let mut seen = BTreeSet::new();
            while let Some((k, v)) = map.next_entry::<String, Box<RawValue>>()? {
                if !seen.insert(k.clone()) {
                    return Err(serde::de::Error::custom("duplicate top-level key"));
                }
                result.push((k, v));
            }
            Ok(result)
        }
    }
    use serde::de::Deserializer;
    let mut d = serde_json::Deserializer::from_str(text);
    let result = d
        .deserialize_map(Fields)
        .map_err(|_| "JSON 报文不是唯一字段的有效对象")?;
    d.end().map_err(|_| "JSON 报文含多余内容")?;
    Ok(result)
}
fn decode_form_field(text: &str, charset: &str) -> Res<String> {
    let src = text.as_bytes();
    let mut result = Vec::with_capacity(src.len());
    let mut i = 0;
    while i < src.len() {
        match src[i] {
            b'+' => {
                result.push(b' ');
                i += 1;
            }
            b'%' => {
                if i + 2 >= src.len() {
                    return Err("URL 参数包含不完整的百分号编码".into());
                }
                let decoded = unhex(
                    std::str::from_utf8(&src[i + 1..i + 3]).map_err(|_| "URL 百分号编码无效")?,
                )?;
                if decoded.len() != 1 {
                    return Err("URL 百分号编码无效".into());
                }
                result.push(decoded[0]);
                i += 3;
            }
            v => {
                result.push(v);
                i += 1;
            }
        }
    }
    match charset {
        "utf8" => String::from_utf8(result).map_err(|_| "URL 参数不是有效 UTF-8".into()),
        "ascii" if result.is_ascii() => Ok(String::from_utf8(result).unwrap()),
        "gbk" | "gb18030" => {
            let enc = if charset == "gbk" {
                encoding_rs::GBK
            } else {
                encoding_rs::GB18030
            };
            enc.decode_without_bom_handling_and_without_replacement(&result)
                .map(|s| s.into_owned())
                .ok_or("URL 参数不符合选定字符集".into())
        }
        _ => Err("URL 参数解码支持 UTF-8、ASCII、GBK 和 GB18030".into()),
    }
}
fn canonical(r: &Request) -> Res<(String, Option<String>)> {
    let mode = r.opt("messageMode", "raw");
    let signature_field = r.opt("signatureField", "sign");
    match mode {
        "raw" => Ok((r.input.clone(), None)),
        "query" | "query-decoded" | "json-params" => {
            let mut entries = Vec::<(String, String)>::new();
            if mode == "json-params" {
                for (key, val) in raw_fields(&r.input)? {
                    let raw = val.get();
                    let value = if raw.starts_with('"') {
                        serde_json::from_str::<String>(raw).map_err(|_| "JSON 字符串无效")?
                    } else {
                        raw.to_owned()
                    };
                    entries.push((key, value));
                }
            } else {
                for segment in r.input.split('&') {
                    let (k, v) = segment.split_once('=').ok_or("参数必须是 key=value 格式")?;
                    if mode == "query-decoded" {
                        let charset = r.opt("dataEncoding", "utf8");
                        entries.push((
                            decode_form_field(k, charset)?,
                            decode_form_field(v, charset)?,
                        ));
                    } else {
                        entries.push((k.into(), v.into()));
                    }
                }
            }
            let excludes: BTreeSet<_> = r
                .opt("excludeFields", "sign")
                .split(',')
                .map(str::trim)
                .filter(|x| !x.is_empty())
                .collect();
            let mut seen = BTreeSet::new();
            let mut embedded = None;
            let mut parts = Vec::new();
            if r.check("sortFields") {
                entries.sort_by(|a, b| a.0.cmp(&b.0));
            }
            for (k, v) in entries {
                if k.is_empty() || !seen.insert(k.clone()) {
                    return Err("参数名为空或重复，无法确定签名原文".into());
                }
                if k == signature_field {
                    embedded = Some(v.clone());
                }
                if excludes.contains(k.as_str()) || (r.check("skipEmpty") && v.is_empty()) {
                    continue;
                }
                parts.push(format!("{k}{}{v}", r.opt("kvSeparator", "=")));
            }
            Ok((parts.join(r.opt("joinSeparator", "&")), embedded))
        }
        "json-response" => {
            let fields = raw_fields(&r.input)?;
            let name = r.opt("responseField", "");
            if name.is_empty() {
                return Err("请输入同步响应中实际被签名的字段名称".into());
            }
            let content = fields
                .iter()
                .find(|(k, _)| k == name)
                .ok_or("未找到指定响应字段")?
                .1
                .get()
                .to_owned();
            let sig = fields
                .iter()
                .find(|(k, _)| k == signature_field)
                .map(|(_, v)| serde_json::from_str::<String>(v.get()))
                .transpose()
                .map_err(|_| "签名字段必须是字符串")?;
            Ok((content, sig))
        }
        _ => Err("不支持的报文处理方式".into()),
    }
}
fn signature_digest(alg: &str) -> Res<Option<MessageDigest>> {
    if alg == "SM2-SM3" {
        return Ok(Some(MessageDigest::sm3()));
    }
    if matches!(alg, "Ed25519" | "Ed448") {
        return Ok(None);
    }
    if let Some(s) = alg
        .strip_prefix("RSA-PSS-")
        .or_else(|| alg.strip_prefix("RSA-"))
        .or_else(|| alg.strip_prefix("ECDSA-"))
    {
        return digest(s).map(Some);
    }
    Err("不支持的签名算法".into())
}
fn check_sig_key<T: HasPublic>(key: &PKeyRef<T>, alg: &str) -> Res<()> {
    let valid = if alg.starts_with("RSA-") {
        key.id() == Id::RSA
    } else if alg == "SM2-SM3" {
        is_sm2(key)
    } else if alg.starts_with("ECDSA-") {
        key.id() == Id::EC && !is_sm2(key)
    } else if alg == "Ed25519" {
        key.id() == Id::ED25519
    } else if alg == "Ed448" {
        key.id() == Id::ED448
    } else {
        false
    };
    if valid {
        Ok(())
    } else {
        Err("所选签名算法与密钥类型不匹配".into())
    }
}
fn signature(r: &Request) -> Res<ResultData> {
    let alg = r.opt("signatureAlgorithm", "RSA-SHA256");
    let md = signature_digest(alg)?;
    let (message, embedded) = canonical(r)?;
    let charset = r.opt("dataEncoding", "utf8");
    if charset == "base64" || charset == "hex" {
        if r.opt("messageMode", "raw") != "raw" {
            return Err("二进制输入仅支持原始报文模式".into());
        }
    }
    let data = bytes(&message, charset)?;
    let mut warnings = legacy(alg);
    if r.action == "sign" {
        let key = private(
            &r.secondary_input,
            r.opt("keyEncoding", "auto"),
            r.opt("keyPassphrase", ""),
        )?;
        check_sig_key(&key, alg)?;
        if alg == "SM2-SM3" {
            let mut ctx = ssl(MdCtx::new())?;
            sm2_id(ssl(ctx.digest_sign_init(Some(Md::sm3()), &key))?, r)?;
            ssl(ctx.digest_sign_update(&data))?;
            let mut sig = Vec::new();
            ssl(ctx.digest_sign_final_to_vec(&mut sig))?;
            return json_output(
                json!({"signature":render(&sig,r.opt("signatureEncoding","base64"))?,"algorithm":alg,"signedContent":message,"signedBytes":data.len(),"encoding":charset}),
                "签名完成",
                warnings,
            );
        }
        let mut signer = if let Some(md) = md {
            ssl(Signer::new(md, &key))?
        } else {
            ssl(Signer::new_without_digest(&key))?
        };
        if alg.starts_with("RSA-PSS-") {
            let md = md.unwrap();
            ssl(signer.set_rsa_padding(Padding::PKCS1_PSS))?;
            ssl(signer.set_rsa_mgf1_md(digest(r.opt("mgfDigest", "SHA256"))?))?;
            let salt = i32::try_from(r.num("saltLength", md.size() as u64)?)
                .map_err(|_| "PSS 盐长度无效")?;
            ssl(signer.set_rsa_pss_saltlen(RsaPssSaltlen::custom(salt)))?;
        }
        let sig = ssl(signer.sign_oneshot_to_vec(&data))?;
        let value = render(&sig, r.opt("signatureEncoding", "base64"))?;
        return json_output(
            json!({"signature":value,"algorithm":alg,"signedContent":message,"signedBytes":data.len(),"encoding":charset}),
            "签名完成",
            warnings,
        );
    }
    if r.action != "verify" {
        return Err("无效的签名操作".into());
    }
    let key = public(&r.secondary_input, r.opt("keyEncoding", "auto"))?;
    check_sig_key(&key, alg)?;
    let supplied = r.opt("signature", "");
    let signature = if supplied.is_empty() {
        embedded.ok_or("请输入签名或包含签名字段的报文")?
    } else {
        supplied.into()
    };
    let sig = bytes(&signature, r.opt("signatureEncoding", "base64"))?;
    if alg == "SM2-SM3" {
        let mut ctx = ssl(MdCtx::new())?;
        sm2_id(ssl(ctx.digest_verify_init(Some(Md::sm3()), &key))?, r)?;
        ssl(ctx.digest_verify_update(&data))?;
        let valid = ctx.digest_verify_final(&sig).unwrap_or(false);
        return json_output(
            json!({"valid":valid,"algorithm":alg,"signedContent":message,"signedBytes":data.len(),"encoding":charset}),
            if valid {
                "验签通过"
            } else {
                "验签失败"
            },
            warnings,
        );
    }
    let mut verifier = if let Some(md) = md {
        ssl(Verifier::new(md, &key))?
    } else {
        ssl(Verifier::new_without_digest(&key))?
    };
    if alg.starts_with("RSA-PSS-") {
        let md = md.unwrap();
        ssl(verifier.set_rsa_padding(Padding::PKCS1_PSS))?;
        ssl(verifier.set_rsa_mgf1_md(digest(r.opt("mgfDigest", "SHA256"))?))?;
        let salt =
            i32::try_from(r.num("saltLength", md.size() as u64)?).map_err(|_| "PSS 盐长度无效")?;
        ssl(verifier.set_rsa_pss_saltlen(RsaPssSaltlen::custom(salt)))?;
    }
    let valid = verifier.verify_oneshot(&sig, &data).unwrap_or(false);
    if !valid {
        warnings.push("签名未通过：核对原文、密钥、算法、编码及签名格式。".into());
    }
    json_output(
        json!({"valid":valid,"algorithm":alg,"signedContent":message,"signedBytes":data.len(),"encoding":charset}),
        if valid {
            "验签通过"
        } else {
            "验签失败"
        },
        warnings,
    )
}
fn asymmetric(r: &Request) -> Res<ResultData> {
    let alg = r.opt("algorithm", "RSA-OAEP");
    let rsa = alg != "SM2-ASN1";
    let padding = match alg {
        "RSA-OAEP" => Padding::PKCS1_OAEP,
        "RSA-PKCS1" => Padding::PKCS1,
        "SM2-ASN1" => Padding::NONE,
        _ => return Err("不支持的加密算法".into()),
    };
    let enc = r.opt("outputEncoding", "base64");
    let data_encoding = r.opt("dataEncoding", "utf8");
    let mut warnings = legacy(alg);
    if rsa {
        warnings.push("RSA 仅支持单次合法长度的数据块，不自动分块。大文件请使用混合加密。".into());
    }
    if r.action == "encrypt" {
        let k = public(&r.secondary_input, r.opt("keyEncoding", "auto"))?;
        if rsa && k.id() != Id::RSA {
            return Err("RSA 加密需要 RSA 公钥".into());
        }
        if !rsa && !is_sm2(&k) {
            return Err("SM2 加密需要 SM2 公钥".into());
        }
        let mut op = ssl(Encrypter::new(&k))?;
        if rsa {
            ssl(op.set_rsa_padding(padding))?;
            if alg == "RSA-OAEP" {
                ssl(op.set_rsa_oaep_md(digest(r.opt("oaepDigest", "SHA256"))?))?;
                ssl(op.set_rsa_mgf1_md(digest(r.opt("mgfDigest", "SHA256"))?))?;
                if !r.opt("oaepLabel", "").is_empty() {
                    ssl(op.set_rsa_oaep_label(r.opt("oaepLabel", "").as_bytes()))?;
                }
            }
        }
        let data = bytes(&r.input, data_encoding)?;
        let mut out = vec![0; ssl(op.encrypt_len(&data))?];
        let n = ssl(op.encrypt(&data, &mut out))?;
        out.truncate(n);
        return Ok(text_output(render(&out, enc)?, "加密完成", warnings));
    }
    if r.action != "decrypt" {
        return Err("无效的加解密操作".into());
    }
    let k = private(
        &r.secondary_input,
        r.opt("keyEncoding", "auto"),
        r.opt("keyPassphrase", ""),
    )?;
    if rsa && k.id() != Id::RSA {
        return Err("RSA 解密需要 RSA 私钥".into());
    }
    if !rsa && !is_sm2(&k) {
        return Err("SM2 解密需要 SM2 私钥".into());
    }
    let mut op = ssl(Decrypter::new(&k))?;
    if rsa {
        ssl(op.set_rsa_padding(padding))?;
        if alg == "RSA-OAEP" {
            ssl(op.set_rsa_oaep_md(digest(r.opt("oaepDigest", "SHA256"))?))?;
            ssl(op.set_rsa_mgf1_md(digest(r.opt("mgfDigest", "SHA256"))?))?;
            if !r.opt("oaepLabel", "").is_empty() {
                ssl(op.set_rsa_oaep_label(r.opt("oaepLabel", "").as_bytes()))?;
            }
        }
    }
    let data = bytes(&r.input, enc)?;
    let mut out = vec![0; ssl(op.decrypt_len(&data))?];
    let n = ssl(op.decrypt(&data, &mut out))?;
    out.truncate(n);
    Ok(text_output(
        render(&out, data_encoding)?,
        "解密完成",
        warnings,
    ))
}
fn symmetric(r: &Request) -> Res<ResultData> {
    let alg = r.opt("algorithm", "AES-256-GCM");
    let cipher = match alg {
        "AES-128-CTR" => Cipher::aes_128_ctr(),
        "AES-192-CTR" => Cipher::aes_192_ctr(),
        "AES-256-CTR" => Cipher::aes_256_ctr(),
        "AES-128-CFB" => Cipher::aes_128_cfb128(),
        "AES-192-CFB" => Cipher::aes_192_cfb128(),
        "AES-256-CFB" => Cipher::aes_256_cfb128(),
        "AES-128-OFB" => Cipher::aes_128_ofb(),
        "AES-192-OFB" => Cipher::aes_192_ofb(),
        "AES-256-OFB" => Cipher::aes_256_ofb(),
        "AES-128-GCM" => Cipher::aes_128_gcm(),
        "AES-192-GCM" => Cipher::aes_192_gcm(),
        "AES-256-GCM" => Cipher::aes_256_gcm(),
        "SM4-ECB" => Cipher::sm4_ecb(),
        "SM4-CBC" => Cipher::sm4_cbc(),
        "SM4-CTR" => Cipher::sm4_ctr(),
        "SM4-CFB" => Cipher::sm4_cfb128(),
        "SM4-OFB" => Cipher::sm4_ofb(),
        "3DES-ECB" => Cipher::des_ede3_ecb(),
        "3DES-CBC" => Cipher::des_ede3_cbc(),
        "ChaCha20" => Cipher::chacha20(),
        "ChaCha20-Poly1305" => Cipher::chacha20_poly1305(),
        _ => return Err("不支持的对称算法".into()),
    };
    let key = bytes(r.opt("rawKey", ""), r.opt("keyEncoding", "hex"))?;
    if key.len() != cipher.key_len() {
        return Err(format!("密钥必须为 {} 字节", cipher.key_len()));
    }
    let iv = bytes(r.opt("iv", ""), r.opt("ivEncoding", "hex"))?;
    if iv.len() != cipher.iv_len().unwrap_or(0) {
        return Err(format!(
            "IV / Nonce 必须为 {} 字节",
            cipher.iv_len().unwrap_or(0)
        ));
    }
    let iv = if iv.is_empty() {
        None
    } else {
        Some(iv.as_slice())
    };
    let encrypt = r.action == "encrypt";
    if !encrypt && r.action != "decrypt" {
        return Err("无效的加解密操作".into());
    }
    let plain = r.opt("dataEncoding", "utf8");
    let encoded = r.opt("outputEncoding", "base64");
    let data = bytes(&r.input, if encrypt { plain } else { encoded })?;
    let aead = alg.ends_with("-GCM") || alg == "ChaCha20-Poly1305";
    let mut warnings = legacy(alg);
    let output = if aead {
        warnings.push("同一 Key 下不要重复使用 Nonce；输出认证标签固定为末尾 16 字节。".into());
        let aad = bytes(r.opt("aad", ""), r.opt("aadEncoding", "utf8"))?;
        if encrypt {
            let mut tag = [0; 16];
            let mut out = ssl(encrypt_aead(cipher, &key, iv, &aad, &data, &mut tag))?;
            out.extend(tag);
            out
        } else {
            if data.len() < 16 {
                return Err("密文缺少末尾 16 字节认证标签".into());
            }
            let (body, tag) = data.split_at(data.len() - 16);
            ssl(decrypt_aead(cipher, &key, iv, &aad, body, tag))?
        }
    } else {
        warnings.push("该模式不认证密文完整性，请勿将成功解密视为完整性验证。".into());
        let mut op = ssl(Crypter::new(
            cipher,
            if encrypt {
                Mode::Encrypt
            } else {
                Mode::Decrypt
            },
            &key,
            iv,
        ))?;
        let block = alg.ends_with("-CBC") || alg.ends_with("-ECB");
        op.pad(block && r.opt("padding", "pkcs7") == "pkcs7");
        let mut out = vec![
            0;
            data.len()
                .checked_add(cipher.block_size())
                .ok_or("输出长度溢出")?
        ];
        let n = ssl(op.update(&data, &mut out))?;
        let final_n = ssl(op.finalize(&mut out[n..]))?;
        out.truncate(n + final_n);
        out
    };
    Ok(text_output(
        render(&output, if encrypt { encoded } else { plain })?,
        "对称加解密完成",
        warnings,
    ))
}
fn hash_tool(r: &Request) -> Res<ResultData> {
    let alg = r.opt("algorithm", "SHA256");
    let data = bytes(&r.input, r.opt("dataEncoding", "utf8"))?;
    let md = digest(alg)?;
    let out = if r.action == "hmac" {
        let key = ssl(PKey::hmac(&bytes(
            r.opt("rawKey", ""),
            r.opt("keyEncoding", "utf8"),
        )?))?;
        let mut signer = ssl(Signer::new(md, &key))?;
        ssl(signer.sign_oneshot_to_vec(&data))?
    } else if r.action == "hash" {
        ssl(hash(md, &data))?.to_vec()
    } else {
        return Err("无效的摘要操作".into());
    };
    Ok(text_output(
        render(&out, r.opt("outputEncoding", "hex"))?,
        "摘要计算完成",
        legacy(alg),
    ))
}
fn kdf(r: &Request) -> Res<ResultData> {
    let alg = r.opt("algorithm", "PBKDF2");
    let pass = bytes(&r.input, r.opt("dataEncoding", "utf8"))?;
    let salt = bytes(r.opt("salt", ""), r.opt("saltEncoding", "hex"))?;
    let size = usize::try_from(r.num("derivedBytes", 32)?).map_err(|_| "派生长度无效")?;
    if size == 0 {
        return Err("派生密钥长度必须大于 0".into());
    }
    let mut key = vec![0; size];
    if alg == "PBKDF2" {
        let iterations =
            usize::try_from(r.num("iterations", 600000)?).map_err(|_| "迭代次数无效")?;
        ssl(openssl::pkcs5::pbkdf2_hmac(
            &pass,
            &salt,
            iterations,
            digest(r.opt("digest", "SHA256"))?,
            &mut key,
        ))?;
    } else if alg == "HKDF" {
        let digest = digest(r.opt("digest", "SHA256"))?;
        if size > 255 * digest.size() {
            return Err("HKDF 输出长度超过 RFC 5869 的 255 × 摘要字节数".into());
        }
        let md = Md::from_nid(digest.type_()).ok_or("HKDF 摘要不支持")?;
        let mut ctx = ssl(PkeyCtx::new_id(Id::HKDF))?;
        ssl(ctx.derive_init())?;
        ssl(ctx.set_hkdf_md(md))?;
        ssl(ctx.set_hkdf_key(&pass))?;
        ssl(ctx.set_hkdf_salt(&salt))?;
        let info = bytes(r.opt("info", ""), r.opt("infoEncoding", "utf8"))?;
        ssl(ctx.add_hkdf_info(&info))?;
        let n = ssl(ctx.derive(Some(&mut key)))?;
        key.truncate(n);
    } else if alg == "scrypt" {
        let n = r.num("scryptN", 16384)?;
        let rr = r.num("scryptR", 8)?;
        let p = r.num("scryptP", 1)?;
        // Set OpenSSL's memory budget from the requested cost; no arbitrary user quota.
        let mem = 128u64
            .checked_mul(n)
            .and_then(|x| x.checked_mul(rr))
            .and_then(|x| x.checked_add(128u64.checked_mul(rr)?.checked_mul(p)?))
            .and_then(|x| x.checked_add(1024 * 1024))
            .ok_or("scrypt 参数溢出")?;
        ssl(openssl::pkcs5::scrypt(
            &pass, &salt, n, rr, p, mem, &mut key,
        ))?;
    } else {
        return Err("不支持的派生算法".into());
    }
    Ok(text_output(
        render(&key, r.opt("outputEncoding", "hex"))?,
        "密钥派生完成",
        vec!["请保留 Salt、算法及参数以便重现派生结果。".into()],
    ))
}
fn certificate(r: &Request) -> Res<ResultData> {
    if r.action == "inspect" {
        let data = key_bytes(&r.input, r.opt("keyEncoding", "auto"))?;
        let cert = if data.starts_with(b"-----BEGIN ") {
            ssl(X509::from_pem(&data))?
        } else {
            ssl(X509::from_der(&data))?
        };
        let pk = ssl(cert.public_key())?;
        let names = |n: &openssl::x509::X509NameRef| {
            n.entries()
                .map(|e| {
                    format!(
                        "{}={}",
                        e.object().nid().short_name().unwrap_or("?"),
                        e.data().to_string().unwrap_or_default()
                    )
                })
                .collect::<Vec<_>>()
        };
        return json_output(
            json!({"subject":names(cert.subject_name()),"issuer":names(cert.issuer_name()),"notBefore":cert.not_before().to_string(),"notAfter":cert.not_after().to_string(),"serial":ssl(cert.serial_number().to_bn().and_then(|n|n.to_hex_str()))?.to_string(),"publicKeyFingerprintSha256":fingerprint(&pk)?,"certificateSha256":hex(&ssl(cert.digest(MessageDigest::sha256()))?),"publicKey":String::from_utf8_lossy(&ssl(pk.public_key_to_pem())?)}),
            "证书解析完成",
            vec!["解析证书不等于验证证书链或信任关系。".into()],
        );
    }
    let key = private(
        &r.secondary_input,
        r.opt("keyEncoding", "auto"),
        r.opt("keyPassphrase", ""),
    )?;
    let common = r.opt("commonName", "");
    if common.trim().is_empty() {
        return Err("请输入 Common Name (CN)".into());
    }
    let mut name = ssl(X509NameBuilder::new())?;
    ssl(name.append_entry_by_text("CN", common))?;
    for (field, tag) in [
        ("organization", "O"),
        ("countryCode", "C"),
        ("organizationalUnit", "OU"),
    ] {
        let value = r.opt(field, "");
        if !value.is_empty() {
            ssl(name.append_entry_by_text(tag, value))?;
        }
    }
    let name = name.build();
    let md = if matches!(key.id(), Id::ED25519 | Id::ED448) {
        MessageDigest::null()
    } else {
        MessageDigest::sha256()
    };
    if r.action == "csr" {
        let mut builder = ssl(X509ReqBuilder::new())?;
        ssl(builder.set_subject_name(&name))?;
        ssl(builder.set_pubkey(&key))?;
        ssl(builder.sign(&key, md))?;
        let req: X509Req = builder.build();
        let f = file("certificate.csr", ssl(req.to_pem())?, true)?;
        return json_output(
            json!({"files":[f],"commonName":common}),
            "CSR 已生成",
            vec!["CSR 尚未由 CA 签发。".into()],
        );
    }
    if r.action != "self-sign" {
        return Err("无效的证书操作".into());
    }
    let mut serial = ssl(BigNum::new())?;
    ssl(serial.rand(128, MsbOption::ONE, false))?;
    let serial: Asn1Integer = ssl(serial.to_asn1_integer())?;
    let days = u32::try_from(r.num("validDays", 365)?).map_err(|_| "有效天数无效")?;
    if days == 0 {
        return Err("有效天数必须大于 0".into());
    }
    let start = ssl(Asn1Time::days_from_now(0))?;
    let end = ssl(Asn1Time::days_from_now(days))?;
    let mut builder = ssl(X509::builder())?;
    ssl(builder.set_version(2))?;
    ssl(builder.set_serial_number(&serial))?;
    ssl(builder.set_subject_name(&name))?;
    ssl(builder.set_issuer_name(&name))?;
    ssl(builder.set_pubkey(&key))?;
    ssl(builder.set_not_before(&start))?;
    ssl(builder.set_not_after(&end))?;
    ssl(builder.sign(&key, md))?;
    let f = file("certificate.pem", ssl(builder.build().to_pem())?, true)?;
    json_output(
        json!({"files":[f],"commonName":common,"validDays":days}),
        "自签名证书已生成",
        vec!["自签名证书不代表可信 CA 签发的 TLS 证书；当前不自动添加 SAN 或 CA 扩展。".into()],
    )
}
pub fn execute(r: &Request) -> Res<ResultData> {
    match r.tool_id.as_str() {
        "keygen" if r.action == "generate" => keygen(r),
        "keycheck" if r.action == "match" => keycheck(r),
        "keyconvert" if matches!(r.action.as_str(), "convert" | "extract-public") => keyconvert(r),
        "signature" => signature(r),
        "asymmetric" => asymmetric(r),
        "symmetric" => symmetric(r),
        "crypto-hash" => hash_tool(r),
        "kdf" if r.action == "derive" => kdf(r),
        "certificate" => certificate(r),
        _ => Err("未知密码学工具".into()),
    }
}
#[derive(Serialize, Deserialize)]
struct KeySettings {
    directory: PathBuf,
}
/// Directory preference is separate from session/history data.
pub fn load_key_directory(path: &Path) -> Res<Option<PathBuf>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<KeySettings>(&bytes)
            .map(|s| Some(s.directory))
            .map_err(|_| "密钥目录配置损坏，请重新选择目录".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("无法读取密钥目录配置：{e}")),
    }
}
pub fn store_key_directory(path: &Path, directory: PathBuf) -> Res<()> {
    let parent = path.parent().ok_or("无法定位配置目录")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    let data = serde_json::to_vec_pretty(&KeySettings { directory }).map_err(|e| e.to_string())?;
    temp.write_all(&data)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
// The adapter supplies a user-selected parent folder. Never overwrite an existing
// key directory; keep private-key files and their containing directory owner-only on Unix.
pub fn save_key_files(parent: &Path, name: &str, files: &[KeyFile]) -> Res<PathBuf> {
    let valid_name = |s: &str| {
        !s.is_empty()
            && s.trim() == s
            && s != "."
            && s != ".."
            && !s.ends_with(['.', ' '])
            && !s
                .chars()
                .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
            && !matches!(
                s.split('.')
                    .next()
                    .unwrap_or("")
                    .to_ascii_uppercase()
                    .as_str(),
                "CON"
                    | "PRN"
                    | "AUX"
                    | "NUL"
                    | "COM1"
                    | "COM2"
                    | "COM3"
                    | "COM4"
                    | "COM5"
                    | "COM6"
                    | "COM7"
                    | "COM8"
                    | "COM9"
                    | "LPT1"
                    | "LPT2"
                    | "LPT3"
                    | "LPT4"
                    | "LPT5"
                    | "LPT6"
                    | "LPT7"
                    | "LPT8"
                    | "LPT9"
            )
    };
    if !valid_name(name) || files.is_empty() {
        return Err("请输入合法的密钥名称，并先生成或转换密钥".into());
    }
    let mut seen = BTreeSet::new();
    let mut prepared = Vec::new();
    for f in files {
        if !matches!(
            f.name.as_str(),
            "private_key.pem"
                | "private_key.der"
                | "public_key.pem"
                | "public_key.der"
                | "secret_key.txt"
                | "certificate.csr"
                | "certificate.pem"
        ) || !seen.insert(f.name.as_str())
        {
            return Err("导出文件名无效或重复".into());
        }
        let data = match f.encoding.as_str() {
            "utf8" => f.data.as_bytes().to_vec(),
            "base64" => b64(&f.data)?,
            _ => return Err("导出编码无效".into()),
        };
        prepared.push((f.name.as_str(), data));
    }
    fs::create_dir_all(parent).map_err(|e| format!("无法创建保存目录：{e}"))?;
    let dir = parent.join(name);
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(&dir)
        .map_err(|e| format!("无法创建密钥目录（同名目录不会覆盖）：{e}"))?;
    let mut created = Vec::new();
    let result = (|| -> Res<()> {
        for (name, data) in prepared {
            let path = dir.join(name);
            let mut opts = fs::OpenOptions::new();
            opts.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            let mut f = opts.open(&path).map_err(|e| e.to_string())?;
            created.push(path);
            f.write_all(&data)
                .and_then(|_| f.sync_all())
                .map_err(|e| e.to_string())?;
        }
        let path = dir.join("metadata.json");
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        created.push(path);
        let meta = serde_json::to_vec_pretty(&json!({"name":name,"files":seen}))
            .map_err(|e| e.to_string())?;
        f.write_all(&meta)
            .and_then(|_| f.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(e) = result {
        for p in created {
            let _ = fs::remove_file(p);
        }
        let _ = fs::remove_dir(&dir);
        return Err(format!("密钥保存失败：{e}"));
    }
    Ok(dir)
}

pub fn encode_der(data: &[u8]) -> String {
    STANDARD.encode(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(tool: &str, action: &str, input: &str, secondary: &str, options: Value) -> Request {
        Request {
            tool_id: tool.into(),
            action: action.into(),
            input: input.into(),
            secondary_input: secondary.into(),
            options: serde_json::from_value(options).unwrap(),
        }
    }
    fn value(r: Request) -> Value {
        serde_json::from_str(&execute(&r).unwrap().output).unwrap()
    }
    fn keys(alg: &str) -> (String, String) {
        let v = value(req(
            "keygen",
            "generate",
            "",
            "",
            json!({"algorithm":alg,"bits":2048}),
        ));
        (
            v["files"][0]["data"].as_str().unwrap().into(),
            v["files"][1]["data"].as_str().unwrap().into(),
        )
    }

    #[test]
    fn rsa_sha1_sha256_pss_and_formats() {
        let (private_key, public_key) = keys("RSA");
        let msg = "My Tools 签名互通";
        for alg in [
            "RSA-SHA1",
            "RSA-SHA256",
            "RSA-SHA512",
            "RSA-SHA3-256",
            "RSA-PSS-SHA256",
            "RSA-MD5",
        ] {
            let sig = value(req(
                "signature",
                "sign",
                msg,
                &private_key,
                json!({"signatureAlgorithm":alg}),
            ));
            let options = json!({"signatureAlgorithm":alg,"signature":sig["signature"]});
            let verify = value(req(
                "signature",
                "verify",
                msg,
                &public_key,
                options.clone(),
            ));
            assert_eq!(verify["valid"], true, "{alg}");
            assert_eq!(
                value(req(
                    "signature",
                    "verify",
                    "different",
                    &public_key,
                    options
                ))["valid"],
                false
            );
        }
        let matched = value(req(
            "keycheck",
            "match",
            &public_key,
            &private_key,
            json!({}),
        ));
        assert_eq!(matched["matched"], true);
        let converted = value(req(
            "keyconvert",
            "convert",
            &private_key,
            "",
            json!({"privateFormat":"PKCS1","publicFormat":"PKCS1","fileEncoding":"DER"}),
        ));
        let files = converted["files"].as_array().unwrap();
        let key = files[0]["data"].as_str().unwrap();
        let pubkey = files[1]["data"].as_str().unwrap();
        assert_eq!(
            value(req("keycheck", "match", pubkey, key, json!({})))["matched"],
            true
        );
        let encrypted = value(req(
            "keyconvert",
            "convert",
            &private_key,
            "",
            json!({"fileEncoding":"DER","exportPassphrase":"test passphrase"}),
        ));
        let enc = encrypted["files"][0]["data"].as_str().unwrap();
        assert_eq!(
            value(req(
                "keycheck",
                "match",
                &public_key,
                enc,
                json!({"keyPassphrase":"test passphrase"})
            ))["matched"],
            true
        );
        assert!(execute(&req(
            "keycheck",
            "match",
            &public_key,
            enc,
            json!({"keyPassphrase":"wrong"})
        ))
        .is_err());
    }

    #[test]
    fn rsa_oaep_and_legacy_pkcs1() {
        let (sk, pk) = keys("RSA");
        for options in [
            json!({"algorithm":"RSA-OAEP","oaepDigest":"SHA256","mgfDigest":"SHA1","oaepLabel":"test"}),
            json!({"algorithm":"RSA-PKCS1"}),
        ] {
            let msg = "hello 世界";
            let cipher = execute(&req("asymmetric", "encrypt", msg, &pk, options.clone()))
                .unwrap()
                .output;
            assert_eq!(
                execute(&req("asymmetric", "decrypt", &cipher, &sk, options))
                    .unwrap()
                    .output,
                msg
            );
        }
    }

    #[test]
    fn modern_key_generation_and_signatures() {
        for (kind, alg) in [
            ("P-256", "ECDSA-SHA256"),
            ("P-384", "ECDSA-SHA384"),
            ("P-521", "ECDSA-SHA512"),
            ("secp256k1", "ECDSA-SHA256"),
            ("Ed25519", "Ed25519"),
            ("Ed448", "Ed448"),
        ] {
            let (sk, pk) = keys(kind);
            let sig = value(req(
                "signature",
                "sign",
                "message",
                &sk,
                json!({"signatureAlgorithm":alg}),
            ));
            assert_eq!(
                value(req(
                    "signature",
                    "verify",
                    "message",
                    &pk,
                    json!({"signatureAlgorithm":alg,"signature":sig["signature"]})
                ))["valid"],
                true,
                "{kind}"
            );
        }
        for alg in ["X25519", "X448"] {
            let (sk, pk) = keys(alg);
            assert_eq!(
                value(req("keycheck", "match", &pk, &sk, json!({})))["matched"],
                true
            );
        }
    }

    #[test]
    fn sm2_keypair_and_asn1_encryption() {
        let (sk, pk) = keys("SM2");
        let matched = value(req("keycheck", "match", &pk, &sk, json!({})));
        assert_eq!(matched["matched"], true);
        let options = json!({"algorithm":"SM2-ASN1"});
        let encrypted = execute(&req(
            "asymmetric",
            "encrypt",
            "hello SM2",
            &pk,
            options.clone(),
        ))
        .unwrap()
        .output;
        assert_eq!(
            execute(&req("asymmetric", "decrypt", &encrypted, &sk, options))
                .unwrap()
                .output,
            "hello SM2"
        );
    }

    #[test]
    fn response_preserves_exact_json_and_form_fields() {
        let raw = r#"{"result":{ "id":900719925474099312345, "text":"a\/b" },"sign":"abc"}"#;
        let r = req(
            "signature",
            "verify",
            raw,
            "",
            json!({"messageMode":"json-response","responseField":"result"}),
        );
        let (msg, sig) = canonical(&r).unwrap();
        assert_eq!(msg, r#"{ "id":900719925474099312345, "text":"a\/b" }"#);
        assert_eq!(sig.as_deref(), Some("abc"));
        let r = req(
            "signature",
            "verify",
            "z=3&sign=abc&a=one+two",
            "",
            json!({"messageMode":"query-decoded","sortFields":true,"excludeFields":"sign"}),
        );
        assert_eq!(
            canonical(&r).unwrap(),
            ("a=one two&z=3".into(), Some("abc".into()))
        );
        assert!(canonical(&req(
            "signature",
            "verify",
            r#"{"a":1,"a":2}"#,
            "",
            json!({"messageMode":"json-params"})
        ))
        .is_err());
    }

    #[test]
    fn symmetric_cipher_and_kdf_vectors() {
        for (alg, key, iv) in [
            ("AES-256-GCM", "00".repeat(32), "00".repeat(12)),
            ("SM4-CBC", "01".repeat(16), "02".repeat(16)),
            ("AES-128-CTR", "03".repeat(16), "04".repeat(16)),
            ("ChaCha20-Poly1305", "05".repeat(32), "06".repeat(12)),
            (
                "3DES-CBC",
                "0123456789abcdef23456789abcdef01456789abcdef0123".into(),
                "11".repeat(8),
            ),
        ] {
            let opts = json!({"algorithm":alg,"rawKey":key,"iv":iv});
            let msg = "本地密码学工具";
            let encrypted = execute(&req("symmetric", "encrypt", msg, "", opts.clone()))
                .unwrap()
                .output;
            assert_eq!(
                execute(&req("symmetric", "decrypt", &encrypted, "", opts))
                    .unwrap()
                    .output,
                msg,
                "{alg}"
            );
        }
        let hash = execute(&req(
            "crypto-hash",
            "hash",
            "abc",
            "",
            json!({"algorithm":"SHA256"}),
        ))
        .unwrap()
        .output;
        assert_eq!(
            hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let derived=execute(&req("kdf","derive","password","",json!({"algorithm":"PBKDF2","salt":"salt","saltEncoding":"utf8","iterations":1,"digest":"SHA1","derivedBytes":20}))).unwrap().output;
        assert_eq!(derived, "0c60c80f961f0e71f3a9b524af6012062fe037a6");
    }

    #[test]
    fn named_directory_and_certificate() {
        let (sk, pk) = keys("RSA");
        let opts = json!({"commonName":"example.test","organization":"My Tools"});
        let cert = value(req("certificate", "self-sign", "", &sk, opts.clone()));
        let files: Vec<KeyFile> = serde_json::from_value(cert["files"].clone()).unwrap();
        let parsed = value(req("certificate", "inspect", &files[0].data, "", json!({})));
        assert_eq!(parsed["publicKey"].as_str().unwrap(), pk);
        let csr = value(req("certificate", "csr", "", &sk, opts));
        assert!(csr["files"][0]["data"]
            .as_str()
            .unwrap()
            .contains("BEGIN CERTIFICATE REQUEST"));
        let dir = tempfile::tempdir().unwrap();
        let key_file = KeyFile {
            name: "private_key.pem".into(),
            data: sk,
            encoding: "utf8".into(),
        };
        let path = save_key_files(dir.path(), "project-name", &[key_file.clone()]).unwrap();
        assert!(path.join("private_key.pem").is_file());
        assert!(path.join("metadata.json").is_file());
        assert!(save_key_files(dir.path(), "project-name", &[key_file.clone()]).is_err());
        assert!(save_key_files(dir.path(), "../bad", &[key_file]).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path.join("private_key.pem"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn sm2_signature_with_explicit_id() {
        let (sk, pk) = keys("SM2");
        let options = json!({"signatureAlgorithm":"SM2-SM3","sm2UserId":"project-test-id"});
        let sig = value(req("signature", "sign", "SM2 data", &sk, options.clone()));
        let mut verify = options.clone();
        verify["signature"] = sig["signature"].clone();
        assert_eq!(
            value(req("signature", "verify", "SM2 data", &pk, verify.clone()))["valid"],
            true
        );
        verify["sm2UserId"] = json!("other-id");
        assert_eq!(
            value(req("signature", "verify", "SM2 data", &pk, verify))["valid"],
            false
        );
    }
    #[test]
    fn rfc5869_hkdf_sha256() {
        let result=execute(&req("kdf","derive",&"0b".repeat(22),"",json!({"algorithm":"HKDF","dataEncoding":"hex","salt":"000102030405060708090a0b0c","saltEncoding":"hex","info":"f0f1f2f3f4f5f6f7f8f9","infoEncoding":"hex","derivedBytes":42,"digest":"SHA256"}))).unwrap();
        assert_eq!(
            result.output,
            "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"
        );
    }
    #[test]
    fn json_order_and_strict_form_charset() {
        let r = req(
            "signature",
            "verify",
            r#"{"z":1,"a":2}"#,
            "",
            json!({"messageMode":"json-params","sortFields":false}),
        );
        assert_eq!(canonical(&r).unwrap().0, "z=1&a=2");
        let r = req(
            "signature",
            "verify",
            "name=%D6%D0%CE%C4",
            "",
            json!({"messageMode":"query-decoded","dataEncoding":"gbk"}),
        );
        assert_eq!(canonical(&r).unwrap().0, "name=中文");
        let r = req(
            "signature",
            "verify",
            "name=%FF",
            "",
            json!({"messageMode":"query-decoded","dataEncoding":"utf8"}),
        );
        assert!(canonical(&r).is_err());
    }

    #[test]
    fn independent_node_rsa_and_openssl_sm2_interop() {
        use std::process::Command;
        let dir = tempfile::tempdir().unwrap();
        let message = "interop 测试";
        let msg = dir.path().join("message.txt");
        let public_path = dir.path().join("public.pem");
        let sig_path = dir.path().join("signature.bin");
        fs::write(&msg, message).unwrap();
        // The system OpenSSL may disallow SHA-1 under its distro policy.
        // Verify the legacy RSA signature using Node's separate crypto backend.
        if Command::new("node").arg("--version").output().is_ok() {
            let (sk, pk) = keys("RSA");
            fs::write(&public_path, pk).unwrap();
            for alg in ["RSA-SHA1", "RSA-SHA256"] {
                let sig = value(req(
                    "signature",
                    "sign",
                    message,
                    &sk,
                    json!({"signatureAlgorithm":alg}),
                ));
                fs::write(&sig_path, b64(sig["signature"].as_str().unwrap()).unwrap()).unwrap();
                let script="const c=require('node:crypto'),f=require('node:fs');const [a,m,p,s]=process.argv.slice(1);if(!c.verify(a,f.readFileSync(m),f.readFileSync(p),f.readFileSync(s)))process.exit(1)";
                let out = Command::new("node")
                    .args(["-e", script, alg])
                    .arg(&msg)
                    .arg(&public_path)
                    .arg(&sig_path)
                    .output()
                    .unwrap();
                assert!(
                    out.status.success(),
                    "{}: {}",
                    alg,
                    String::from_utf8_lossy(&out.stderr)
                );
            }
        }
        // Verify the explicit SM2 ID against an independent OpenSSL process if available.
        if Command::new("openssl").arg("version").output().is_ok() {
            let (sk, pk) = keys("SM2");
            let sig = value(req(
                "signature",
                "sign",
                message,
                &sk,
                json!({"signatureAlgorithm":"SM2-SM3","sm2UserId":"1234567812345678"}),
            ));
            fs::write(&public_path, pk).unwrap();
            fs::write(&sig_path, b64(sig["signature"].as_str().unwrap()).unwrap()).unwrap();
            let out = Command::new("openssl")
                .args(["dgst", "-sm3", "-verify"])
                .arg(&public_path)
                .arg("-signature")
                .arg(&sig_path)
                .args(["-sigopt", "distid:1234567812345678"])
                .arg(&msg)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "SM2: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
    }
    #[test]
    fn default_directory_preference_survives_reload_and_changes() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config").join("key-settings.json");
        assert_eq!(load_key_directory(&config).unwrap(), None);
        let first = dir.path().join("keys-one");
        let second = dir.path().join("keys-two");
        store_key_directory(&config, first.clone()).unwrap();
        assert_eq!(load_key_directory(&config).unwrap(), Some(first));
        store_key_directory(&config, second.clone()).unwrap();
        assert_eq!(load_key_directory(&config).unwrap(), Some(second));
    }
}
