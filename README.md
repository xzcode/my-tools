# My Tools Desktop

个人日常使用的离线开发工具箱。基于 **Tauri 2 + Vue 3 + TypeScript + Rust**，面向 macOS Apple Silicon、Windows x64 和 Linux x64。

主工作台用于编辑与文件处理；独立快捷窗口用于搜索、收藏和快速打开工具。转换在本机运行，无账号、无远程转换服务。

## 工具

| 工具 | 能力 |
| --- | --- |
| JSON 工作台 | 格式化、压缩、校验、键排序、转义/反转义、路径提取、树视图；保留长整数精度 |
| 字符串拼接 | 多行拼接、分隔符、前后缀、引号、空行处理、去重 |
| 文本处理 | 去重、排序、替换、空白整理、大小写、HTML 转义 |
| Base64 | UTF-8 中文与 Emoji、URL-safe、填充、十六进制字节模式 |
| AES 加解密 | 简单模式：AES-256-GCM / PBKDF2 JSON；高级模式：AES-128/192/256、GCM/CBC、Key/IV、Padding、Hex/Base64 与 GCM Tag/AAD |
| URL | 组件/完整 URI 编解码、参数解析与构建 |
| 时间戳 | 秒/毫秒与日期互转、当前时间、时区显示 |
| UUID/随机文本 | UUID v4、批量生成、加密随机源 |
| 强密码生成器 | 12–128 字符、1–50 条、字符类别与易混淆字符过滤、安全随机抽样 |
| 哈希/HMAC | SHA-256、SHA-512、HMAC、hex/Base64 输出 |
| JWT | Header/Payload 与时间声明解析；不验证签名 |
| SQL | 方言格式化、IN 条件生成与字符串转义 |
| 正则 | 匹配、捕获组、替换、独立 Worker 超时中止 |
| Diff | 文本行/词对比、JSON 结构对比 |
| 数据转换 | JSON、YAML、CSV 互转 |
| cURL | 本地解析请求、参数、Header、Body；不执行命令、不发送请求 |

共有 **18 项工具**，支持复制、显式读取剪贴板、文件导入导出、批量处理、收藏、最近使用、搜索与深浅主题。

AES 简单模式使用 Web Crypto 认证加密和本项目自有 JSON 封装；高级模式接受原始 Key/IV，可与明确匹配参数的 Java/Node.js/Python AES GCM/CBC 实现互通。新增加 Java AES/ECB/PKCS5Padding 旧系统兼容及一键预设（ECB 无 IV、无完整性认证）。高级 CBC 无完整性认证；GCM 加密时同一 Key 下绝不能复用 IV。加密口令须自行保存，**丢失口令无法恢复明文**。密码生成使用安全随机源，不依赖 Math.random。最近使用仅记录工具名称/ID，不记录处理内容。

第一次使用可直接看 [日常使用指南](docs/USAGE.md)，其中包含 JSON、字符串拼接、Base64 文件处理和快捷键的操作示例。

## 安装包

仓库现已公开，但目前的安装包仍在 **Draft Release（草稿发布）** 中，仅有发布管理权限的账号可以查看和下载；普通访客需等正式发布 Release 才能下载。打开 [Releases](https://github.com/xzcode/my-tools/releases)，在对应构建的 **草稿 Release → Assets** 中下载：

- `.dmg`：适用于 M1/M2/M3/M4 等 Apple Silicon Mac，选择 `aarch64` 架构。
- `.exe`：Windows x64 的 NSIS 安装程序。
- `.deb`：Linux x64 安装包，在 Ubuntu 24.04 构建；其他发行版需核对系统依赖，或在目标环境自行构建。

普通 `master` 推送或手动构建使用 `build-v<版本>-<运行ID>-<重试次数>` 草稿；版本标签构建使用相同的 `v<版本>` 标签草稿。安装包附带 `SHA256SUMS-<平台>.txt`，同一草稿还收集工作台与快捷窗口截图。

草稿可能在平台构建过程中已出现，此时附件仍在补齐。是否已经完整生成，以对应 [Actions → Desktop builds](https://github.com/xzcode/my-tools/actions/workflows/desktop.yml) 的实际结果为准；具体本次交付证据见 [交接记录](docs/HANDOFF.md)。工作流不会自动把草稿发布，也不会改变仓库的私有访问范围。

本项目将安装包和截图存入 Release assets，不依赖 Actions Artifacts 的存储配额；Actions 页面仍用于查看构建状态和日志。

macOS 默认采用 ad-hoc 签名，自用版本未接入 Apple Developer 公证；Windows 默认未配置商业代码签名。签名、公证和可选自动更新的配置见 [发布说明](docs/RELEASING.md)。不需要为了本地运行提供账号或服务端。

## 本地开发

要求 Node.js **22.14+**、Rust stable，以及 [Tauri 官方平台构建依赖](https://v2.tauri.app/start/prerequisites/)。macOS 需要 Xcode Command Line Tools；Windows 需要 C++ Build Tools 和 WebView2；Linux 需要 GTK/WebKitGTK 开发包。

```bash
npm ci
npm run desktop:dev
```

只开发/检查界面时：

```bash
npm run dev
```

浏览器预览用于界面调试，剪贴板、文件、托盘、全局快捷键的原生行为应以桌面应用为准。

```bash
npm run check
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run desktop:build
```

首次运行浏览器测试前执行 `npx playwright install chromium`；也可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 使用已安装的 Chromium。

## 项目结构

```text
src/
  core/          工具目录、纯 TypeScript 转换逻辑
  components/    编辑器、树视图和通用界面
  composables/   Worker 调度与界面状态
  workers/       隔离耗时转换任务
  platform/      桌面 IPC 与浏览器调试适配
src-tauri/       Rust 桌面窗口、菜单、文件、剪贴板、权限
tests/          核心边界测试、浏览器操作验收
scripts/        版本检查、打包与校验文件生成
docs/           使用、架构、发布、阶段与交接记录
```

## 数据处理原则

- 输入、输出、Token、HMAC 密钥、AES 加密口令与生成的密码只在当前会话内存中使用，不写入偏好设置，不发送到网络。
- 主题、收藏、最近使用、窗口位置等非内容配置保存到本机。
- 不轮询剪贴板；用户点击粘贴时才读取。
- 文件访问通过用户选择或当前窗口收到的拖放授权；不授予任意目录读写。
- 默认构建不启用网络更新。可选更新需独立配置 HTTPS 更新源与签名公钥，并由用户触发检查/安装。
- CPU 密集操作在 Worker 中执行；正则超时会终止任务，保留主界面可操作。

详细说明见 [日常使用](docs/USAGE.md)、[架构](docs/ARCHITECTURE.md)、[桌面能力](docs/DESKTOP.md)、[构建与发布](docs/RELEASING.md)、[M1–M5 交接](docs/HANDOFF.md)。

## 开源许可证

本项目采用 [MIT License](LICENSE)，版权归 © 2026 xzcode 所有。允许个人或商业使用、修改和再分发，但须保留原版权及许可证声明。依赖库仍各自遵循其原有许可证。
