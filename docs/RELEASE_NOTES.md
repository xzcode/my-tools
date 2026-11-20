# My Tools 0.3.0

AES 加解密升级为**简单模式 + 高级模式**，原有 18 个工具均保留。

- 简单模式：与 0.2.0 完全相同的 AES-256-GCM + PBKDF2-HMAC-SHA256 自描述 JSON 格式。每次随机 Salt 和 IV，老版本密文可继续解密。
- 高级模式：128/192/256 位原始 AES Key、GCM/CBC、Key 和 IV 的 UTF-8/Hex/Base64 编码、明文 UTF-8/Hex/Base64、密文 Hex/Base64，GCM Tag 96–128 bit、附加/分离 Tag、可选 AAD，CBC PKCS7/NoPadding。
- CBC PKCS7 与 Java AES/CBC/PKCS5Padding 按相同 AES 块填充规则兼容；NoPadding 要求字节长度按 16 整数倍对齐，支持原始二进制数据。高级模式不会自动对 Key 派生、截断或补零。
- 高级模式新增“生成随机 IV”按钮。GCM 复用相同 Key+IV 会严重破坏安全性；对同一密钥每次加密都必须使用**全新 IV**，并自行保存与密文匹配的 IV。
- CBC 没有完整性认证，错误密钥或篡改后的解密结果不能视为可信。高级 GCM 支持附加 Tag（对应 Java Cipher.doFinal）或独立 Tag JSON（便于 Node.js/其他实现适配）。
- ECB 故意不提供。不进行远程加密、网络传输或内容持久化。

自动化验收与三平台安装包见 GitHub Actions；默认 Mac ad-hoc 签名、Windows 未商业签名、未执行 Apple Developer 公证。可选在线更新仍默认关闭。
