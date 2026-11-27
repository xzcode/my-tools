# My Tools · M1–M5 与后续增量交接

日期：2026-11-27（Asia/Kuala_Lumpur）。**当前版本：0.6.1（新安装包待三平台构建确认）**；首版为 0.1.0。仓库：`xzcode/my-tools`，默认分支 `master`。




## 密码学工具箱 V2 · 开发分支

新增 7 项通用密钥/签名工具，复用统一工作台，含命名导出、目录持久化、隐私历史边界。进度和暂未实现的算法见 [密码学工具箱](CRYPTO_TOOLKIT.md)。本批仍需 CI 与原生安装验收。

## v0.6.1 · 每工具 100 个标签

- 每个工具独立支持 100 个 Tab，取消原来 96 个全局共享配额；20 项工具理论合计 2000 个。持久化的 32 MiB 内容容量和最近 200 条历史仍保留。
- 同步调整前端创建/恢复和存档校验、Rust 配置存档校验；深层保存监听合并同一轮编辑，快速切换下拉及活动 Tab 滚动可见。
- v0.6.0 GitHub Actions #45956562270 的 npm ci 因锁文件使用腾讯云内网 npm 地址失败；将锁定下载地址改为公网官方 npm registry，保留 integrity 校验。
- 安装包与实际验证结果以本次 GitHub Actions 为准。

## v0.6.0 · 全工具工作台、历史、号码与 SVGA

- 20 项工具共享工作台，独立 Tab ID、每工具活动标签、Worker/二进制/批次任务归属；历史支持恢复、逐条删除及按时间清理。
- 存储 v2 兼容迁移 v1；默认仅非敏感配置，显式完整会话保存使用已有系统凭据保护的 AES-GCM 存档，浏览器预览不等同于 OS 凭据库。32 MiB 存档限制。
- 新增离线国际号码规则校验与国旗区号列表；SVGA 1.x/2.x 本地动画预览、逐帧和播放控制。无音频支持。
- v0.5.0 CI #45927451006 未完成三平台构建：浏览器验收中密文前缀设置标签重名。v0.6.0 已区分字段名称并继续回归。
- 本次实际测试结果与安装包可在对应提交和 GitHub Actions 查看；不将未完成的安装包标为通过。

## v0.5.0 · AES 多标签、密文前缀及会话恢复

本轮新增 AES 多标签、模板、可选完整加密会话保存和精确的字面量密文前缀。保留 v0.4.0 算法兼容性，前缀留空时行为不变。核心状态与保存策略见 src/core/aes-workspace.ts；Worker 分配、标签管理及保存队列见 src/composables/useAesWorkspace.ts（v0.6.0 起统一为 useWorkspace.ts）；原生存档和系统凭据见 src-tauri/src/aes_workspace.rs。浏览器预览的 IndexedDB 存储不是桌面凭据库，不用于真实敏感数据。默认仅保存非敏感配置，完整模式必须用户明确确认，系统凭据不可用时禁止明文降级。存档上限 4 MiB、打开上限 16、关闭历史 10、自定义模板 30。正常退出刷新；强制终止或断电可能丢失尚未落盘的最后修改。真实设备的系统凭据交互与签名安装仍需人工验收。

## v0.4.0 · Java AES/ECB/PKCS5Padding 旧系统兼容

- 原有 **18 项工具**以及 AES 简单模式、GCM/CBC 高级模式保留不变。高级模式增加 **ECB（旧系统兼容）**，不用于新开发的加密协议。
- 与 Java javax.crypto.spec.SecretKeySpec(raw, "AES") + Cipher.getInstance("AES/ECB/PKCS5Padding") 对接：精确使用 raw 密钥字节；AES-128/192/256 需要 16/24/32 字节；例如无连字符的 32 个 ASCII 字符 UUID 经 UTF-8 转换后为 AES-256 Key。若 Java 先解码十六进制则 Key 编码应选 Hex，不能按原字符串长度猜测 Key 长度。
- ECB **不需要 IV**。该模式不展示、不解析、不校验 IV/IV 编码，也不显示随机 IV 按钮；新增「Java ECB/PKCS5」一键预设：高级模式、ECB、AES-256、Key UTF-8、Padding PKCS7、明文 UTF-8、密文 Base64。支持 PKCS7（AES 上与 Java 的 PKCS5Padding 兼容）和 NoPadding。
- 使用系统 Web Crypto AES-CBC 分组操作进行 ECB 兼容变换，没有自己实现 AES 轮算法，也没有增加第三方加密依赖。ECB 加密端有 256 KiB 明文限制，避免逐块异步调用导致长期占用；解密仍受原有单次文本/Worker 大小和超时限制。
- **安全警告：** ECB 不具有密文完整性认证，会暴露重复明文块；填充正确不代表解密结果可信。此模式只用于已有 Java 旧系统兼容；新系统继续推荐 GCM。

### v0.4.0 验证与附件

- 功能与验收源提交：[d719b398](https://github.com/xzcode/my-tools/commit/d719b398a24c267117b9c3ccb034eeffadf4bb18)，随后文档提交不改变已构建源码。
- [GitHub Actions #45136363419](https://github.com/xzcode/my-tools/actions/runs/45136363419) 结论 **success**，83 项 Vitest 核心/Worker 测试与 14 项真实 Chromium 页面操作测试全部通过，且 TypeScript/前端构建、三平台原生测试和安装包构建上传成功。ECB 的独立测试对照 Node.js AES-128/192/256 ECB Base64 输出及 NIST AES-128 ECB NoPadding 向量，并验证旧模式解密兼容。
- 私有草稿：[Releases](https://github.com/xzcode/my-tools/releases) → **My Tools 0.4.0 · ready to install**；构建标签 build-v0.4.0-45136363419-1。使用稳定的列表入口，避免 GitHub 草稿临时地址更新导致失效。

| 目标平台 | 已生成附件 | 大小（字节） | SHA-256 |
| --- | --- | ---: | --- |
| Mac Apple Silicon | My.Tools_0.4.0_aarch64.dmg | 2,741,566 | 2ac7ba31e2f73e360635a7252a01e58d0655fb1500a00a63c0aa8b7b526e4bc4 |
| Windows x64 | My.Tools_0.4.0_x64-setup.exe | 2,183,994 | 519d0e3c914628aa423a8f753c1c90248ceecc5ae2a321b4afb960b8adae22fc |
| Linux x64（Ubuntu 24.04） | My.Tools_0.4.0_amd64.deb | 3,229,982 | e5e41a014fc36103f96bc2005d01b75e93c332385bb33fed3dbfd2611b24ed6f |

同一私有草稿包含三个 SHA256SUMS 校验文件与 UI 验收截图。macOS 默认 ad-hoc 签名，无 Apple 公证；Windows 无商业签名；未在用户真实电脑上做手工安装测试。

---

## v0.3.0 · AES 简单/高级双模式

原有 18 项工具和 v0.2.0 的 AES-256-GCM + PBKDF2 JSON 密文格式保留不变；AES 工具新增“高级模式 · 原始 Key / IV”。

- 算法与 Key：原始 AES-128/192/256 字节密钥；GCM 或 CBC；Key 精确为 16/24/32 字节，支持 UTF-8、Hex、Base64 输入，不做补齐、截断或 PBKDF2。
- IV：GCM 恰好 12 字节、CBC 恰好 16 字节，支持 UTF-8、Hex、Base64；UI 可一键用安全随机数生成新的 Hex IV，但需要用户保存和与密文配对。每次 GCM 加密使用同一 Key 时绝不可重复 IV。
- 编码：明文 UTF-8/Hex/Base64，密文 Base64/Hex；GCM Tag 支持 96/104/112/120/128 bit，合并在密文末尾或单独 JSON ciphertext/tag 字段；可选 AAD。
- CBC Padding：PKCS7（字节层对应 Java AES/CBC/PKCS5Padding）与 NoPadding（需 16 字节整数倍）。Web Crypto 强制 CBC PKCS7，因此 NoPadding 路径使用原生 AES-CBC 对齐前缀加密 / 合成尾部填充块来进行兼容，且与 NIST 测试向量和 Node.js 字节对照验证。
- 风险边界：CBC 不提供完整性认证，不支持 ECB；高级 GCM 需要用户确保 IV 不复用。Key、IV、口令、正文不会持久化；复制到系统剪贴板或导出文件后由用户自行管理。旧版简单模式仍以密码派生 Key 的版本化 JSON 作为密文输入/输出。

### 验证与安装包

- 安装包源提交：[4c1e409f](https://github.com/xzcode/my-tools/commit/4c1e409f00d19bae2b5d2d5e6499b1d2fc58905f)。本交接文档提交在其后，未修改构建应用代码。
- [Desktop builds #44716371232](https://github.com/xzcode/my-tools/actions/runs/44716371232)：最终结论 **success**，75 项 Vitest 单元/Worker 测试、13 项真实 Chromium UI 验收及 TypeScript / Vite 生产构建全部通过；Mac/Windows/Linux 的原生测试、优化构建和安装包上传均成功。
- 私有草稿下载：[仓库 Releases](https://github.com/xzcode/my-tools/releases) → **My Tools 0.3.0 · ready to install**，构建标签为 build-v0.3.0-44716371232-1。GitHub 草稿临时 URL 可能变更，使用稳定 Releases 入口。
  
| 平台 | 实际上传附件 | 大小（字节） | SHA-256 |
| --- | --- | ---: | --- |
| Mac Apple Silicon | My.Tools_0.3.0_aarch64.dmg | 2,739,309 | c0c551bf893550c177fdbbc00a14186bf3b32fe275e2de650e7405f8cb4cf330 |
| Windows x64 | My.Tools_0.3.0_x64-setup.exe | 2,181,573 | 9b9c615cba1eee4321066588dac9d43d03009a76353de20ed594c6ce3507d6d0 |
| Linux x64（Ubuntu 24.04 构建） | My.Tools_0.3.0_amd64.deb | 3,229,476 | e0d9af634c05a42e4ae7e692641d3d6bd044d16e6256e0345ccd9c2db07799fd |

同一私有草稿存有 3 份 SHA256SUMS 校验文件和浏览器界面截图。macOS 默认 ad-hoc 签名未经过 Apple Developer 公证，Windows 未配置商业签名；未在用户真实设备上手动安装验收，因此原生系统交互只声明 CI 原生单元测试和打包已通过。

---

## v0.2.0 · AES 与强密码生成器

新增 2 项工具，总数增至 **18 项**，不改变原有 16 项工具的行为：

- AES 加解密：本地 Web Crypto AES-256-GCM（128 bit 认证标签），PBKDF2-HMAC-SHA256 600,000 次口令派生；每次随机 16 B 盐和 12 B IV；密文以带版本/算法/KDF/参数的 JSON 封装；解密错误口令、版本不符或认证失败不会输出未经验证的明文。口令至少 8 字符，建议使用密码生成器生成长口令。
- 强密码生成器：Web Crypto 安全随机源、拒绝采样和 Fisher–Yates 洗牌；支持 12–128 字符、1–50 条，选择大写、小写、数字、符号及易混淆字符过滤；每条包含至少一个所选类型的字符。
- AES 密码输入框隐藏，示例操作不会自动提供默认密钥，当前工具“清空”会擦除该输入框内容；处理正文、密钥、生成密码都不持久化，只在会话内存中。密文复制到系统剪贴板后由系统自行管理。
- AES JSON 格式只和明确实现了同格式的程序互通，不直接兼容 CryptoJS/OpenSSL 传统盐格式、AES-CBC 或 ECB。**口令丢失后无法从密文恢复明文**。本功能不是文件级全盘加密或密码管理器。

### 测试与安装包

- 功能源码与构建对应提交：[9ddb2e41](https://github.com/xzcode/my-tools/commit/9ddb2e41a134d28bed695bbd60ebdafa963016e5)。
- [Desktop builds #44702779040](https://github.com/xzcode/my-tools/actions/runs/44702779040)：最终结论 **success**；64 项 Vitest 核心/后台任务测试、12 项真实 Chromium 浏览器操作验收、前端类型检查/生产构建，以及 macOS/Windows/Linux 各自 Rust 原生测试与打包上传成功。
- 私有草稿下载：[Releases](https://github.com/xzcode/my-tools/releases)，选择 **My Tools 0.2.0 · ready to install**，对应构建标签为 build-v0.2.0-44702779040-1（草稿临时 URL 可能变化，不作为固定文档链接）。

| 平台 | 已生成附件 | 大小（字节） | SHA-256 |
| --- | --- | ---: | --- |
| macOS Apple Silicon | My.Tools_0.2.0_aarch64.dmg | 2,734,680 | 79e0393afcc2f88cfb117f248042b8b77b4c54ce6b36d9b089dc178d3abd3083 |
| Windows x64 | My.Tools_0.2.0_x64-setup.exe | 2,179,676 | 81f13cea0fd69e660c7d8212ec2ac04d3eba4711f740a36b0aefa4081839ae03 |
| Linux x64（Ubuntu 24.04 runner） | My.Tools_0.2.0_amd64.deb | 3,227,048 | bd4992ee6a338a21bc733915749f20776e0edf71ede2dc02f6fa7577b3c361aa |

草稿中也包含三个 SHA256SUMS 校验文件与界面验收截图。未进行 Apple Developer 公证、Windows 商业签名或用户本机的手动安装验收；可选在线更新仍为默认关闭。后续需要跨工具/语言兼容原始 AES 密钥格式时，应新增明确标识的原始密钥模式，不要以当前带口令 JSON 格式冒充通用 AES-CBC 格式。

---

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

## v0.1.0 首版交付（历史记录）

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
