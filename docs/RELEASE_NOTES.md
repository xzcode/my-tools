# My Tools 0.2.0

增加两项离线安全工具，工具总数从 16 项提升到 **18 项**：

- **AES 加解密**：AES-256-GCM 认证加密；600,000 次 PBKDF2-HMAC-SHA256 口令派生；每次生成 16 字节随机盐和 12 字节随机 IV；输出独立的、版本化 JSON 密文。使用相同口令即可解密，不会把口令写到持久化配置。错误口令或密文篡改会被认证检测并拒绝输出。
- **强密码生成器**：使用 Web Crypto 安全随机数和拒绝采样，支持 12–128 字符、最多 50 条，选择大/小写字母、数字、特殊符号与易混淆字符过滤；每条密码至少包含一种选中的各类字符。

AES 自定义密文格式只供本工具自身的加解密及明确实现相同格式的程序使用，并不等于 OpenSSL、CryptoJS、AES-CBC 或 ECB 输出格式。密码或处理数据仅保留在当前应用会话内存中。

其他 16 项工具、快捷窗口、托盘、收藏、主题、文件处理、离线使用不变。

此版本默认 macOS ad-hoc 签名、Windows 未配置商业签名；未进行 Apple Developer 公证。可选自动更新仅在配置 HTTPS 更新源和签名密钥后启用。

安装包、SHA-256 校验文件与界面截图存于本次私有草稿 Release。构建结果以 [GitHub Actions](https://github.com/xzcode/my-tools/actions/workflows/desktop.yml) 为准。

使用与安全边界见 [使用指南](https://github.com/xzcode/my-tools/blob/master/docs/USAGE.md) 和 [交接记录](https://github.com/xzcode/my-tools/blob/master/docs/HANDOFF.md)。
