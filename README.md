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
| URL | 组件/完整 URI 编解码、参数解析与构建 |
| 时间戳 | 秒/毫秒与日期互转、当前时间、时区显示 |
| UUID/随机文本 | UUID v4、批量生成、加密随机源 |
| 哈希/HMAC | SHA-256、SHA-512、HMAC、hex/Base64 输出 |
| JWT | Header/Payload 与时间声明解析；不验证签名 |
| SQL | 方言格式化、IN 条件生成与字符串转义 |
| 正则 | 匹配、捕获组、替换、独立 Worker 超时中止 |
| Diff | 文本行/词对比、JSON 结构对比 |
| 数据转换 | JSON、YAML、CSV 互转 |
| cURL | 本地解析请求、参数、Header、Body；不执行命令、不发送请求 |

支持复制、显式读取剪贴板、文件导入导出、批量处理、收藏、最近使用、搜索与深浅主题。最近使用仅记录工具名称/ID，不记录处理内容。

## 安装包

GitHub [Actions → Desktop builds](https://github.com/xzcode/my-tools/actions/workflows/desktop.yml) 成功后，在该次运行的 **Artifacts** 下载：

- `My-Tools-macOS-Apple-Silicon`：适用于 M1/M2/M3/M4 等 Apple Silicon Mac 的 `.dmg`。
- `My-Tools-Windows-x64`：Windows x64 的 NSIS 安装程序 `.exe`。
- `My-Tools-Linux-x64`：Debian/Ubuntu 系列的 `.deb`。

每个包附带 SHA-256 校验文件。安装包是否实际生成，以对应 Actions 的成功结果为准；具体本次交付证据见 [交接记录](docs/HANDOFF.md)。

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

- 输入、输出、Token、HMAC 密钥只在当前会话内存中使用，不写入偏好设置，不发送到网络。
- 主题、收藏、最近使用、窗口位置等非内容配置保存到本机。
- 不轮询剪贴板；用户点击粘贴时才读取。
- 文件访问通过用户选择或当前窗口收到的拖放授权；不授予任意目录读写。
- 默认构建不启用网络更新。可选更新需独立配置 HTTPS 更新源与签名公钥，并由用户触发检查/安装。
- CPU 密集操作在 Worker 中执行；正则超时会终止任务，保留主界面可操作。

详细限制与扩展规范见 [架构](docs/ARCHITECTURE.md)、[桌面能力](docs/DESKTOP.md)、[M1–M5 交接](docs/HANDOFF.md)。
