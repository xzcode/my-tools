# My Tools 0.4.0

新增 Java AES/ECB/PKCS5Padding **旧系统兼容模式**，保留既有简单模式、GCM/CBC 高级模式及全部 18 项工具。

- AES 高级模式新增 ECB：支持 AES-128/192/256、UTF-8/Hex/Base64 Key、PKCS5Padding/PKCS7 与 NoPadding，以及 Base64/Hex 密文。
- ECB 不使用 IV。选择 ECB 后不展示、解析或校验 IV，也不显示生成随机 IV 按钮。
- 新增「Java ECB/PKCS5」一键预设：高级模式、AES-256、Key UTF-8、PKCS7、UTF-8 明文、Base64 密文。与 Java SecretKeySpec(raw, "AES") 和 Cipher.getInstance("AES/ECB/PKCS5Padding") 的字节处理方式相匹配，前提是 Key 字节完全一致。
- 不添加加密库：使用系统 Web Crypto AES-CBC 单块操作及 CBC 去链式处理实现 ECB 兼容，不手写 AES 分组算法。ECB 加密明文限 256 KiB。
- ECB 不提供认证，会泄露重复明文块，仅供已有旧系统兼容。新系统继续推荐 GCM。

三平台构建与验收以 GitHub Actions 运行结果为准；Mac 未经 Apple 公证，Windows 未商业签名，在线更新默认关闭。
