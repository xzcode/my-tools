//! Interoperable formats and additional mature algorithm implementations.
use super::*;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use der::{
    asn1::{OctetStringRef, UintRef},
    Decode, Encode, Sequence,
};
use openssl::{
    bn::BigNumContext,
    ec::{EcPoint, PointConversionForm},
    pkcs12::Pkcs12,
    stack::Stack,
};
use ssh_key::{
    private::{Ed25519Keypair, KeypairData, RsaKeypair, RsaPrivateKey},
    public::{Ed25519PublicKey, KeyData, RsaPublicKey},
    LineEnding, Mpint,
};

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn url64(data: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(data)
}
fn jbytes(j: &Value, k: &str) -> Res<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(
            j.get(k)
                .and_then(Value::as_str)
                .ok_or_else(|| format!("JWK 缺少 {k}"))?,
        )
        .map_err(|_| format!("JWK {k} 不是有效 Base64URL"))
}
fn jbn(j: &Value, k: &str) -> Res<BigNum> {
    ssl(BigNum::from_slice(&jbytes(j, k)?))
}
fn bn64(b: &openssl::bn::BigNumRef) -> String {
    url64(&b.to_vec())
}
fn curve(nid: Nid) -> Res<(&'static str, usize)> {
    match nid {
        Nid::X9_62_PRIME256V1 => Ok(("P-256", 32)),
        Nid::SECP384R1 => Ok(("P-384", 48)),
        Nid::SECP521R1 => Ok(("P-521", 66)),
        Nid::SECP256K1 => Ok(("secp256k1", 32)),
        _ => Err("该曲线无受支持的 JWK 表示".into()),
    }
}
fn curve_id(name: &str) -> Res<Nid> {
    match name {
        "P-256" => Ok(Nid::X9_62_PRIME256V1),
        "P-384" => Ok(Nid::SECP384R1),
        "P-521" => Ok(Nid::SECP521R1),
        "secp256k1" => Ok(Nid::SECP256K1),
        _ => Err("不支持的 JWK EC 曲线".into()),
    }
}
fn okp(id: Id) -> Res<&'static str> {
    match id {
        Id::ED25519 => Ok("Ed25519"),
        Id::ED448 => Ok("Ed448"),
        Id::X25519 => Ok("X25519"),
        Id::X448 => Ok("X448"),
        _ => Err("不支持该 JWK 密钥类型".into()),
    }
}
fn okp_id(name: &str) -> Res<Id> {
    match name {
        "Ed25519" => Ok(Id::ED25519),
        "Ed448" => Ok(Id::ED448),
        "X25519" => Ok(Id::X25519),
        "X448" => Ok(Id::X448),
        _ => Err("不支持的 JWK OKP 曲线".into()),
    }
}
pub(super) fn jwk_public<T: HasPublic>(key: &PKeyRef<T>) -> Res<Value> {
    if key.id() == Id::RSA {
        let rsa = ssl(key.rsa())?;
        Ok(json!({"kty":"RSA","n":bn64(rsa.n()),"e":bn64(rsa.e())}))
    } else if key.id() == Id::EC && !is_sm2(key) {
        let ec = ssl(key.ec_key())?;
        let (name, n) = curve(ec.group().curve_name().ok_or("EC 密钥缺少命名曲线")?)?;
        let mut ctx = ssl(BigNumContext::new())?;
        let data =
            ssl(ec
                .public_key()
                .to_bytes(ec.group(), PointConversionForm::UNCOMPRESSED, &mut ctx))?;
        if data.len() != 1 + 2 * n || data[0] != 4 {
            return Err("EC 公钥格式无效".into());
        }
        Ok(json!({"kty":"EC","crv":name,"x":url64(&data[1..1+n]),"y":url64(&data[1+n..])}))
    } else {
        Ok(json!({"kty":"OKP","crv":okp(key.id())?,"x":url64(&ssl(key.raw_public_key())?)}))
    }
}
pub(super) fn jwk_private(key: &PKeyRef<Private>) -> Res<Value> {
    let mut j = jwk_public(key)?;
    if key.id() == Id::RSA {
        let rsa = ssl(key.rsa())?;
        j["d"] = json!(bn64(rsa.d()));
        for (k, v) in [
            ("p", rsa.p()),
            ("q", rsa.q()),
            ("dp", rsa.dmp1()),
            ("dq", rsa.dmq1()),
            ("qi", rsa.iqmp()),
        ] {
            j[k] = json!(bn64(v.ok_or("RSA 私钥缺少 CRT 参数")?));
        }
    } else if key.id() == Id::EC {
        let ec = ssl(key.ec_key())?;
        let (_, size) = curve(ec.group().curve_name().ok_or("EC 曲线无效")?)?;
        j["d"] = json!(url64(&ssl(ec.private_key().to_vec_padded(size as i32))?));
    } else {
        j["d"] = json!(url64(&ssl(key.raw_private_key())?));
    }
    Ok(j)
}
fn ec_point(j: &Value, group: &openssl::ec::EcGroupRef) -> Res<EcPoint> {
    let (_, n) = curve(group.curve_name().ok_or("EC 曲线无效")?)?;
    let x = jbytes(j, "x")?;
    let y = jbytes(j, "y")?;
    if x.len() != n || y.len() != n {
        return Err("JWK EC 坐标长度不正确".into());
    }
    let mut point = vec![4];
    point.extend(x);
    point.extend(y);
    let mut ctx = ssl(BigNumContext::new())?;
    ssl(EcPoint::from_bytes(group, &point, &mut ctx))
}
fn jwk_parse(text: &str) -> Res<Value> {
    // Reject duplicate fields before interpretation.
    let fields = raw_fields(text)?;
    let mut obj = serde_json::Map::new();
    for (k, v) in fields {
        obj.insert(k, serde_json::from_str(v.get()).map_err(err)?);
    }
    Ok(Value::Object(obj))
}
pub(super) fn parse_jwk_private(text: &str) -> Res<PKey<Private>> {
    let j = jwk_parse(text)?;
    let key = match j["kty"].as_str().unwrap_or("") {
        "RSA" => {
            if j.get("oth").is_some() {
                return Err("暂不支持多素数 RSA JWK".into());
            }
            let rsa = ssl(Rsa::from_private_components(
                jbn(&j, "n")?,
                jbn(&j, "e")?,
                jbn(&j, "d")?,
                jbn(&j, "p")?,
                jbn(&j, "q")?,
                jbn(&j, "dp")?,
                jbn(&j, "dq")?,
                jbn(&j, "qi")?,
            ))?;
            if !ssl(rsa.check_key())? {
                return Err("RSA JWK 私钥参数不匹配".into());
            }
            ssl(PKey::from_rsa(rsa))?
        }
        "EC" => {
            let group = ssl(EcGroup::from_curve_name(curve_id(
                j["crv"].as_str().unwrap_or(""),
            )?))?;
            let pt = ec_point(&j, &group)?;
            let d = jbn(&j, "d")?;
            let ec = ssl(EcKey::from_private_components(&group, &d, &pt))?;
            ssl(ec.check_key())?;
            ssl(PKey::from_ec_key(ec))?
        }
        "OKP" => {
            let key = ssl(PKey::private_key_from_raw_bytes(
                &jbytes(&j, "d")?,
                okp_id(j["crv"].as_str().unwrap_or(""))?,
            ))?;
            if ssl(key.raw_public_key())? != jbytes(&j, "x")? {
                return Err("JWK 公私钥不匹配".into());
            }
            key
        }
        _ => return Err("不支持的 JWK kty".into()),
    };
    Ok(key)
}
pub(super) fn parse_jwk_public(text: &str) -> Res<PKey<Public>> {
    let j = jwk_parse(text)?;
    match j["kty"].as_str().unwrap_or("") {
        "RSA" => {
            ssl(Rsa::from_public_components(jbn(&j, "n")?, jbn(&j, "e")?).and_then(PKey::from_rsa))
        }
        "EC" => {
            let group = ssl(EcGroup::from_curve_name(curve_id(
                j["crv"].as_str().unwrap_or(""),
            )?))?;
            let pt = ec_point(&j, &group)?;
            let ec = ssl(EcKey::from_public_key(&group, &pt))?;
            ssl(ec.check_key())?;
            ssl(PKey::from_ec_key(ec))
        }
        "OKP" => ssl(PKey::public_key_from_raw_bytes(
            &jbytes(&j, "x")?,
            okp_id(j["crv"].as_str().unwrap_or(""))?,
        )),
        _ => Err("不支持的 JWK kty".into()),
    }
}
fn mp(b: &openssl::bn::BigNumRef) -> Res<Mpint> {
    Mpint::from_positive_bytes(&b.to_vec()).map_err(err)
}
fn mpbn(b: &Mpint) -> Res<BigNum> {
    ssl(BigNum::from_slice(
        b.as_positive_bytes().ok_or("SSH mpint 必须为正数")?,
    ))
}
pub(super) fn ssh_public<T: HasPublic>(key: &PKeyRef<T>) -> Res<String> {
    let data = if key.id() == Id::RSA {
        let rsa = ssl(key.rsa())?;
        KeyData::Rsa(RsaPublicKey {
            n: mp(rsa.n())?,
            e: mp(rsa.e())?,
        })
    } else if key.id() == Id::ED25519 {
        KeyData::Ed25519(Ed25519PublicKey(
            ssl(key.raw_public_key())?
                .try_into()
                .map_err(|_| "Ed25519 长度无效")?,
        ))
    } else {
        return Err("OpenSSH 当前支持 RSA、Ed25519".into());
    };
    ssh_key::PublicKey::new(data, "").to_openssh().map_err(err)
}
pub(super) fn ssh_private(key: &PKeyRef<Private>, pass: &str) -> Res<String> {
    let data = if key.id() == Id::RSA {
        let rsa = ssl(key.rsa())?;
        KeypairData::Rsa(RsaKeypair {
            public: RsaPublicKey {
                n: mp(rsa.n())?,
                e: mp(rsa.e())?,
            },
            private: RsaPrivateKey {
                d: mp(rsa.d())?,
                p: mp(rsa.p().ok_or("RSA p 缺失")?)?,
                q: mp(rsa.q().ok_or("RSA q 缺失")?)?,
                iqmp: mp(rsa.iqmp().ok_or("RSA iqmp 缺失")?)?,
            },
        })
    } else if key.id() == Id::ED25519 {
        let mut bytes = [0u8; 64];
        let d = ssl(key.raw_private_key())?;
        let x = ssl(key.raw_public_key())?;
        if d.len() != 32 || x.len() != 32 {
            return Err("Ed25519 长度无效".into());
        }
        bytes[..32].copy_from_slice(&d);
        bytes[32..].copy_from_slice(&x);
        KeypairData::Ed25519(Ed25519Keypair::from_bytes(&bytes).map_err(err)?)
    } else {
        return Err("OpenSSH 当前支持 RSA、Ed25519".into());
    };
    let mut key = ssh_key::PrivateKey::new(data, "").map_err(err)?;
    if !pass.is_empty() {
        key = key
            .encrypt(&mut ssh_key::rand_core::OsRng, pass)
            .map_err(err)?;
    }
    Ok(key.to_openssh(LineEnding::LF).map_err(err)?.to_string())
}
pub(super) fn parse_ssh_public(text: &str) -> Res<PKey<Public>> {
    let k = ssh_key::PublicKey::from_openssh(text.trim()).map_err(err)?;
    match k.key_data() {
        KeyData::Rsa(r) => {
            ssl(Rsa::from_public_components(mpbn(&r.n)?, mpbn(&r.e)?).and_then(PKey::from_rsa))
        }
        KeyData::Ed25519(e) => ssl(PKey::public_key_from_raw_bytes(&e.0, Id::ED25519)),
        _ => Err("OpenSSH 当前支持 RSA、Ed25519".into()),
    }
}
pub(super) fn parse_ssh_private(text: &str, pass: &str) -> Res<PKey<Private>> {
    let mut k = ssh_key::PrivateKey::from_openssh(text.trim()).map_err(err)?;
    if k.is_encrypted() {
        k = k
            .decrypt(pass)
            .map_err(|_| "OpenSSH 私钥口令错误或格式不支持")?;
    }
    match k.key_data() {
        KeypairData::Rsa(r) => {
            let p = mpbn(&r.private.p)?;
            let q = mpbn(&r.private.q)?;
            let d = mpbn(&r.private.d)?;
            let mut p1 = ssl(p.to_owned())?;
            ssl(p1.sub_word(1))?;
            let mut q1 = ssl(q.to_owned())?;
            ssl(q1.sub_word(1))?;
            let mut ctx = ssl(BigNumContext::new())?;
            let mut dp = ssl(BigNum::new())?;
            let mut dq = ssl(BigNum::new())?;
            ssl(dp.nnmod(&d, &p1, &mut ctx))?;
            ssl(dq.nnmod(&d, &q1, &mut ctx))?;
            let rsa = ssl(Rsa::from_private_components(
                mpbn(&r.public.n)?,
                mpbn(&r.public.e)?,
                d,
                p,
                q,
                dp,
                dq,
                mpbn(&r.private.iqmp)?,
            ))?;
            if !ssl(rsa.check_key())? {
                return Err("OpenSSH RSA 私钥参数不匹配".into());
            }
            ssl(PKey::from_rsa(rsa))
        }
        KeypairData::Ed25519(e) => {
            let raw = e.to_bytes();
            let key = ssl(PKey::private_key_from_raw_bytes(&raw[..32], Id::ED25519))?;
            if ssl(key.raw_public_key())? != raw[32..] {
                return Err("OpenSSH Ed25519 公私钥不匹配".into());
            }
            Ok(key)
        }
        _ => Err("OpenSSH 当前支持 RSA、Ed25519".into()),
    }
}
#[derive(Sequence)]
struct Sm2Der<'a> {
    x: UintRef<'a>,
    y: UintRef<'a>,
    c3: OctetStringRef<'a>,
    c2: OctetStringRef<'a>,
}
pub(super) fn sm2_convert(data: &[u8], from: &str, to: &str) -> Res<Vec<u8>> {
    let (x, y, c3, c2) = match from {
        "ASN1" => {
            let d = Sm2Der::from_der(data).map_err(err)?;
            (
                d.x.as_bytes().to_vec(),
                d.y.as_bytes().to_vec(),
                d.c3.as_bytes().to_vec(),
                d.c2.as_bytes().to_vec(),
            )
        }
        "C1C3C2" | "C1C2C3" => {
            if data.len() < 97 || data[0] != 4 {
                return Err("SM2 原始密文应以 04 开头，包含 64 字节坐标、32 字节 C3".into());
            }
            let (h, m) = if from == "C1C3C2" {
                (&data[65..97], &data[97..])
            } else {
                (&data[data.len() - 32..], &data[65..data.len() - 32])
            };
            (
                data[1..33].to_vec(),
                data[33..65].to_vec(),
                h.to_vec(),
                m.to_vec(),
            )
        }
        _ => return Err("未知 SM2 密文格式".into()),
    };
    if x.len() > 32 || y.len() > 32 || c3.len() != 32 {
        return Err("SM2 坐标或摘要长度无效".into());
    }
    let mut point = vec![4];
    point.resize(33 - x.len(), 0);
    point.extend(&x);
    point.resize(65 - y.len(), 0);
    point.extend(&y);
    let group = ssl(EcGroup::from_curve_name(Nid::SM2))?;
    let mut ctx = ssl(BigNumContext::new())?;
    let p = ssl(EcPoint::from_bytes(&group, &point, &mut ctx))?;
    if p.is_infinity(&group) || !ssl(p.is_on_curve(&group, &mut ctx))? {
        return Err("SM2 C1 点不在曲线上".into());
    }
    match to {
        "ASN1" => Sm2Der {
            x: UintRef::new(&x).map_err(err)?,
            y: UintRef::new(&y).map_err(err)?,
            c3: OctetStringRef::new(&c3).map_err(err)?,
            c2: OctetStringRef::new(&c2).map_err(err)?,
        }
        .to_der()
        .map_err(err),
        "C1C3C2" => {
            point.extend(c3);
            point.extend(c2);
            Ok(point)
        }
        "C1C2C3" => {
            point.extend(c2);
            point.extend(c3);
            Ok(point)
        }
        _ => Err("未知 SM2 密文格式".into()),
    }
}
pub(super) fn extended_symmetric(r: &Request) -> Res<ResultData> {
    let alg = r.opt("algorithm", "");
    let key = bytes(r.opt("rawKey", ""), r.opt("keyEncoding", "hex"))?;
    let iv = bytes(r.opt("iv", ""), r.opt("ivEncoding", "hex"))?;
    let encrypt = match r.action.as_str() {
        "encrypt" => true,
        "decrypt" => false,
        _ => return Err("无效操作".into()),
    };
    let plain = r.opt("dataEncoding", "utf8");
    let encoded = r.opt("outputEncoding", "base64");
    let data = bytes(&r.input, if encrypt { plain } else { encoded })?;
    let mut warnings = Vec::new();
    let out = match alg {
        "SM4-GCM" | "XChaCha20-Poly1305" => {
            let aad = bytes(r.opt("aad", ""), r.opt("aadEncoding", "utf8"))?;
            let payload = Payload {
                msg: &data,
                aad: &aad,
            };
            warnings.push("同一 Key 下不可复用 Nonce；16 字节认证标签附在密文末尾。".into());
            if alg == "SM4-GCM" {
                type Sm4Gcm = aes_gcm::AesGcm<sm4::Sm4, aes_gcm::aead::consts::U12>;
                if key.len() != 16 || iv.len() != 12 {
                    return Err("SM4-GCM 需要 16 字节 Key、12 字节 Nonce".into());
                }
                let c = Sm4Gcm::new_from_slice(&key).map_err(err)?;
                let nonce = aes_gcm::Nonce::from_slice(&iv);
                if encrypt {
                    c.encrypt(nonce, payload)
                } else {
                    c.decrypt(nonce, payload)
                }
                .map_err(|_| "SM4-GCM 运算或认证失败")?
            } else {
                if key.len() != 32 || iv.len() != 24 {
                    return Err("XChaCha20-Poly1305 需要 32 字节 Key、24 字节 Nonce".into());
                }
                let c = chacha20poly1305::XChaCha20Poly1305::new_from_slice(&key).map_err(err)?;
                let nonce = chacha20poly1305::XNonce::from_slice(&iv);
                if encrypt {
                    c.encrypt(nonce, payload)
                } else {
                    c.decrypt(nonce, payload)
                }
                .map_err(|_| "XChaCha20-Poly1305 运算或认证失败")?
            }
        }
        "DES-ECB" | "DES-CBC" => {
            use des::cipher::{
                block_padding::{NoPadding, Pkcs7},
                generic_array::GenericArray,
                BlockDecrypt, BlockDecryptMut, BlockEncrypt, BlockEncryptMut, KeyIvInit,
            };
            if key.len() != 8 {
                return Err("DES 密钥必须为 8 字节（含奇偶校验位）".into());
            }
            let cbc_mode = alg == "DES-CBC";
            if iv.len() != if cbc_mode { 8 } else { 0 } {
                return Err("DES-CBC 需要 8 字节 IV；ECB 无 IV".into());
            }
            let padding = r.opt("padding", "pkcs7");
            if !matches!(padding, "pkcs7" | "none") {
                return Err("不支持的 Padding".into());
            }
            warnings.push("DES 仅用于旧系统兼容；密钥有效长度仅 56 位，不提供认证。".into());
            if cbc_mode {
                let mut buf = data.clone();
                if encrypt {
                    let size = buf.len();
                    buf.resize(size.checked_add(8).ok_or("输出长度溢出")?, 0);
                    let c = cbc::Encryptor::<des::Des>::new_from_slices(&key, &iv).map_err(err)?;
                    let result = if padding == "pkcs7" {
                        c.encrypt_padded_mut::<Pkcs7>(&mut buf, size)
                    } else {
                        c.encrypt_padded_mut::<NoPadding>(&mut buf, size)
                    }
                    .map_err(|_| "DES 明文长度不符合填充规则")?;
                    result.to_vec()
                } else {
                    let c = cbc::Decryptor::<des::Des>::new_from_slices(&key, &iv).map_err(err)?;
                    let result = if padding == "pkcs7" {
                        c.decrypt_padded_mut::<Pkcs7>(&mut buf)
                    } else {
                        c.decrypt_padded_mut::<NoPadding>(&mut buf)
                    }
                    .map_err(|_| "DES 密文长度或填充无效")?;
                    result.to_vec()
                }
            } else {
                let c = des::Des::new_from_slice(&key).map_err(err)?;
                let mut buf = data.clone();
                if encrypt && padding == "pkcs7" {
                    let pad = 8 - buf.len() % 8;
                    buf.resize(buf.len().checked_add(pad).ok_or("输出长度溢出")?, pad as u8);
                }
                if buf.len() % 8 != 0 || (!encrypt && padding == "pkcs7" && buf.is_empty()) {
                    return Err("DES 密文/无填充明文必须为 8 字节整数倍".into());
                }
                for block in buf.chunks_exact_mut(8) {
                    let block = GenericArray::from_mut_slice(block);
                    if encrypt {
                        c.encrypt_block(block)
                    } else {
                        c.decrypt_block(block)
                    }
                }
                if !encrypt && padding == "pkcs7" {
                    use des::cipher::block_padding::Padding;
                    let end =
                        Pkcs7::unpad(GenericArray::<u8, des::cipher::consts::U8>::from_slice(
                            &buf[buf.len() - 8..],
                        ))
                        .map_err(|_| "DES 填充无效")?
                        .len();
                    buf.truncate(buf.len() - 8 + end);
                }
                buf
            }
        }
        _ => return Err("不支持的扩展对称算法".into()),
    };
    Ok(text_output(
        render(&out, if encrypt { encoded } else { plain })?,
        "对称加解密完成",
        warnings,
    ))
}
pub(super) fn extra_hash(r: &Request) -> Res<ResultData> {
    let alg = r.opt("algorithm", "");
    if r.action != "hash" {
        return Err("BLAKE3 与 CRC32 使用摘要操作；不提供名为 HMAC 的非标准组合".into());
    }
    let data = bytes(&r.input, r.opt("dataEncoding", "utf8"))?;
    let out = if alg == "BLAKE3" {
        blake3::hash(&data).as_bytes().to_vec()
    } else {
        crc32fast::hash(&data).to_be_bytes().to_vec()
    };
    Ok(text_output(
        render(&out, r.opt("outputEncoding", "hex"))?,
        "摘要计算完成",
        if alg == "CRC32" {
            vec!["CRC32 是差错校验，不是密码学摘要。".into()]
        } else {
            vec![]
        },
    ))
}
pub(super) fn argon(r: &Request, pass: &[u8], salt: &[u8], out: &mut [u8]) -> Res<()> {
    use argon2::{Algorithm, Argon2, Params, Version};
    let u32opt = |k: &str, d: u64| -> Res<u32> {
        u32::try_from(r.num(k, d)?).map_err(|_| format!("{k} 超出算法参数范围"))
    };
    let params = Params::new(
        u32opt("memoryKiB", 65536)?,
        u32opt("timeCost", 3)?,
        u32opt("parallelism", 1)?,
        Some(out.len()),
    )
    .map_err(err)?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(pass, salt, out)
        .map_err(err)
}
pub(super) fn certs(text: &str, encoding: &str) -> Res<Vec<X509>> {
    let data = key_bytes(text, encoding)?;
    if data.starts_with(b"-----BEGIN ") {
        let c = ssl(X509::stack_from_pem(&data))?;
        if c.is_empty() {
            return Err("未找到证书".into());
        }
        Ok(c)
    } else {
        Ok(vec![ssl(X509::from_der(&data))?])
    }
}
pub(super) fn keystore(r: &Request) -> Res<ResultData> {
    let format = r.opt("storeFormat", "PKCS12");
    let password = r.opt("storePassphrase", "");
    let alias = r.opt("alias", "my-key");
    let entry_password = r.opt("entryPassphrase", "");
    let entry_password = if entry_password.is_empty() {
        password
    } else {
        entry_password
    };
    if password.contains('\0') || alias.contains('\0') {
        return Err("口令/别名不可包含 NUL".into());
    }
    if r.action == "pack" {
        let key = private(
            &r.secondary_input,
            r.opt("keyEncoding", "auto"),
            r.opt("keyPassphrase", ""),
        )?;
        let certs = certs(&r.input, r.opt("keyEncoding", "auto"))?;
        let cert = &certs[0];
        let public = ssl(cert.public_key())?;
        if !key.public_eq(&public) {
            return Err("首张证书与私钥不匹配".into());
        }
        let (name, data) = if format == "PKCS12" {
            let mut builder = Pkcs12::builder();
            builder.name(alias).pkey(&key).cert(cert);
            if certs.len() > 1 {
                let mut chain = ssl(Stack::new())?;
                for c in &certs[1..] {
                    ssl(chain.push(c.clone()))?;
                }
                builder.ca(chain);
            }
            (
                "keystore.p12",
                ssl(builder.build2(password).and_then(|p| p.to_der()))?,
            )
        } else if format == "JKS" {
            if !password.is_ascii() || !entry_password.is_ascii() || !alias.is_ascii() {
                return Err("JKS 当前支持 ASCII 口令与别名".into());
            }
            let mut store = jks::KeyStore::with_options(jks::KeyStoreOptions {
                min_password_len: 0,
                ..Default::default()
            });
            let chain = certs
                .iter()
                .map(|c| {
                    Ok(jks::Certificate {
                        cert_type: "X509".into(),
                        content: ssl(c.to_der())?,
                    })
                })
                .collect::<Res<Vec<_>>>()?;
            let entry = jks::PrivateKeyEntry {
                creation_time: std::time::SystemTime::now(),
                private_key: ssl(key.private_key_to_pkcs8())?,
                certificate_chain: chain,
            };
            store
                .set_private_key_entry(alias, entry, entry_password.as_bytes())
                .map_err(err)?;
            let mut data = Vec::new();
            store.store(&mut data, password.as_bytes()).map_err(err)?;
            ("keystore.jks", data)
        } else {
            return Err("未知 KeyStore 格式".into());
        };
        return json_output(
            json!({"files":[file(name,data,false)?],"format":format}),
            "密钥容器已生成",
            vec![],
        );
    }
    if !matches!(r.action.as_str(), "inspect" | "extract") {
        return Err("无效的 KeyStore 操作".into());
    }
    let data = key_bytes(&r.input, r.opt("storeEncoding", "base64"))?;
    let (key, chain, aliases) = if format == "PKCS12" {
        let p = ssl(Pkcs12::from_der(&data).and_then(|x| x.parse2(password)))?;
        let mut chain = p.cert.into_iter().collect::<Vec<_>>();
        if let Some(ca) = p.ca {
            chain.extend(ca);
        }
        (p.pkey, chain, vec![])
    } else if format == "JKS" {
        if !password.is_ascii() || !entry_password.is_ascii() || !alias.is_ascii() {
            return Err("JKS 当前支持 ASCII 口令与别名".into());
        }
        preflight_jks(&data)?;
        let mut store = jks::KeyStore::with_options(jks::KeyStoreOptions {
            min_password_len: 0,
            ..Default::default()
        });
        store
            .load(data.as_slice(), password.as_bytes())
            .map_err(err)?;
        let aliases = store.aliases();
        if r.action == "inspect" {
            let entries=aliases.iter().map(|a|json!({"alias":a,"privateKey":store.is_private_key_entry(a),"trustedCertificate":store.is_trusted_certificate_entry(a)})).collect::<Vec<_>>();
            return json_output(
                json!({"format":format,"entries":entries}),
                "JKS 容器解析完成",
                vec![],
            );
        }
        if store.is_private_key_entry(alias) {
            let entry = store
                .get_private_key_entry(alias, entry_password.as_bytes())
                .map_err(err)?;
            let key = ssl(PKey::private_key_from_der(&entry.private_key))?;
            let chain = entry
                .certificate_chain
                .iter()
                .map(|c| ssl(X509::from_der(&c.content)))
                .collect::<Res<Vec<_>>>()?;
            (Some(key), chain, aliases)
        } else {
            let entry = store.get_trusted_certificate_entry(alias).map_err(err)?;
            (
                None,
                vec![ssl(X509::from_der(&entry.certificate.content))?],
                aliases,
            )
        }
    } else {
        return Err("未知 KeyStore 格式".into());
    };
    if r.action == "inspect" {
        return json_output(
            json!({"format":format,"hasPrivateKey":key.is_some(),"certificateCount":chain.len(),"aliases":aliases}),
            "容器解析完成",
            vec![],
        );
    }
    let mut files = Vec::new();
    if let Some(key) = key {
        files.push(export_private(
            &key,
            "PKCS8",
            true,
            r.opt("exportPassphrase", ""),
        )?);
        files.push(export_public(&key, "SPKI", true)?);
    }
    if !chain.is_empty() {
        let mut pem = Vec::new();
        for cert in chain {
            pem.extend(ssl(cert.to_pem())?);
        }
        files.push(file("certificate.pem", pem, true)?);
    }
    json_output(
        json!({"format":format,"files":files}),
        "密钥容器提取完成",
        vec![],
    )
}
// The JKS decoder allocates using on-disk lengths. Validate structural lengths
// against actual file bytes first, not a product capacity quota.
fn preflight_jks(data: &[u8]) -> Res<()> {
    fn take<'a>(data: &mut &'a [u8], n: usize) -> Res<&'a [u8]> {
        if data.len() < n {
            return Err("JKS 数据截断或长度字段无效".into());
        }
        let (a, b) = data.split_at(n);
        *data = b;
        Ok(a)
    }
    fn u32v(data: &mut &[u8]) -> Res<u32> {
        Ok(u32::from_be_bytes(take(data, 4)?.try_into().unwrap()))
    }
    fn string(data: &mut &[u8]) -> Res<()> {
        let n = u16::from_be_bytes(take(data, 2)?.try_into().unwrap()) as usize;
        let s = take(data, n)?;
        if !s.is_ascii() || s.contains(&0) {
            return Err("JKS 当前支持 ASCII 别名和证书类型".into());
        }
        Ok(())
    }
    fn block(data: &mut &[u8]) -> Res<()> {
        let n = u32v(data)? as usize;
        take(data, n)?;
        Ok(())
    }
    fn cert(data: &mut &[u8], v: u32) -> Res<()> {
        if v == 2 {
            string(data)?;
        }
        block(data)
    }
    let mut d = data;
    if u32v(&mut d)? != 0xfeedfeed {
        return Err("不是 JKS 文件".into());
    }
    let version = u32v(&mut d)?;
    if !matches!(version, 1 | 2) {
        return Err("未知 JKS 版本".into());
    }
    let count = u32v(&mut d)?;
    for _ in 0..count {
        let tag = u32v(&mut d)?;
        string(&mut d)?;
        take(&mut d, 8)?;
        match tag {
            1 => {
                block(&mut d)?;
                let n = u32v(&mut d)?;
                if n as usize > d.len() / 4 {
                    return Err("JKS 证书计数无效".into());
                }
                for _ in 0..n {
                    cert(&mut d, version)?;
                }
            }
            2 => cert(&mut d, version)?,
            _ => return Err("无效 JKS 条目".into()),
        }
    }
    if d.len() != 20 {
        return Err("JKS 校验摘要长度无效".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    fn req(tool: &str, action: &str, input: &str, secondary: &str, options: Value) -> Request {
        Request {
            tool_id: tool.into(),
            action: action.into(),
            input: input.into(),
            secondary_input: secondary.into(),
            options: serde_json::from_value::<BTreeMap<String, Value>>(options).unwrap(),
        }
    }
    fn value(r: Request) -> Value {
        serde_json::from_str(&execute(&r).unwrap().output).unwrap()
    }
    fn keys(alg: &str) -> (String, String) {
        let v = value(req("keygen", "generate", "", "", json!({"algorithm":alg})));
        (
            v["files"][0]["data"].as_str().unwrap().into(),
            v["files"][1]["data"].as_str().unwrap().into(),
        )
    }
    #[test]
    fn jwk_roundtrips_all_supported_key_types() {
        for alg in [
            "RSA",
            "P-256",
            "P-384",
            "P-521",
            "secp256k1",
            "Ed25519",
            "Ed448",
            "X25519",
            "X448",
        ] {
            let (sk, pk) = keys(alg);
            let key = private(&sk, "auto", "").unwrap();
            let j = jwk_private(&key).unwrap();
            let pubj = jwk_public(&key).unwrap();
            let a = parse_jwk_private(&j.to_string()).unwrap();
            let b = parse_jwk_public(&pubj.to_string()).unwrap();
            assert!(a.public_eq(&b), "{alg}");
            assert!(a.public_eq(&public(&pk, "auto").unwrap()));
            assert!(pubj.get("d").is_none());
        }
    }
    #[test]
    fn openssh_keys_roundtrip_and_independent_ssh_keygen() {
        for alg in ["RSA", "Ed25519"] {
            let (sk, _) = keys(alg);
            let key = private(&sk, "auto", "").unwrap();
            let public = ssh_public(&key).unwrap();
            let secret = ssh_private(&key, "").unwrap();
            let parsed = parse_ssh_private(&secret, "").unwrap();
            assert!(parsed.public_eq(&parse_ssh_public(&public).unwrap()));
            let encrypted = ssh_private(&key, "fixture-passphrase").unwrap();
            assert!(parse_ssh_private(&encrypted, "wrong").is_err());
            assert!(parse_ssh_private(&encrypted, "fixture-passphrase")
                .unwrap()
                .public_eq(&key));
            if std::process::Command::new("ssh-keygen")
                .arg("-?")
                .output()
                .is_ok()
            {
                let temp = tempfile::tempdir().unwrap();
                let path = temp.path().join("id_test");
                let mut opts = fs::OpenOptions::new();
                opts.create_new(true).write(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    opts.mode(0o600);
                }
                opts.open(&path)
                    .unwrap()
                    .write_all(secret.as_bytes())
                    .unwrap();
                let out = std::process::Command::new("ssh-keygen")
                    .args(["-y", "-f"])
                    .arg(path)
                    .output()
                    .unwrap();
                assert!(
                    out.status.success(),
                    "{}",
                    String::from_utf8_lossy(&out.stderr)
                );
                assert!(key.public_eq(
                    &parse_ssh_public(&String::from_utf8(out.stdout).unwrap()).unwrap()
                ));
            }
        }
    }
    #[test]
    fn sm2_cipher_formats_convert_and_decrypt() {
        let (sk, pk) = keys("SM2");
        let message = "国密互通";
        for alg in ["SM2-ASN1", "SM2-C1C3C2", "SM2-C1C2C3"] {
            let opts = json!({"algorithm":alg});
            let ct = execute(&req("asymmetric", "encrypt", message, &pk, opts.clone()))
                .unwrap()
                .output;
            assert_eq!(
                execute(&req("asymmetric", "decrypt", &ct, &sk, opts))
                    .unwrap()
                    .output,
                message
            );
            let raw = b64(&ct).unwrap();
            let fmt = alg.strip_prefix("SM2-").unwrap();
            let der = sm2_convert(&raw, fmt, "ASN1").unwrap();
            assert_eq!(sm2_convert(&der, "ASN1", fmt).unwrap(), raw);
        }
        assert!(sm2_convert(&[4; 97], "C1C3C2", "ASN1").is_err());
    }
    #[test]
    fn additional_symmetric_algorithms_and_vectors() {
        for (alg, key, iv) in [
            ("SM4-GCM", "01".repeat(16), "02".repeat(12)),
            ("XChaCha20-Poly1305", "03".repeat(32), "04".repeat(24)),
            (
                "DES-CBC",
                "133457799bbcdff1".into(),
                "0102030405060708".into(),
            ),
            ("DES-ECB", "133457799bbcdff1".into(), "".into()),
        ] {
            let opts = json!({"algorithm":alg,"rawKey":key,"iv":iv,"aad":"associated data"});
            let text = "hello 你好";
            let cipher = execute(&req("symmetric", "encrypt", text, "", opts.clone()))
                .unwrap()
                .output;
            assert_eq!(
                execute(&req("symmetric", "decrypt", &cipher, "", opts.clone()))
                    .unwrap()
                    .output,
                text
            );
            if alg.ends_with("GCM") || alg == "XChaCha20-Poly1305" {
                let mut ct = b64(&cipher).unwrap();
                ct[0] ^= 1;
                assert!(
                    execute(&req("symmetric", "decrypt", &STANDARD.encode(ct), "", opts)).is_err()
                );
            }
        }
        let opts = json!({"algorithm":"DES-ECB","rawKey":"133457799bbcdff1","padding":"none","dataEncoding":"hex","outputEncoding":"hex"});
        assert_eq!(
            execute(&req("symmetric", "encrypt", "0123456789abcdef", "", opts))
                .unwrap()
                .output,
            "85e813540f0ab405"
        );
        let blake = execute(&req(
            "crypto-hash",
            "hash",
            "abc",
            "",
            json!({"algorithm":"BLAKE3"}),
        ))
        .unwrap()
        .output;
        assert_eq!(
            blake,
            "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85"
        );
        assert_eq!(
            execute(&req(
                "crypto-hash",
                "hash",
                "123456789",
                "",
                json!({"algorithm":"CRC32"})
            ))
            .unwrap()
            .output,
            "cbf43926"
        );
        // Independent RFC 9106-compatible Argon2id implementation is used;
        // compare the raw output for the same parameters against its public API.
        let opts = json!({"algorithm":"Argon2id","salt":"somesalt","saltEncoding":"utf8","memoryKiB":32,"timeCost":2,"parallelism":1,"derivedBytes":32});
        let result = execute(&req("kdf", "derive", "password", "", opts))
            .unwrap()
            .output;
        assert_eq!(result.len(), 64);
        assert_eq!(
            result,
            "31111cc053ba0a799c0884148fd7ec9dc3631f3e8cf476cca9521d4ccc5136e8"
        );
    }
    #[test]
    fn pkcs12_jks_container_roundtrip() {
        let (sk, pk) = keys("RSA");
        let cert = value(req(
            "certificate",
            "self-sign",
            "",
            &sk,
            json!({"commonName":"test.local"}),
        ));
        let cert = cert["files"][0]["data"].as_str().unwrap();
        for format in ["PKCS12", "JKS"] {
            let opts = json!({"storeFormat":format,"storePassphrase":"store-password","entryPassphrase":"entry-password","alias":"my-key"});
            let packed = value(req("keystore", "pack", cert, &sk, opts.clone()));
            let data = packed["files"][0]["data"].as_str().unwrap();
            let inspected = value(req("keystore", "inspect", data, "", opts.clone()));
            assert_eq!(inspected["format"], format);
            let unpacked = value(req("keystore", "extract", data, "", opts.clone()));
            let recovered = unpacked["files"][0]["data"].as_str().unwrap();
            assert!(private(recovered, "auto", "")
                .unwrap()
                .public_eq(&public(&pk, "auto").unwrap()));
            let mut bad = opts;
            bad["storePassphrase"] = json!("incorrect");
            assert!(execute(&req("keystore", "extract", data, "", bad)).is_err());
        }
    }
    #[test]
    fn certificate_chain_and_san_validation() {
        let (sk, _) = keys("RSA");
        let opts =
            json!({"commonName":"localhost","sanDns":"localhost,example.test","sanIp":"127.0.0.1"});
        let value_cert = value(req("certificate", "self-sign", "", &sk, opts.clone()));
        let cert = value_cert["files"][0]["data"].as_str().unwrap();
        let parsed = value(req("certificate", "inspect", cert, "", json!({})));
        assert_eq!(parsed["subjectAltNames"].as_array().unwrap().len(), 3);
        assert_eq!(parsed["validity"], "有效期内");
        for (host, expected) in [
            ("example.test", true),
            ("127.0.0.1", true),
            ("other.test", false),
        ] {
            let out = value(req(
                "certificate",
                "verify-chain",
                cert,
                "",
                json!({"trustRoots":cert,"verifyHost":host}),
            ));
            assert_eq!(out["valid"], expected, "{host}: {out}");
        }
        let csr = value(req("certificate", "csr", "", &sk, opts));
        let csr = X509Req::from_pem(csr["files"][0]["data"].as_str().unwrap().as_bytes()).unwrap();
        assert_eq!(csr.extensions().unwrap().len(), 1);
    }
}
