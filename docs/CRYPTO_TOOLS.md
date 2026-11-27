# 通用密码学工具 · M8 第一、二批

## 密钥生成与默认目录

打开「密码学工具 → 密钥生成」，输入密钥名称、选择算法、规格与编码，然后生成。在结果区域可以查看/复制公私钥，并保存到默认目录下的命名子目录。默认路径通过系统文件夹选择器修改，独立保存为应用配置；不会随 Tab 或历史清理而重置。已有同名目录不覆盖，请选择新名称。私钥在 Unix 系统按 0600 文件权限、0700 密钥目录保存；Windows 文件权限由用户账户及父目录继承。导出私钥可选 PKCS8 或 OpenSSH 口令保护，不强制设置口令。

本地密钥库列出当前默认目录中的受支持密钥文件，可导入对应工作台或打开目录。修改默认路径不移动旧密钥。Toolbox EX 创建、清单完整且无额外文件的密钥组可重命名或删除；已有同名目录不会覆盖。删除需输入准确的组名；不递归删除其他文件。默认目录改变后，必须刷新再执行密钥组管理。

## 已实现的算法

- 密钥：RSA（默认 2048 位，可输入位数）、P-256/P-384/P-521/secp256k1、SM2、Ed25519/Ed448、X25519/X448，以及 AES/SM4/ChaCha20/HMAC 随机密钥。
- 格式：私钥 PKCS8、RSA PKCS1、EC SEC1；公钥 SPKI、RSA PKCS1；PEM、DER（界面用 Base64 展示，文件保存为原始 DER）；解析 X.509 提取公钥；公私钥匹配和 SHA256 指纹。JWK 支持 RSA（双素数）、P-256/P-384/P-521/secp256k1、Ed25519/Ed448/X25519/X448；OpenSSH 支持 RSA 和 Ed25519，支持加密私钥导入导出。
- 签名：RSA PKCS1 v1.5 MD5/SHA1/SHA224/256/384/512/SHA3、RSA-PSS（独立 MGF1 和 salt 长度）、ECDSA SHA256/384/512、SM2-SM3（显式 ID，默认 1234567812345678）、Ed25519/Ed448。ECDSA/SM2 签名使用 ASN.1 DER。签名可输出 Base64/Hex。
- 报文：原始文本或文件字节、原始 key=value、URL 表单解码、JSON 参数拼接、指定 JSON 响应字段原始文本。排序、空值排除、排除字段及分隔符可配置；重复字段报错；原始响应字段不重新序列化。支持 UTF-8、GBK、GB18030、ASCII、UTF-16LE/BE 及 Hex/Base64 字节。URL 解码模式支持 UTF-8/GBK/GB18030/ASCII。显示实际参与签名的原文；验签仅证明签名匹配，不代表业务状态有效。
- 非对称加解密：RSA OAEP（摘要、MGF1、Label 分开设置）、PKCS1 v1.5、SM2 ASN.1、C1C3C2、C1C2C3 密文，原始 C1 为带 04 前缀的未压缩点。另提供独立 SM2 格式转换工具。RSA 必须遵守单块明文合法长度，不做自定义分块协议。
- 对称：保留原 AES 工具的 GCM/CBC/ECB 与旧密文兼容；高级原生工具新增 AES CTR/CFB128/OFB/GCM，SM4 ECB/CBC/CTR/CFB/OFB/GCM、DES/3DES ECB/CBC、ChaCha20、ChaCha20-Poly1305、XChaCha20-Poly1305（24 字节 nonce）。AEAD 认证标签附在密文末尾 16 字节。原生 ChaCha20 的 IV 采用 OpenSSL 的 16 字节 counter+nonce 格式。
- 摘要/HMAC：MD5、SHA1、SHA2、SHA3、SM3、RIPEMD160、BLAKE2（具体 HMAC 组合由 OpenSSL 支持情况决定）。另支持 BLAKE3、CRC32 摘要，不将其列为 HMAC 算法。派生：PBKDF2、HKDF、scrypt、Argon2id（可配置内存 KiB、时间成本、并行度）。
- 证书：X.509 解析、CSR、自签名证书；支持 SAN DNS/IP、可选 CA 扩展、有效期检查、本地证书链及可选域名/IP 验证。证书链使用用户显式提供的根证书，不读取系统默认信任库，不联网检查吊销。

- 密钥容器：PKCS12/PFX 与 JKS 生成、解析、提取，JKS 可按别名提取并配置独立条目口令；当前 JKS 限 ASCII 别名与口令。PKCS12/PFX 按单主私钥与证书链处理。

## 安全与兼容

RSA-SHA1 / RSA-MD5 / 旧 RSA PKCS1 加密、ECB、DES/3DES 等用于旧系统，不作为新系统推荐默认值。私钥输入、口令、密钥派生结果按工作台保存策略处理；默认完整保存内容，完整会话加密保存需显式选择。选择关闭密钥保存时，不持久化私钥相关输入与密钥生成/转换/派生结果。默认目录不包含密钥正文。

新功能依赖原生 OpenSSL；浏览器预览只展示真实界面，不假装执行密码学运算。无自动网络调用。

## 当前兼容范围与待验收

OpenSSH 当前支持 RSA、Ed25519；不宣称支持所有 SSH 密钥类型。JWK 不支持多素数 RSA；JKS 非 ASCII 别名/口令暂不支持，独立 Java 21 JCA 双向读写已通过（使用 Java KeyStore API，不是 keytool CLI）。证书验证不包含在线 OCSP/CRL、系统信任根自动加载。新原生工具运算在 Rust 后台执行，取消界面等待不等于中断正在运行的原生密码学操作。

浏览器预览仅用于界面验收；独立 Rust 核心测试与 SSH/OpenSSL/Node 互通结果不能替代三平台原生集成及安装包验收。

## Java 21 互通验收（M8.10）

新增 src-tauri/crypto-core/tests/java_interop.rs 与 tests/java/MyToolsInterop.java，只生成临时测试密钥与证书。Java 21 独立读取 Toolbox EX 生成的 JKS/PKCS12（含 JKS 独立条目口令），使用 SHA1withRSA/SHA256withRSA/SHA512withRSA 验签与反向签名，再写出 Java 容器供 Toolbox EX 读取、校验公私钥与证书匹配，覆盖可信证书条目和篡改验签失败。Java AES/ECB/PKCS5Padding 与 OpenSSL 对照一致；前端固定 Java 密文向量独立回归。JKS 非 ASCII 别名与口令仍未支持。CI 强制安装 Java 21 并执行互通测试。测试不读取真实业务密钥。
