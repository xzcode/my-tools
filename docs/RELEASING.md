# 构建与发布

## 默认安装包

`Desktop builds` 在推送 `master`、版本标签或手动运行时执行。安装包与截图直接上传到当前私有仓库的 **草稿 Release assets**，不使用 Actions Artifacts 作为下载入口：

1. 检查三个版本号一致，运行核心测试、TypeScript 构建、浏览器验收。
2. 分别在 macOS、Windows、Linux runner 上执行 Rust 格式检查、原生单元测试与 Tauri 打包。
3. 收集 `.dmg`、NSIS `.exe`、`.deb`，输出每个平台的 SHA-256 校验文件，上传到该次构建对应的草稿 Release。
4. 将界面验收生成的工作台、快捷启动窗口截图保存到同一草稿，便于查看安装包对应的界面。

默认三个目标：`aarch64-apple-darwin`、`x86_64-pc-windows-msvc`、`x86_64-unknown-linux-gnu`。Intel Mac 可在 macOS runner 增加 `x86_64-apple-darwin`；本版默认先覆盖 Apple Silicon。

| 触发方式 | 草稿标签 |
| --- | --- |
| 推送 `master` | `build-v<version>-<runid>-<attempt>` |
| 手动运行 | `build-v<version>-<runid>-<attempt>` |
| 推送 `v<version>` 标签 | 与触发工作流的版本标签一致；标签必须与应用版本匹配 |

普通构建的标签包含运行 ID 与重试次数，便于区分各次构建。版本标签构建不能覆盖同名的正式 Release；冲突应由维护者确认后处理。工作流不会自动将草稿发布，不会把私有仓库或安装包公开。

草稿用于汇集并行任务的结果，因此它可能先包含截图，随后逐步增加不同平台的安装包。**存在草稿或部分附件不代表全部平台构建成功。** 下载前核对对应 Actions 运行和目标平台任务；只有所有平台任务成功后，该次交付才算完整。失败或取消的构建保留其真实状态，不会把部分附件标记为完整发布。

## 获取安装包

1. 使用可管理该私有仓库的账号登录 GitHub，打开 [Releases](https://github.com/xzcode/my-tools/releases)。
2. 找到与 Actions 运行对应的草稿。普通构建可用标签里的运行 ID 对照 [Desktop builds](https://github.com/xzcode/my-tools/actions/workflows/desktop.yml)。
3. 在 Assets 下载目标平台安装包与 `SHA256SUMS-<target>.txt`。工作台和快捷窗口截图位于同一处。
4. 校验文件后安装。常见操作见 [日常使用指南](USAGE.md)。

本项目曾在测试通过后遇到账户 Actions Artifacts 存储配额阻止上传，随后改为 Release assets 分发。Release 附件与 Actions artifact 的存储机制不同；它们仍遵循 GitHub 的服务限制。GitHub 当前说明每个 Release 最多 1000 个附件，单文件必须小于 2 GiB，适合本项目的安装包和截图。依据：[GitHub Releases storage and bandwidth quotas](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas)、[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。

此调整不删除其他项目的产物，也不代替 Actions runner 的构建额度。构建日志与任务结果仍在 Actions 页面查看。

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

当前工作流生成签名包后将其作为草稿 Release 附件保存，不会部署更新服务器或发布更新清单。草稿附件不是供客户端自动访问的公开更新源。未配置发布源时，可登录 GitHub 下载新安装包手动更新。

## 发布检查

同步三个版本号；更新 `docs/RELEASE_NOTES.md`；验证该次草稿 Release 的实际安装包、截图和校验文件，以及相应 Actions 任务结果；在目标系统安装、启动，确认快捷键、托盘、文件、剪贴板；有证书的版本还需验证签名、公证和更新安装。需要正式发布时，再由维护者审核草稿并发布。只在交接记录中填写真实完成项。
