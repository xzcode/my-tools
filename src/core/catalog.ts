import { cryptoTools } from './crypto-catalog';
import { phoneCountries } from './phone';
import type { OptionValue, ToolCategory, ToolDefinition, ToolOption } from './types';

const select = (key: string, label: string, choices: [string, string][], defaultValue = choices[0]![0]): ToolOption => ({ key, label, type: 'select', defaultValue, choices: choices.map(([value, label]) => ({ value, label })) });
const text = (key: string, label: string, defaultValue = '', description?: string): ToolOption => ({ key, label, type: 'text', defaultValue, description });
const check = (key: string, label: string, defaultValue = true): ToolOption => ({ key, label, type: 'checkbox', defaultValue });
const number = (key: string, label: string, defaultValue: number, min: number, max: number): ToolOption => ({ key, label, type: 'number', defaultValue, min, max });
const actions = (...pairs: [string, string][]) => pairs.map(([id, label]) => ({ id, label }));

export const categories: { id: ToolCategory; name: string }[] = [
  { id: 'data', name: '数据处理' }, { id: 'text', name: '文本工具' }, { id: 'encoding', name: '编码转换' },
  { id: 'datetime', name: '日期与时间' }, { id: 'developer', name: '开发辅助' }, { id: 'crypto', name: '密码学工具' },
];

export const tools: ToolDefinition[] = [
  { id: 'json', name: 'JSON 工作台', description: '格式化、压缩与校验，保留大整数精度。', category: 'data', icon: 'braces', keywords: ['json', '格式化', '压缩', '校验', '树', '路径'],
    inputLabel: 'JSON 输入', sampleInput: '{"project":"My Tools","version":"0.1.0","offline":true,"tools":["JSON","Base64","字符串拼接"],"settings":{"theme":"system","saveContent":false}}',
    options: [select('indent', '缩进', [['2', '2 个空格'], ['4', '4 个空格'], ['tab', 'Tab']]), text('path', '提取路径', '$.settings.theme', '支持 $.key[0]、$["key.with.dot"] 或 JSON Pointer /key/0')],
    actions: actions(['format', '格式化'], ['minify', '压缩'], ['validate', '校验'], ['sort', '排序键名'], ['escape', '转义'], ['unescape', '反转义'], ['path', '提取路径'], ['tree', '树形概览']), defaultAction: 'format', extension: 'json', supportsBatch: true },
  { id: 'string-join', name: '字符串拼接', description: '多行变一行，自定义分隔符、包裹与前后缀。', category: 'text', icon: 'link', keywords: ['join', 'string', '字符串', '拼接', '前后缀'],
    sampleInput: 'apple\nbanana\norange\napple', options: [text('separator', '分隔符', ', ', '可输入 \\n 或 \\t'), select('quote', '包裹字符', [['none', '无'], ['single', '单引号'], ['double', '双引号'], ['backtick', '反引号']]), text('prefix', '每项前缀'), text('suffix', '每项后缀'), check('trim', '去除首尾空格'), check('skipEmpty', '跳过空行'), check('dedupe', '去重', false)],
    actions: actions(['join', '拼接']), defaultAction: 'join', extension: 'txt', supportsBatch: true },
  { id: 'text', name: '文本处理', description: '去重、排序、替换、大小写转换与 HTML 转义。', category: 'text', icon: 'text', keywords: ['text', '文本', '排序', '去重', 'replace', 'html'], sampleInput: 'hello world\nMy Tools\nhello world\n  offline first  ',
    options: [check('trim', '去除每行首尾空格'), check('skipEmpty', '跳过空行'), text('find', '查找文本'), text('replace', '替换为')],
    actions: actions(['dedupe', '行去重'], ['sort', '升序'], ['sort-desc', '降序'], ['trim', '清理空白'], ['replace', '全部替换'], ['upper', '大写'], ['lower', '小写'], ['html-escape', 'HTML 转义'], ['html-unescape', 'HTML 反转义']), defaultAction: 'dedupe', extension: 'txt', supportsBatch: true },
  { id: 'base64', name: 'Base64 编解码', description: '支持中文、Emoji、URL-safe 与二进制十六进制。', category: 'encoding', icon: 'binary', keywords: ['base64', '编码', '解码', '文件'], sampleInput: '你好，My Tools 👋',
    options: [check('urlSafe', 'URL-safe 字符集', false), check('padding', '编码保留 = 填充'), select('inputEncoding', '编码输入格式', [['utf8', 'UTF-8 文本'], ['hex', '十六进制字节']]), select('outputEncoding', '解码输出格式', [['utf8', 'UTF-8 文本'], ['hex', '十六进制字节']])],
    actions: actions(['encode', '编码'], ['decode', '解码']), defaultAction: 'encode', extension: 'txt', supportsBatch: true },
  { id: 'url', name: 'URL 工具', description: '组件编解码、查询参数解析与参数构建。', category: 'encoding', icon: 'globe', keywords: ['url', 'uri', 'query', '参数', '百分号'], sampleInput: 'https://example.com/search?q=hello%20world&tag=dev&tag=tools',
    options: [select('mode', '编码范围', [['component', '单个参数 / URI 组件'], ['uri', '完整 URI']]), check('form', '解码时将 + 视为空格', false)], actions: actions(['encode', '编码'], ['decode', '解码'], ['parse', '解析 URL'], ['build', 'JSON 构建参数']), defaultAction: 'parse', extension: 'txt', supportsBatch: true },
  { id: 'timestamp', name: '时间戳转换', description: '秒、毫秒与 ISO 日期互转，可指定显示时区。', category: 'datetime', icon: 'clock', keywords: ['timestamp', '时间', '日期', 'unix', '时区'], sampleInput: '1795152000000',
    options: [select('unit', '时间戳单位', [['auto', '自动识别（11 位起为毫秒）'], ['seconds', '秒'], ['milliseconds', '毫秒']]), select('timezone', '显示时区', [['Asia/Kuala_Lumpur', '吉隆坡 · UTC+08'], ['Asia/Shanghai', '上海 · UTC+08'], ['UTC', 'UTC'], ['America/New_York', '纽约'], ['Europe/London', '伦敦'], ['local', '系统时区']])],
    actions: actions(['to-date', '时间戳 → 日期'], ['to-timestamp', '日期 → 时间戳'], ['now', '当前时间']), defaultAction: 'to-date', extension: 'txt', supportsBatch: true },
  { id: 'uuid', name: 'UUID 与随机字符串', description: '使用系统加密随机源，批量生成 UUID v4 或随机文本。', category: 'developer', icon: 'fingerprint', keywords: ['uuid', 'random', '随机', '密码'], sampleInput: '',
    options: [number('count', '生成数量', 5, 1, 1000), number('length', '随机字符串长度', 24, 1, 256), select('alphabet', '随机字符集', [['alphanumeric', '字母 + 数字'], ['hex', '十六进制'], ['password', '字母 + 数字 + 符号']]), check('uppercase', '大写', false), check('hyphens', 'UUID 保留连字符')],
    actions: actions(['uuid', '生成 UUID'], ['random', '生成随机字符串']), defaultAction: 'uuid', extension: 'txt' },
  { id: 'hash', name: '哈希与 HMAC', description: '计算 SHA-256 / SHA-512 摘要或带密钥的 HMAC。', category: 'crypto', icon: 'hash', keywords: ['sha', 'sha256', 'sha512', 'hmac', '哈希', '摘要'], sampleInput: 'hello world',
    options: [select('algorithm', '算法', [['SHA-256', 'SHA-256'], ['SHA-512', 'SHA-512']]), text('key', 'HMAC 密钥', '', '仅用于 HMAC，不保存在偏好设置中'), select('output', '输出格式', [['hex', '十六进制'], ['base64', 'Base64']])],
    actions: actions(['hash', '计算摘要'], ['hmac', '计算 HMAC']), defaultAction: 'hash', extension: 'txt', supportsBatch: true },
  { id: 'jwt', name: 'JWT 解析', description: '查看 Header、Payload 与声明时间；不验证签名。', category: 'developer', icon: 'key', keywords: ['jwt', 'token', '令牌'], sampleInput: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJqb2pvIiwibmFtZSI6Ikpvam8iLCJpYXQiOjE3NjM2ODA4MDB9.demo',
    options: [], actions: actions(['decode', '解析 JWT']), defaultAction: 'decode', extension: 'json', supportsBatch: true },
  { id: 'sql', name: 'SQL 格式化', description: '多种 SQL 方言格式化，仅处理文本，不连接数据库。', category: 'developer', icon: 'database', keywords: ['sql', 'mysql', 'postgresql', '格式化'], sampleInput: "select id,name,count(*) as total from users where active=1 group by id,name order by total desc;",
    options: [select('dialect', 'SQL 方言', [['mysql', 'MySQL'], ['postgresql', 'PostgreSQL'], ['sqlite', 'SQLite'], ['sql', '标准 SQL'], ['tsql', 'SQL Server']]), select('keywordCase', '关键字大小写', [['upper', '大写'], ['lower', '小写'], ['preserve', '保留']]), number('indent', '缩进', 2, 1, 8)], actions: actions(['format', '格式化 SQL']), defaultAction: 'format', extension: 'sql', supportsBatch: true },
  { id: 'sql-in', name: 'SQL IN 生成', description: '多行生成 IN 条件，字符串单引号自动转义。', category: 'developer', icon: 'list', keywords: ['sql', 'in', '条件', '列表'], sampleInput: "Jojo\nO'Brien\nAlice",
    options: [text('column', '字段名', 'name'), select('valueType', '值类型', [['string', '字符串'], ['number', '数字']]), select('dialect', '字符串转义', [['mysql', 'MySQL（转义反斜杠）'], ['standard', '标准 SQL / PostgreSQL / SQLite']]), check('dedupe', '去重'), check('not', 'NOT IN', false)], actions: actions(['generate', '生成 IN 条件']), defaultAction: 'generate', extension: 'sql', supportsBatch: true },
  { id: 'regex', name: '正则表达式', description: '匹配位置、捕获组与替换，任务可手动停止。', category: 'developer', icon: 'regex', keywords: ['regex', 'regexp', '正则', '匹配'], sampleInput: 'Contact: jojo@example.com\nSupport: hello@my-tools.dev',
    options: [text('pattern', '表达式', '(?<user>[\\w.+-]+)@(?<domain>[\\w.-]+\\.[A-Za-z]{2,})'), text('flags', '标志', 'g', '支持 g i m s u y d；不含两侧 /'), text('replacement', '替换内容', '$<user>@example.org')], actions: actions(['match', '查找匹配'], ['replace', '替换']), defaultAction: 'match', extension: 'json', supportsBatch: true },
  { id: 'text-diff', name: '文本对比', description: '按行或单词比较两段内容，高亮新增与删除。', category: 'text', icon: 'diff', keywords: ['diff', '文本', '对比', '差异'], inputLabel: '原始文本', secondaryInputLabel: '修改后文本', sampleInput: 'My Tools\nLocal first\nMade for daily work', sampleSecondaryInput: 'My Tools\nOffline first\nMade for daily work\nBuilt for you',
    options: [select('mode', '对比粒度', [['lines', '按行'], ['words', '按单词']]), check('ignoreWhitespace', '忽略行首尾空白', false)], actions: actions(['compare', '对比']), defaultAction: 'compare', extension: 'diff' },
  { id: 'json-diff', name: 'JSON 对比', description: '按字段比较结构差异，忽略对象键名顺序。', category: 'data', icon: 'git-compare', keywords: ['json', 'diff', '对比', '结构'], inputLabel: '原始 JSON', secondaryInputLabel: '修改后 JSON', sampleInput: '{"name":"My Tools","version":1,"enabled":true}', sampleSecondaryInput: '{"enabled":true,"name":"My Tools","version":2,"theme":"dark"}', options: [], actions: actions(['compare', '对比 JSON']), defaultAction: 'compare', extension: 'json' },
  { id: 'convert', name: 'JSON · YAML · CSV', description: '本地转换数据格式；CSV 默认保留所有字段为字符串。', category: 'data', icon: 'arrows', keywords: ['json', 'yaml', 'csv', '转换'], sampleInput: '[{"name":"Jojo","role":"developer"},{"name":"My Tools","role":"assistant"}]',
    options: [select('from', '输入格式', [['json', 'JSON'], ['yaml', 'YAML'], ['csv', 'CSV']]), select('to', '输出格式', [['yaml', 'YAML'], ['json', 'JSON'], ['csv', 'CSV']]), check('csvHeader', 'CSV 首行为列名'), check('escapeFormulae', 'CSV 防止电子表格公式执行')], actions: actions(['convert', '转换']), defaultAction: 'convert', extension: 'txt', supportsBatch: true },
  { id: 'phone', name: '国际手机号校验', description: '覆盖国际号码规划中的国家与地区，校验、区分号码类型并转换 E.164。', category: 'developer', icon: 'phone', keywords: ['phone', 'mobile', 'e164', '手机号', '电话', '区号', '国家', '号码校验'],
    inputLabel: '手机号 / 电话号码（每行一个）', sampleInput: '13800138000',
    options: [select('country', '国家 / 地区与区号', phoneCountries.map(c => [c.code, c.name + ' ' + c.dial]), 'CN')],
    actions: actions(['validate', '校验号码']), defaultAction: 'validate', extension: 'json', supportsBatch: true },
  { id: 'svga', name: 'SVGA 动画预览', description: '本地打开 SVGA 文件，离线播放、暂停、逐帧预览和查看动画属性。', category: 'developer', icon: 'film', keywords: ['svga', 'animation', '动画', '预览', '本地文件'],
    sampleInput: '', options: [], actions: actions(['preview', '预览']), defaultAction: 'preview', extension: 'svga' },
  { id: 'aes', name: 'AES 加解密', description: '简单模式认证加密；高级模式支持 GCM/CBC 和 Java ECB/PKCS5Padding 兼容。', category: 'crypto', icon: 'lock', keywords: ['aes', 'gcm', 'cbc', 'ecb', 'java', 'pkcs5padding', 'pkcs7', 'key', 'iv', '加密', '解密', '口令', '密文'], sampleInput: '你好，My Tools 👋\n需要加密的私密文字',
    options: [
      select('profile', 'AES 工作模式', [['simple', '简单模式 · 随机盐 / IV'], ['advanced', '高级模式 · 原始 Key / IV']]),
      text('prefix', '密文前缀', '', '加密后原样拼接；解密前精确匹配并移除一次，留空不处理'),
      text('password', '加密口令', '', '至少 8 字符；参数自动保存在本机'),
      select('cipherMode', '加密模式', [['GCM', 'GCM（推荐，认证加密）'], ['CBC', 'CBC（兼容旧系统，不认证）'], ['ECB', 'ECB（Java 旧系统兼容，无 IV）']]),
      select('keySize', '密钥长度', [['256', 'AES-256'], ['192', 'AES-192'], ['128', 'AES-128']]),
      select('keyEncoding', 'Key 编码', [['hex', 'Hex'], ['utf8', 'UTF-8'], ['base64', 'Base64']]),
      text('rawKey', '原始 Key', '', '高级模式：必须与密钥位数精确匹配（128/192/256 bit），不做密码派生'),
      select('ivEncoding', 'IV 编码', [['hex', 'Hex'], ['utf8', 'UTF-8'], ['base64', 'Base64']]),
      text('iv', 'IV / Nonce', '', '高级模式：GCM 为 12 字节，CBC 为 16 字节，可点下方按钮生成'),
      select('dataEncoding', '明文编码', [['utf8', 'UTF-8 文本'], ['hex', 'Hex 字节'], ['base64', 'Base64 字节']]),
      select('cipherEncoding', '密文编码', [['base64', 'Base64'], ['hex', 'Hex']]),
      select('padding', 'CBC / ECB Padding', [['pkcs7', 'PKCS7（Java PKCS5Padding）'], ['none', 'NoPadding（必须按 16 字节对齐）']]),
      select('tagLength', 'GCM Tag 长度', [['128', '128 bit（推荐）'], ['120', '120 bit'], ['112', '112 bit'], ['104', '104 bit'], ['96', '96 bit']]),
      select('tagFormat', 'GCM Tag 格式', [['appended', '附在密文末尾（Java doFinal）'], ['detached', '独立字段 JSON（Node.js）']]),
      text('aad', 'GCM AAD（可选）', '', '关联认证数据，解密时必须完全一致；不加密 AAD'),
      select('aadEncoding', 'AAD 编码', [['utf8', 'UTF-8'], ['hex', 'Hex'], ['base64', 'Base64']]),
    ],
    actions: actions(['encrypt', '加密'], ['decrypt', '解密']), defaultAction: 'encrypt', extension: 'txt' },
  { id: 'password', name: '强密码生成器', description: '使用系统安全随机数，确保覆盖选中的字符类型。', category: 'crypto', icon: 'shield', keywords: ['password', 'generator', '强密码', '安全', '随机'], sampleInput: '',
    options: [number('length', '密码长度', 24, 12, 128), number('count', '生成数量', 1, 1, 50), check('lowercase', '小写字母'), check('uppercase', '大写字母'), check('digits', '数字'), check('symbols', '特殊符号'), check('excludeSimilar', '排除易混淆字符 O/0/I/l/1')],
    actions: actions(['generate', '生成密码']), defaultAction: 'generate', extension: 'txt' },
  { id: 'curl', name: 'cURL 解析', description: '将 cURL 请求整理为结构化数据；不发起网络请求。', category: 'developer', icon: 'terminal', keywords: ['curl', 'http', '请求', 'header'], sampleInput: "curl 'https://api.example.com/users?page=1' -H 'Accept: application/json' -H 'Authorization: Bearer example-token' --data-raw '{\"name\":\"Jojo\"}'",
    options: [], actions: actions(['parse', '解析请求']), defaultAction: 'parse', extension: 'json', supportsBatch: true },
  ...cryptoTools,
];

export function getTool(id: string): ToolDefinition | undefined { return tools.find(tool => tool.id === id); }
export function defaultOptions(tool: ToolDefinition): Record<string, OptionValue> {
  return Object.fromEntries(tool.options.map(option => [option.key, option.defaultValue]));
}
