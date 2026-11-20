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

- 57 个核心行为/后台任务测试通过，包括长整数、中文/二进制 Base64、SHA/HMAC 向量、SQL 引号、CSV、JSON Diff、输出放大、Worker 超时与取消。
- TypeScript 检查、Vite 生产构建通过。
- macOS、Windows、Linux 各自执行的 9 项 Rust 原生文件/设置测试，以及生产安装包构建、上传步骤均通过。本地 Linux 另已完成 `cargo check`、`cargo check --features updater`，可选更新功能编译通过。
- GitHub 运行 [44697286630](https://github.com/xzcode/my-tools/actions/runs/44697286630) 的 57 项单元/后台任务测试、10 项真实 Chromium 操作验收全部通过。界面验收耗时 16.5 秒，覆盖长整数 JSON、中文/二进制 Base64 往返、快捷搜索、敏感输入不持久化、正则超时恢复、Diff、批量部分失败隔离与本地 cURL 解析。
- 首轮运行 [44696636512](https://github.com/xzcode/my-tools/actions/runs/44696636512) 曾在全部界面测试通过后，因 GitHub Actions artifact storage quota 已满而无法上传截图，导致依赖的安装包作业跳过。已改为私有草稿 Release 保存安装包、截图与校验文件；新运行的三平台安装包均已实际上传。
- 升级开发测试依赖到 Vitest 5.1.1 后重新通过 57 项测试与生产构建；npm audit 当前报告 0 个已知漏洞。

当前交付环境禁止 Chromium 创建所需进程通信套接字，首次本地 Playwright 尝试在浏览器启动阶段报 `socket(): Operation not permitted`。真实界面验收已在 GitHub runner 执行通过，截图通过草稿 Release 保存。

## 本次交付

安装包对应源提交：[`15ef5ae814a002bb082bfeb21d3752d92c0919f0`](https://github.com/xzcode/my-tools/commit/15ef5ae814a002bb082bfeb21d3752d92c0919f0)。后续交接文档与发布导航修正不改变这些安装包中的应用代码。

下载：[仓库 Releases](https://github.com/xzcode/my-tools/releases)，选择 **My Tools 0.1.0 · ready to install**，构建标签为 `build-v0.1.0-44697286630-1`。使用可管理仓库的 GitHub 账号登录后，在 Assets 下载。GitHub 编辑草稿后可能改变其临时 URL，因此这里使用稳定的列表入口与构建标签定位。

本次 [完整工作流](https://github.com/xzcode/my-tools/actions/runs/44697286630) 已结束，结论为 **success**；质量检查、三平台打包和发布收尾均成功。

| 平台 | 安装包附件 | 大小（字节） |
| --- | --- | ---: |
| macOS Apple Silicon | `My.Tools_0.1.0_aarch64.dmg` | 2,733,450 |
| Windows x64 | `My.Tools_0.1.0_x64-setup.exe` | 2,177,995 |
| Linux x64（Ubuntu 24.04 构建） | `My.Tools_0.1.0_amd64.deb` | 3,225,934 |

同一草稿包含三个目标平台的 `SHA256SUMS-<target>.txt`，以及 `workbench.png`、`dark-theme.png`、`launcher.png` 三张真实浏览器界面截图。

GitHub 附件元数据记录的安装包 SHA-256：

```text
30d50e0b5ecf6e0f0b5456fbfcf155c1b098a508c1b0c2658b5a392bda3ee14d  My.Tools_0.1.0_aarch64.dmg
c2e8f393be94daf2a032a15c6360c437ae120ca913074219c0f40b7370570014  My.Tools_0.1.0_x64-setup.exe
ebce235fb1fb2b0a49297eef34cdc2b8c4e65f7e448de9c9c25a4be9e538d772  My.Tools_0.1.0_amd64.deb
```

## 使用方式

安装包查看仓库 Releases 中对应 `Desktop builds` 的私有草稿。macOS 选择 Apple Silicon `.dmg`，Windows 选择 x64 NSIS `.exe`；需要全部目标作业成功才能把草稿视为完整构建。

开发：`npm ci && npm run desktop:dev`。仅界面：`npm run dev`。功能验证：`npm run check`；UI：`npm run test:e2e`；原生：`cargo test --manifest-path src-tauri/Cargo.toml --locked`。

## 边界

- 默认仅持久化非内容偏好。工具正文和密钥只在会话内存。
- 单个导入文件 5 MiB，一批最多 20 个文件/总计 20 MiB。转换输出与批次有上限，不面向任意规模数据。
- 正则超时会销毁 Worker；不是后台长期运行任务。
- JWT 只解码，不验证签名；cURL 只解析，不执行；SQL 只格式化/生成文本。
- 树形视图限制深度/每层节点数；完整输出可在文本视图查看。
- 默认 macOS ad-hoc 签名，不含 Apple 公证；Windows 未配置商业签名。
- 自动更新代码与构建入口可选，未提供用户签名密钥或更新源，因此默认关闭。没有伪造发布源或把 GitHub 凭据嵌入客户端。
- 安装包已经在对应平台 runner 实际生成，原生单元测试通过；尚未在用户的 Mac/Windows 设备上手工安装和验收快捷键、托盘、剪贴板等系统交互。浏览器测试不代替这部分原生体验验收。
- Linux 包在 Ubuntu 24.04 构建，未宣称覆盖所有 Debian/Ubuntu 版本；其他发行版需要核对依赖或本机构建。

## 后续维护入口

先读 `AGENTS.md`。工具元数据在 `src/core/catalog.ts`；处理逻辑在 `src/core`；原生命令在 `src-tauri/src`；平台适配在 `src/platform/desktop.ts`。版本、签名和私有分发方式见 `docs/RELEASING.md`。
