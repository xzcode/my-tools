# 构建与发布

## 默认安装包

`Desktop builds` 在推送 `master`、版本标签或手动运行时执行：

1. 检查三个版本号一致，运行核心测试、TypeScript 构建、浏览器验收。
2. 分别在 macOS、Windows、Linux runner 上执行 Rust 格式检查、原生单元测试与 Tauri 打包。
3. 收集 `.dmg`、NSIS `.exe`、`.deb`，输出 SHA-256 校验文件，上传到该次 Actions 的 Artifacts。

默认三个目标：`aarch64-apple-darwin`、`x86_64-pc-windows-msvc`、`x86_64-unknown-linux-gnu`。Intel Mac 可在 macOS runner 增加 `x86_64-apple-darwin`；本版默认先覆盖 Apple Silicon。

推送 `v<version>` 标签或手动选择 `draft_release` 时，只有全部平台构建成功才创建 GitHub **草稿 Release**。已有同名 Release 时创建步骤失败，不自动覆盖历史正式发布。审核后可在 GitHub 上将草稿发布。安装包和草稿保持仓库原有的私有访问范围。

仓库如未启用 Actions、账户构建额度不足或 runner 不可用，构建会停留在平台侧；不可把配置文件存在当作安装包已构建。

## 本机构建

```bash
npm ci
npm run check
npm run desktop:build
```

输出位于 `src-tauri/target/release/bundle/`；指定 Rust target 后位于 `src-tauri/target/<target>/release/bundle/`。安装包应在对应操作系统构建。`scripts/build-desktop.mjs` 可读取 `BUILD_TARGET` 和 `BUILD_BUNDLE`，CI 使用它统一锁定依赖与可选更新设置。

## macOS 签名与公证

默认 `bundle.macOS.signingIdentity` 为 `-`，即 ad-hoc 签名，适合初期自用，但**不等于 Developer ID 签名或 Apple 公证**。初次打开下载的包时仍可能出现系统验证提示。

正式分发时在 GitHub Secrets 配置：

| Secret | 用途 |
| --- | --- |
| `APPLE_CERTIFICATE` | 导出的 Developer ID `.p12` 的 Base64 内容 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` 密码 |
| `APPLE_SIGNING_IDENTITY` | Developer ID Application 身份名称，覆盖默认 ad-hoc |
| `APPLE_ID` | Apple 公证账号 |
| `APPLE_PASSWORD` | 公证所需的 app-specific password |
| `APPLE_TEAM_ID` | 开发者团队 ID |

没有凭据时脚本删除空环境变量，避免空 secret 覆盖有效的 ad-hoc 配置。不要把 `.p12`、密码、私钥提交到仓库。

依据：[Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)。

## Windows 签名

默认 NSIS 安装器未使用商业代码签名，SmartScreen 可能提示未知发布者。正式发布需由拥有证书的人按 [Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/) 设置证书或受托签名命令。本项目不伪造证书、不降低系统安全策略，也不把账号凭据放入客户端。

## 可选自动更新

默认构建不包含启用的更新源，也不会联网检查。界面只有在启用 Cargo `updater` feature 且提供有效更新配置时开放检查。检查与安装分别由用户触发。

手动工作流选择 `updater` 前需配置：

| 配置 | 位置 | 内容 |
| --- | --- | --- |
| `MY_TOOLS_UPDATE_ENDPOINT` | Actions Variables | HTTPS 更新清单地址，可使用 Tauri 的目标/架构/版本占位符 |
| `MY_TOOLS_UPDATE_PUBKEY` | Actions Variables | Tauri updater 公钥，编译入客户端 |
| `TAURI_SIGNING_PRIVATE_KEY` | Actions Secrets | 生成更新签名的私钥 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Actions Secrets | 私钥密码，如设置 |

`node scripts/build-desktop.mjs` 要求这些必需值完整，启用 feature 并生成临时 Tauri 配置 `bundle.createUpdaterArtifacts=true`。临时配置被 gitignore 排除。私钥只用于构建签名，不打包到客户端。

先按 [官方 updater 文档](https://v2.tauri.app/plugin/updater/) 生成密钥并在安全位置保存。每个平台的包须生成对应 `.sig`，再将签名、版本、下载 URL 写入 HTTPS 更新清单。更新清单和包上传到你控制的发布源；对私有 GitHub 仓库，不可在应用中硬编码 GitHub Token。需要鉴权的更新分发应由专门的分发端处理。

当前工作流只生成签名包，不会擅自部署更新服务器或发布更新清单。未配置发布源时，可直接下载新安装包手动更新。

## 发布检查

同步三个版本号；更新 CHANGELOG/RELEASE_NOTES；验证该次工作流的实际安装包和校验文件；在目标系统安装、启动，确认快捷键、托盘、文件、剪贴板；有证书的版本还需验证签名、公证和更新安装。只在交接记录中填写真实完成项。
