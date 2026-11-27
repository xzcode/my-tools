# 架构与扩展规范

## 运行链路

Vue 界面读取工具目录，收集当前输入、动作和配置；Worker 收到类型化请求后执行纯 TypeScript 转换，返回结果或错误。每个任务有独立运行编号，主动取消会销毁 Worker；旧任务不得覆盖新工具或新输入的结果。文件、窗口、剪贴板、菜单与设置通过受约束的 Rust 命令实现。

主界面与快捷启动窗口共用同一工具目录。快捷窗口通过事件通知主窗口打开工具，输入正文不通过最近使用列表或持久化状态传递。

## 工具接口

`src/core/types.ts` 定义 `ToolDefinition`、`ToolRequest`、`ToolResult`。目录中包含分类、检索关键词、示例、动作、选项、输出扩展名与批处理能力。界面统一生成动作和选项，不为每个工具重复编写基础布局。

新增工具时：

1. 在 `catalog.ts` 增加固定 ID、名称、示例、选项和动作。
2. 在核心引擎中分派至纯转换函数；不访问 DOM、网络、本机文件或持久化存储。
3. 返回文本结果、必要的摘要/警告；结构化可视化用 `ToolResult` 扩展字段。
4. 为容易出错的输入和输出精度增加边界测试，运行既有验收路径。

## 精度与边界

JSON 使用 lossless-json，保存数值原始表示。对于 YAML/CSV 转换，必须说明类型与结构限制，拒绝无法可靠转换的输入。CSV 默认不将内容自动猜测成数字；避免长 ID、邮政编码等被改变。

界面和 Rust 文件层均限制输入大小；批量操作逐个处理并单独保留每个文件的错误，不把整批文件一次性塞进主线程。正则匹配放入可终止 Worker，禁止动态执行用户 JavaScript。

JSON 路径仅支持文档明确列出的有限语法，不能执行表达式。cURL 只解析参数，不执行任何 shell 片段、不解析本机 `@file` 正文、不发送 HTTP 请求。SQL 工具只处理文本，不连接数据库。

## 本地数据

持久化为明确字段的偏好对象：主题、收藏工具 ID、最近使用 ID、快捷键、关闭窗口行为、最后打开工具。工具输入/输出和密钥不在此对象中。窗口位置由窗口状态插件管理。

## 依赖

Vue 与 Vite 负责界面；lossless-json、YAML、Papa Parse、sql-formatter、jsdiff 负责各自领域的解析。Node 仅用于开发与打包，不作为产品后台服务。Rust/Tauri 提供系统能力。

依赖通过 `package-lock.json` 和 `Cargo.lock` 固定。新增依赖须有实际功能理由，转换不得依赖在线服务。

## 版本与构建

`package.json`、`src-tauri/Cargo.toml`、`tauri.conf.json` 使用相同版本。构建脚本先运行 TypeScript 和前端构建；CI 在 macOS、Windows、Linux 各自的 runner 编译 Rust 并生成安装包。各平台安装包并不等同于跨平台原生交互验收，状态分别记录。

### v0.6.0 统一工作台

工作台模型和迁移/字段投影位于 src/core/workspace.ts；任务、标签、历史及保存队列在 src/composables/useWorkspace.ts；WorkspaceBar 为共享界面。Rust 按 src-tauri/src/workspace_options.json 验证配置型存档，使用 scripts/generate-workspace-schema.mjs 从目录生成白名单。保留 v1 AES 存档解析以兼容旧数据。完整存档复用既有原生加密存储；SVGA 使用受限文件授权、解压预检及播放器 Worker，手机号码规则与国旗资源随应用分发，不依赖网络。
