# My Tools · M1–M5 交接

日期：2026-11-20（Asia/Kuala_Lumpur）。版本：0.1.0。仓库：`xzcode/my-tools`，默认分支 `master`。

## 目标与实现

从空仓库实现个人日常桌面工具箱，技术栈 Tauri 2 + Vue 3 + TypeScript + Rust。默认离线，无登录、无后端服务。

| 阶段 | 实现范围 |
| --- | --- |
| M1 | Tauri 工程、工作台、JSON、字符串拼接、Base64、原生剪贴板、文本/二进制文件操作 |
| M2 | 文本、URL、时间戳、UUID/随机文本、SHA/HMAC、JWT、SQL 格式化/IN、正则，共 16 个工具 |
| M3 | 独立快捷窗口、可配置全局快捷键、系统托盘/菜单栏、收藏/最近使用、窗口状态与主题 |
| M4 | JSON 结构 Diff、文本 Diff、JSON/YAML/CSV、批量文件处理、本地 cURL 解析、可中止 Worker |
| M5 | 三平台 CI、安装包收集与 SHA-256、版本一致性检查、可选签名更新接入、发布与使用文档 |

## 已完成验证

- 47 个核心行为/边界测试通过，包括长整数、中文/二进制 Base64、SHA/HMAC 向量、SQL 引号、CSV、JSON Diff、输出放大边界。
- TypeScript 检查、Vite 生产构建通过。
- Linux Rust `cargo check` 通过。
- 原生 Rust 单元测试、GitHub 三平台构建与 UI 操作验收仍在本次交付中执行，完成后更新本节；不能据此推断安装包已生成。

当前交付环境禁止 Chromium 创建所需进程通信套接字，首次本地 Playwright 尝试在浏览器启动阶段报 `socket(): Operation not permitted`，尚未运行界面用例。CI 已包含真实浏览器测试与截图保存。

## 使用方式

安装包查看 GitHub Actions 的 `Desktop builds` 成功运行中的 Artifacts。macOS 选择 Apple Silicon `.dmg`，Windows 选择 x64 NSIS `.exe`。

开发：`npm ci && npm run desktop:dev`。仅界面：`npm run dev`。功能验证：`npm run check`；UI：`npm run test:e2e`；原生：`cargo test --manifest-path src-tauri/Cargo.toml --locked`。

## 边界

- 默认仅持久化非内容偏好。工具正文和密钥只在会话内存。
- 单个导入文件 5 MiB，一批最多 20 个文件/总计 20 MiB。转换输出与批次有上限，不面向任意规模数据。
- 正则超时会销毁 Worker；不是后台长期运行任务。
- JWT 只解码，不验证签名；cURL 只解析，不执行；SQL 只格式化/生成文本。
- 树形视图限制深度/每层节点数；完整输出可在文本视图查看。
- 默认 macOS ad-hoc 签名，不含 Apple 公证；Windows 未配置商业签名。
- 自动更新代码与构建入口可选，未提供用户签名密钥或更新源，因此默认关闭。没有伪造发布源或把 GitHub 凭据嵌入客户端。
- 原生快捷键、托盘及安装器的目标系统交互验收与编译结果分别记录。

## 后续维护入口

先读 `AGENTS.md`。工具元数据在 `src/core/catalog.ts`；处理逻辑在 `src/core`；原生命令在 `src-tauri/src`；平台适配在 `src/platform/desktop.ts`。版本、签名和私有分发方式见 `docs/RELEASING.md`。
