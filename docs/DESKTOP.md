# My Tools 桌面层

## 运行方式

桌面程序使用 Tauri 2、系统 WebView 与 Vue 3。工具计算在本地 Web Worker 中执行；窗口、系统剪贴板、原生文件选择器、托盘、全局快捷键和可选更新由 Rust 层提供。程序不需要后台服务器、登录或转换 API。

```bash
npm ci
npm run desktop:dev
```

开发环境需要 Node.js 22.14+、Rust stable（至少 1.90）以及平台工具链。macOS 安装 Xcode Command Line Tools；Windows 安装 Visual Studio C++ Build Tools 与 WebView2；Linux 安装 Tauri 对应发行版的 WebKitGTK 4.1、GTK 3、AppIndicator 开发依赖。具体依赖以 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) 为准。

`npm run dev` 只运行浏览器界面预览。预览可使用浏览器允许的剪贴板和下载功能，全局快捷键、系统托盘、原生窗口及安装更新必须在桌面程序里验证。

## 窗口与快捷操作

| 能力 | 行为 |
| --- | --- |
| 主工作台 | 默认 1280 × 840，保留上次窗口尺寸、位置和最大化状态 |
| 快捷窗口 | 独立 680 × 520 窗口；搜索工具后打开主工作台对应页面 |
| 全局快捷键 | 默认 `CmdOrCtrl+Shift+Space`，再次触发隐藏快捷窗口 |
| 自定义快捷键 | 设置中修改；留空禁用；格式错误或占用会报告错误并保留原设置 |
| 系统托盘 / 菜单栏 | 打开工作台、快捷窗口、最近 5 个工具、退出 |
| 关闭主窗口 | 默认在托盘可用时隐藏；关闭“关闭后留在托盘”则退出整个程序 |
| 关闭快捷窗口 | 隐藏窗口，不退出整个程序 |
| 托盘不可用 | 关闭主窗口直接退出，避免应用留在后台却无法重新打开 |
| 单实例 | 第二次启动将激活已有主窗口 |
| macOS Dock | 点击 Dock 图标重新激活主窗口；应用菜单支持正常退出 |

快捷键注册失败不会阻止启动或其他工具使用。状态会显示在设置中；收藏和最近工具仍可保存。若某快捷键后来被其他应用释放，可先禁用并保存，再重新设置该快捷键。

Linux 下系统托盘可见性、全局快捷键支持受桌面环境影响。Wayland 或未安装托盘扩展的桌面需要在目标环境实测。

## 文件读写与处理范围

前端没有任意路径读写接口。文本导入和二进制导入都必须先经过原生文件选择器；保存必须经过原生保存对话框。前端提交的任意路径无法触发常规文件读取。

文件拖放使用额外范围检查：Rust 收到系统拖放事件后，仅授权当前窗口此次拖入的路径；授权最多存在 30 秒且只能消费一次。目录和符号链接不作为输入文件读取。

| 项目 | 限制 |
| --- | --- |
| 文本输入文件 | UTF-8；单个最多 5 MiB |
| 一批输入文件 | 最多 20 个，总量最多 20 MiB |
| 文本单文件导出 | 最多 20 MiB |
| 批量文本导出 | 最多 20 个，总量最多 20 MiB |
| Base64 二进制导入 / 导出 | 单个最多 5 MiB，不使用 UTF-8 解码 |
| 剪贴板读取 | 最多 5 MiB 文本，仅在点击读取时进行 |
| 剪贴板写入 | 最多 20 MiB 文本 |

批量导出在所选目录中创建 `my-tools-export-<时间戳>` 子目录，因此不会替换同名的既有文件。文件名会拒绝路径分隔符、目录穿越、重复名称和 Windows 保留设备名。单文件保存使用临时文件写完后替换目标，减少中途失败导致空文件的风险；覆盖选择由原生保存对话框处理。

浏览器预览的批量导出生成一个包含 UTF-8 文件名的 ZIP。二进制 Base64 与文本编解码是两个独立入口，解码为文件时直接写出字节，不进行字符替换。

## 本地设置与内容隐私

`preferences.json` 保存在 Tauri 的系统应用配置目录，应用标识为 `io.xzcode.mytools`。设置只包含：

- 主题；
- 收藏工具 ID；
- 最近使用的工具 ID；
- 上次工具 ID；
- 全局快捷键；
- 是否关闭后驻留托盘。

配置类型使用 `deny_unknown_fields`，额外字段会被拒绝。输入、输出、Token、HMAC 密钥和文件内容不会写入设置。损坏或格式不合法的配置在启动时使用默认值；窗口状态由 window-state 插件单独保存。

程序不读取剪贴板历史、不轮询剪贴板、不执行 cURL 命令、不连接数据库。工具结果的复制或文件保存均由用户主动触发。关闭整个程序会丢弃未导出的输入和结果。

## 权限与资源

`src-tauri/capabilities/desktop.json` 只授权内置 `main` 窗口；`launcher.json` 给快捷窗口分配较少权限，只允许设置元数据、选择工具和窗口操作，不能读取剪贴板、读取文件或安装更新。应用命令权限由 `build.rs` 逐项生成。没有向 WebView 开放 Shell、通用文件系统、任意 HTTP 客户端或插件自动更新命令。

生产 CSP 仅允许打包的脚本、样式、Worker 和本地 IPC。两个窗口都拒绝导航到远程页面。开发模式额外允许固定的本地 Vite 地址。输入和输出作为文本显示，不能加载为外部页面。

图标源文件为 `src-tauri/icons/app.svg`。PNG、ICO、ICNS 已包含在源码中，macOS 菜单栏使用模板图标，其他系统使用彩色图标。

## 构建安装包

在对应操作系统执行：

```bash
# macOS Apple Silicon
npm run desktop:build -- --target aarch64-apple-darwin --bundles app,dmg

# macOS Intel（需安装对应 Rust target）
npm run desktop:build -- --target x86_64-apple-darwin --bundles app,dmg

# Windows x64
npm run desktop:build -- --target x86_64-pc-windows-msvc --bundles nsis

# Linux x64
npm run desktop:build -- --bundles deb,appimage
```

构建产物在 `src-tauri/target/<target>/release/bundle/`，未指定 target 时位于 `src-tauri/target/release/bundle/`。仓库 CI 会归档对应产物；Linux 编译成功不能替代 macOS 或 Windows 构建结果。

基础配置的 macOS `signingIdentity` 为 `-`，即 ad-hoc 签名。它适合本地开发与个人试用，但不是 Apple Developer ID 签名，也不包含 Apple 公证。下载的未公证包可能被 Gatekeeper 拦截；用户可以在确认来源后依照 macOS 的“隐私与安全性”界面处理，正式分发应完成签名和公证。项目不提供关闭系统保护的脚本。

正式签名构建需要 Apple Developer 证书及公证凭据，或 Windows 代码签名证书。它们不存放在仓库中。若配置了 Apple 身份，构建覆盖配置必须把 `bundle.macOS.signingIdentity` 从 `-` 改为该身份；不能将 ad-hoc 成功当成正式签名成功。

## 可选签名更新

默认构建没有启用 `updater` feature，也没有更新服务器请求。设置界面会明确显示未配置更新源，并支持手动安装新版本。

启用条件是同时满足：

1. Rust 构建带 `--features updater`；
2. 构建环境中存在 HTTPS 的 `MY_TOOLS_UPDATE_ENDPOINT`；
3. 构建环境中存在 Tauri 更新签名公钥 `MY_TOOLS_UPDATE_PUBKEY`；
4. 发布包使用对应私钥签名，并以 Tauri 更新 manifest 格式分发。

示意构建流程：

```bash
# 在可信构建环境设置环境变量，不在源码中写入私钥。
# MY_TOOLS_UPDATE_ENDPOINT=https://your-owned-update-host/updates/latest.json
# MY_TOOLS_UPDATE_PUBKEY=<Tauri 更新签名公钥>
# TAURI_SIGNING_PRIVATE_KEY=<由安全存储注入>
# TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<由安全存储注入>

npm run desktop:build -- --features updater --config '{"bundle":{"createUpdaterArtifacts":true}}'
```

更新检查只由用户点击触发，超时 30 秒。检查返回版本和发布说明；只有点击安装才下载并验证签名、安装和重启。Windows 安装器可能在安装时直接退出应用，因此安装前应保存当前结果。无待安装更新时，安装命令会拒绝执行。

Tauri 更新签名与操作系统代码签名、公证是不同机制。私有 GitHub 仓库的 Release 默认需要鉴权，不能直接当成公开可访问更新端点，也不能把个人 GitHub Token 嵌入客户端。个人使用阶段可通过 GitHub 登录下载安装包；需要自动更新时应部署自己可控制的更新源及相应分发策略。

## 检查入口

```bash
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --all-features
```

Rust 单元测试检查配置字段拒绝、损坏配置回退、配置原子替换、文件名边界、无效 UTF-8、文件大小、目录拒绝与批量导出不覆盖既有文件。原生剪贴板、快捷键冲突、文件对话框和系统安装流程仍需要各目标平台的实际桌面运行验证。

## 参考

- [Tauri Global Shortcut](https://v2.tauri.app/plugin/global-shortcut/)
- [Tauri System Tray](https://v2.tauri.app/learn/system-tray/)
- [Tauri Dialog](https://v2.tauri.app/plugin/dialog/)
- [Tauri Clipboard](https://v2.tauri.app/plugin/clipboard/)
- [Tauri Updater](https://v2.tauri.app/plugin/updater/)
- [Tauri macOS Signing](https://v2.tauri.app/distribute/sign/macos/)
