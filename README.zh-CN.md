# Toolbox EX

[English](README.md) · **简体中文**

面向开发者的开源离线桌面工具箱。基于 **Tauri 2 + Vue 3 + TypeScript + Rust**，将 31 项常用工具整合在同一个本地工作台。

无须账号，无须远程转换服务，数据保留在自己的设备上。

[安装包](https://github.com/xzcode/toolbox-ex/releases) · [构建状态](https://github.com/xzcode/toolbox-ex/actions/workflows/desktop.yml) · [使用指南](docs/USAGE.md)

## 工具功能

| 工具 | 能力 |
| --- | --- |
| JSON 工作台 | 格式化、压缩、校验、键排序、转义/反转义、路径提取、树视图；保留长整数精度 |
| 字符串拼接 | 多行拼接、分隔符、前后缀、引号、空行处理、去重 |
| 文本处理 | 去重、排序、替换、空白整理、大小写转换、HTML 转义 |
| Base64 | UTF-8 中文与 Emoji、URL-safe、填充、十六进制字节模式、二进制文件转换 |
| AES 加解密 | AES-128/192/256 GCM、CBC、ECB；口令式 AES-256-GCM/PBKDF2；Java AES/ECB/PKCS5Padding 兼容、Key/IV、Padding、Tag/AAD、字面量密文前缀 |
| URL | 组件与完整 URI 编解码、参数解析与构建 |
| 时间戳 | 秒/毫秒与日期互转、当前时间、时区显示 |
| UUID 与随机文本 | UUID v4、批量生成、安全随机源 |
| 强密码生成器 | 安全随机密码、字符类别与易混淆字符过滤 |
| 哈希/HMAC | SHA-256、SHA-512、HMAC、Hex/Base64 输出 |
| JWT | 解析 Header/Payload 与时间声明；不验证签名 |
| SQL | 方言格式化、IN 条件生成、字符串转义 |
| 正则 | 匹配、捕获组、替换、独立 Worker，可手动停止 |
| Diff | 文本对比与 JSON 结构对比 |
| 数据转换 | JSON、YAML、CSV 互转 |
| cURL | 本地解析请求、Header、参数、Body，不执行命令、不发送请求 |
| 密钥生成 / 匹配 / 转换 | RSA、ECC、SM2、Ed25519/448、X25519/448、随机密钥；PEM、DER、JWK、OpenSSH；命名目录及可持久化默认路径 |
| 数字签名与验签 | RSA-SHA1/SHA2/SHA3/PSS、ECDSA、SM2-SM3、EdDSA；原始数据、参数与 JSON 响应 |
| 高级密码学 | RSA OAEP/PKCS1、SM2、SM4-GCM、DES、XChaCha20-Poly1305、BLAKE3、CRC32、PBKDF2、HKDF、scrypt、Argon2id |
| 证书工具 | X.509 解析、CSR、自签名证书、SAN、显式本地信任根与域名验证 |
| 密钥容器 | PKCS12/PFX、JKS 生成、解析、提取 |
| SM2 密文格式 | ASN.1、C1C3C2、C1C2C3 互转 |
| 国际手机号校验 | 国旗与区号搜索、号码规划校验、号码类型与 E.164 |
| SVGA 动画预览 | 本地 1.x ZIP 和 2.x Zlib 动画播放、逐帧、进度、循环 |

### 工作台

- 所有工具支持独立多标签、复制、重命名、关闭及恢复。
- 自动完整保存参数、密钥、前缀、输入输出、文件、模板和历史记录。
- 右侧可收起历史栏，支持搜索、筛选、恢复到新标签及按日期手动清理。
- 支持跟随系统、浅色、柔和白色、深色、纯黑、灰色六种主题，重启后保留选择。
- 收藏、最近使用、快捷启动、主动读写剪贴板、文件导入导出及批量处理。

普通工作台、历史和文件不设固定数量或容量配额，实际能力取决于内存、磁盘和运行环境。保留格式校验及异常解压防护。

### 兼容性与限制

原生密码学工具在桌面安装版中使用随应用构建的 OpenSSL 与 Rust 库，浏览器预览仅用于界面调试。

AES 简单模式兼容原有认证加密 JSON 格式；高级模式在参数一致时可与 Java、Node.js、Python 互通。密文前缀在编码后拼接，解密前精确匹配。ECB、CBC、RSA-SHA1 等旧算法用于兼容旧系统；新设计优先使用认证加密，GCM 同一 Key 下不可复用 IV。

OpenSSH 当前支持 RSA/Ed25519；JKS 当前支持 ASCII 别名与口令。证书验证使用显式本地信任根，不联网检查吊销。手机号校验仅依据号码规划，不查询开通状态。SVGA 不支持音频。

详情见 [密码学工具指南](docs/CRYPTO_TOOLS.md)。

## 下载与安装

| 平台 | 安装包 |
| --- | --- |
| macOS Apple Silicon | ARM64 `.dmg` |
| Windows x64 | NSIS `.exe` |
| Linux x64 | Ubuntu 24.04 构建的 `.deb` |

打开 [Releases](https://github.com/xzcode/toolbox-ex/releases)，核对对应 [Desktop builds](https://github.com/xzcode/toolbox-ex/actions/workflows/desktop.yml) 运行结果，下载安装包及对应平台 SHA-256 校验文件。

构建产物上传到草稿 Release；只有具备发布管理权限的账号可以查看草稿，维护者正式发布后普通访客才可下载。工作流不会自动公开草稿。

macOS 默认 ad-hoc 签名，未进行 Apple 公证；Windows 默认未进行商业代码签名。其他 Linux 发行版需核对系统依赖。详见 [构建与发布](docs/RELEASING.md)。

## 本地开发

需要 Node.js 22.14+、Rust stable 和 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)。Windows 构建还需原生 Perl 编译随应用构建的 OpenSSL。

```bash
git clone https://github.com/xzcode/toolbox-ex.git
cd toolbox-ex
npm ci
npm run desktop:dev
```

仅调试界面时，执行 `npm run dev`。

```bash
npm run check
npx playwright install chromium
npm run test:e2e
cargo test --manifest-path src-tauri/crypto-core/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run desktop:build
```

独立密码学互通测试使用 Java 21。浏览器测试不能代替原生安装、托盘与快捷键验收。

## 项目结构

```text
src/core/          工具目录及纯 TypeScript 转换逻辑
src/components/    编辑器、工具界面及工作台面板
src/composables/   工作台状态与任务调度
src/workers/       后台转换任务
src/platform/      桌面 IPC 与浏览器适配
src-tauri/         Rust 桌面应用与原生密码学
tests/             核心测试与浏览器验收
scripts/           构建、发布与校验工具
docs/              使用、架构及研发文档
```

## 本地数据与隐私

工作台全部内容自动保存到本机。新桌面存档使用自动生成的本地密钥进行认证加密；旧版系统凭据保护的加密存档保留原有保护。本地加密不能抵抗已控制设备的程序，重要数据和历史由用户自行管理、删除。

Toolbox EX 原名 My Tools。为保持兼容性，保留原应用标识、偏好与工作台存档格式及 AES 密文标识；已有密钥目录配置不变。旧版保存策略已经丢弃的数据无法恢复。

剪贴板由用户主动访问，文件访问限于用户选择或拖放授权的范围。工具不会上传处理内容，默认构建关闭联网更新。

## 文档

[日常使用](docs/USAGE.md) · [架构](docs/ARCHITECTURE.md) · [桌面能力](docs/DESKTOP.md) · [密码学工具](docs/CRYPTO_TOOLS.md) · [构建与发布](docs/RELEASING.md) · [发布说明](docs/RELEASE_NOTES.md) · [研发交接](docs/HANDOFF.md)

## 开源许可证

本项目采用 [MIT License](LICENSE)，版权 © 2026 xzcode。各依赖库继续遵循各自的许可证。
