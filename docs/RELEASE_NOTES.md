# My Tools 0.1.0

首个桌面版本，包含 16 个个人开发工具、统一输入输出工作台、独立快捷启动窗口、收藏与最近使用、主题、原生文件与剪贴板操作。

转换离线执行，输入内容不写入偏好设置。提供长整数 JSON、中文 Base64、正则 Worker 超时、结构化 JSON 对比与本地 cURL 解析。

此版本默认 macOS ad-hoc 签名、Windows 未配置商业签名；未进行 Apple Developer 公证。可选自动更新仅在配置 HTTPS 更新源和签名密钥后启用。

安装包、`SHA256SUMS-<target>.txt` 与工作台 / 快捷窗口截图保存在本次私有草稿 Release 的 Assets。请选择与操作系统及 CPU 架构相符的安装包：Apple Silicon Mac 使用 `aarch64` 的 `.dmg`，Windows x64 使用 `.exe`，Debian/Ubuntu x64 使用 `.deb`。

普通构建草稿使用 `build-v<版本>-<运行ID>-<重试次数>` 标签；版本标签构建使用 `v<版本>`。工作流不会自动将草稿发布。附件会随平台任务完成逐步补齐，草稿存在不代表全部平台已经完成。

日常操作见 [使用指南](https://github.com/xzcode/my-tools/blob/master/docs/USAGE.md)，下载与发布流程见 [构建与发布](https://github.com/xzcode/my-tools/blob/master/docs/RELEASING.md)。具体构建和验收证据见 [交接记录](https://github.com/xzcode/my-tools/blob/master/docs/HANDOFF.md)。
