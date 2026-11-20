import { describe, expect, it } from 'vitest';
import { executeTool } from '../src/core/engine';
import { defaultOptions, getTool, tools } from '../src/core/catalog';
import { decodeBase64Bytes, encodeBase64Bytes } from '../src/core/encoding';
import type { OptionValue } from '../src/core/types';

function run(toolId: string, input: string, action?: string, options: Record<string, OptionValue> = {}, secondaryInput?: string) {
  const tool = getTool(toolId)!;
  return executeTool({ toolId, input, action: action ?? tool.defaultAction, options: { ...defaultOptions(tool), ...options }, secondaryInput });
}

describe('catalog and input guards', () => {
  it('every catalogue sample produces a usable result', async () => {
    expect(new Set(tools.map(tool => tool.id)).size).toBe(tools.length);
    for (const tool of tools) {
      const result = await run(tool.id, tool.sampleInput, tool.defaultAction, {}, tool.sampleSecondaryInput);
      expect(typeof result.output, tool.id).toBe('string');
      expect(result.output.length, tool.id).toBeGreaterThan(0);
    }
  });
  it('rejects unsupported tools and actions', async () => {
    await expect(executeTool({ toolId: 'not-found', action: 'run', input: '', options: {} })).rejects.toThrow('未找到');
    await expect(run('json', '{}', 'execute')).rejects.toThrow('不支持');
  });
  it('rejects oversized UTF-8 input and malformed options', async () => {
    await expect(run('text', '中'.repeat(3 * 1024 * 1024))).rejects.toThrow('8 MiB');
    await expect(run('uuid', '', 'uuid', { count: -1 })).rejects.toThrow('范围');
    await expect(run('base64', 'ok', 'encode', { urlSafe: 'true' })).rejects.toThrow('布尔');
    await expect(run('url', 'hello', 'encode', { mode: 'wrong' })).rejects.toThrow('无效');
  });
  it('rejects output amplification before allocating huge strings or CSV matrices', async () => {
    const long = 'x'.repeat(20000);
    await expect(run('string-join', 'a\n'.repeat(1000), 'join', { prefix: long })).rejects.toThrow('16 MiB');
    await expect(run('text', 'a'.repeat(1000), 'replace', { find: 'a', replace: long })).rejects.toThrow('16 MiB');
    await expect(run('regex', 'a'.repeat(1000), 'replace', { pattern: 'a', flags: 'g', replacement: long })).rejects.toThrow('16 MiB');
    const sparse = JSON.stringify(Array.from({ length: 1500 }, (_, index) => ({ [`key${index}`]: index })));
    await expect(run('convert', sparse, 'convert', { from: 'json', to: 'csv' })).rejects.toThrow('单元格');
  });
});

describe('JSON without precision loss', () => {
  it('preserves integers and decimal/exponent text beyond IEEE-754 precision', async () => {
    const input = '{"id":900719925474099312345,"decimal":1.234567890123456789,"huge":1e999}';
    expect((await run('json', input, 'minify')).output).toBe(input);
    const formatted = (await run('json', input)).output;
    expect(formatted).toContain('900719925474099312345');
    expect(formatted).toContain('1.234567890123456789');
  });
  it('rejects trailing commas and duplicate keys', async () => {
    await expect(run('json', '{"a":1,}')).rejects.toThrow('JSON');
    await expect(run('json', '{"a":1,"a":2}')).rejects.toThrow('JSON');
  });
  it('sorts keys recursively without changing array order', async () => {
    expect((await run('json', '{"z":1,"a":[{"b":2,"a":1},3]}', 'sort')).output).toBe('{\n  "a": [\n    {\n      "a": 1,\n      "b": 2\n    },\n    3\n  ],\n  "z": 1\n}');
  });
  it('round-trips arbitrary escaped text', async () => {
    const input = '你好\n"quotes" \\ tab\t';
    const encoded = (await run('json', input, 'escape')).output;
    expect((await run('json', encoded, 'unescape')).output).toBe(input);
    await expect(run('json', '{"a":1}', 'unescape')).rejects.toThrow('JSON 字符串');
  });
  it('resolves bracket and JSON Pointer paths safely', async () => {
    const input = '{"a.b":[{"x/y~":9007199254740993}]}';
    expect((await run('json', input, 'path', { path: '$["a.b"][0]["x/y~"]' })).output).toBe('9007199254740993');
    expect((await run('json', input, 'path', { path: '/a.b/0/x~1y~0' })).output).toBe('9007199254740993');
    await expect(run('json', '{}', 'path', { path: '$.constructor' })).rejects.toThrow('路径不存在');
    await expect(run('json', '{}', 'path', { path: '$.*' })).rejects.toThrow();
  });
  it('preserves dangerous-looking property names without prototype pollution', async () => {
    const input = '{"__proto__":{"polluted":true},"constructor":{"prototype":1}}';
    const result = (await run('json', input, 'sort')).output;
    expect(result).toContain('"__proto__"');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((await run('json', input, 'path', { path: '/__proto__/polluted' })).output).toBe('true');
  });
  it('tree overview exposes types and children', async () => {
    const output = (await run('json', '{"a":[true,null]}', 'tree')).output;
    expect(output).toContain('Object(1)');
    expect(output).toContain('Array(2)');
    expect(output).toContain('[1]  null');
  });
});

describe('text and encoding', () => {
  it('joins trimmed deduplicated lines with configurable wrapper and escapes', async () => {
    const output = (await run('string-join', ' a \r\nb\r\na\r\n', 'join', { dedupe: true, quote: 'single', prefix: 'id=', suffix: '!', separator: '\\n' })).output;
    expect(output).toBe("'id=a!'\n'id=b!'");
  });
  it('supports empty values when requested', async () => {
    expect((await run('string-join', 'a\n\nb', 'join', { skipEmpty: false, separator: '|' })).output).toBe('a||b');
  });
  it('deduplicates, natural-sorts, and performs literal replacements', async () => {
    expect((await run('text', 'a\n a \nb\n', 'dedupe')).output).toBe('a\nb');
    expect((await run('text', 'file10\nfile2', 'sort')).output).toBe('file2\nfile10');
    expect((await run('text', 'a.a.a', 'replace', { find: '.', replace: '$&' })).output).toBe('a$&a$&a');
  });
  it('HTML escape/unescape does not evaluate markup', async () => {
    const input = '<script x="a&b">\'text\'</script>';
    const escaped = (await run('text', input, 'html-escape')).output;
    expect(escaped).not.toContain('<script');
    expect((await run('text', escaped, 'html-unescape')).output).toBe(input);
    expect((await run('text', '&#x1f44b;', 'html-unescape')).output).toBe('👋');
  });
  it('round-trips Chinese, emoji, NUL and BOM through UTF-8 Base64', async () => {
    const input = '\uFEFF你好 👋\0';
    const encoded = (await run('base64', input, 'encode')).output;
    expect((await run('base64', encoded, 'decode')).output).toBe(input);
  });
  it('supports URL-safe bytes and unpadded decoding', async () => {
    expect(encodeBase64Bytes(new Uint8Array([251, 255]), true, false)).toBe('-_8');
    expect([...decodeBase64Bytes('-_8', true)]).toEqual([251, 255]);
    expect((await run('base64', 'Zg', 'decode')).output).toBe('f');
  });
  it('rejects corrupt Base64, illegal padding bits, and invalid UTF-8', async () => {
    for (const input of ['?', 'a', 'Zg=', 'Zh==', 'Zg===', 'Zg==garbage']) await expect(run('base64', input, 'decode')).rejects.toThrow('Base64');
    await expect(run('base64', '/w==', 'decode')).rejects.toThrow('UTF-8');
    expect((await run('base64', '/w==', 'decode', { outputEncoding: 'hex' })).output).toBe('ff');
  });
  it('can encode binary hex rather than treating it as text', async () => {
    expect((await run('base64', '48 65 6c 6c 6f', 'encode', { inputEncoding: 'hex' })).output).toBe('SGVsbG8=');
    await expect(run('base64', 'abc', 'encode', { inputEncoding: 'hex' })).rejects.toThrow('完整的字节');
  });
  it('preserves duplicate URL parameters and guards prototype keys', async () => {
    const result = JSON.parse((await run('url', 'https://example.com/?tag=a&tag=b&__proto__=safe', 'parse')).output);
    expect(result.query.tag).toEqual(['a', 'b']);
    expect(result.query.__proto__).toEqual(['safe']);
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
  });
  it('builds and decodes query parameters explicitly', async () => {
    expect((await run('url', '{"q":"a b","tag":["a","b"]}', 'build')).output).toBe('q=a+b&tag=a&tag=b');
    expect((await run('url', 'a+b%2Bc', 'decode', { form: true })).output).toBe('a b+c');
    await expect(run('url', '%FF', 'decode')).rejects.toThrow('无效');
  });
});

describe('developer tools', () => {
  it('handles epoch, pre-epoch and explicit timezone conversion', async () => {
    expect((await run('timestamp', '0', 'to-date', { unit: 'seconds', timezone: 'UTC' })).output).toContain('1970-01-01T00:00:00.000Z');
    expect((await run('timestamp', '-1', 'to-date', { unit: 'seconds' })).output).toContain('1969-12-31T23:59:59.000Z');
    expect((await run('timestamp', '1970-01-01T08:00:00+08:00', 'to-timestamp')).output).toContain('Unix 毫秒: 0');
  });
  it('rejects nonexistent calendar dates and ambiguous local timestamps', async () => {
    await expect(run('timestamp', '2025-02-29', 'to-timestamp')).rejects.toThrow('日期不存在');
    await expect(run('timestamp', '2026-11-20T12:00:00', 'to-timestamp')).rejects.toThrow('带时区');
    expect((await run('timestamp', '2024-02-29', 'to-timestamp')).output).toContain('2024-02-29T00:00:00.000Z');
  });
  it('produces UUID v4 with RFC variant bits and configurable output', async () => {
    const rows = (await run('uuid', '', 'uuid', { count: 10 })).output.split('\n');
    expect(new Set(rows).size).toBe(10);
    rows.forEach(row => expect(row).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/));
    expect((await run('uuid', '', 'uuid', { count: 1, hyphens: false, uppercase: true })).output).toMatch(/^[0-9A-F]{32}$/);
  });
  it('random output respects requested alphabet and length', async () => {
    const output = (await run('uuid', '', 'random', { count: 2, length: 37, alphabet: 'hex' })).output;
    output.split('\n').forEach(row => expect(row).toMatch(/^[a-f0-9]{37}$/));
  });
  it('matches known SHA-256, SHA-512 and HMAC vectors', async () => {
    expect((await run('hash', 'abc')).output).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect((await run('hash', 'abc', 'hash', { algorithm: 'SHA-512' })).output).toBe('ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
    expect((await run('hash', 'The quick brown fox jumps over the lazy dog', 'hmac', { key: 'key' })).output).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    await expect(run('hash', 'abc', 'hmac')).rejects.toThrow('密钥');
  });
  it('JWT reports unverified status and preserves claim data', async () => {
    const token = getTool('jwt')!.sampleInput;
    const result = await run('jwt', `Bearer ${token}`);
    const decoded = JSON.parse(result.output);
    expect(decoded.verified).toBe(false);
    expect(decoded.payload.sub).toBe('jojo');
    expect(result.warnings?.[0]).toContain('未进行任何签名验证');
    await expect(run('jwt', 'bad.token')).rejects.toThrow('三段');
  });
  it('formats SQL while preserving quoted text', async () => {
    const output = (await run('sql', "select 'from where' as label from users where id=1;")).output;
    expect(output).toContain('SELECT');
    expect(output).toContain("'from where'");
  });
  it('SQL IN escapes strings and preserves large numeric text', async () => {
    expect((await run('sql-in', "O'Brien\nAlice")).output).toBe("name IN ('O''Brien', 'Alice')");
    expect((await run('sql-in', "a\\'b", 'generate')).output).toBe("name IN ('a\\\\''b')");
    expect((await run('sql-in', '9007199254740993123\n2', 'generate', { valueType: 'number', column: 'user.id', not: true })).output).toBe('user.id NOT IN (9007199254740993123, 2)');
  });
  it('SQL IN rejects injected identifiers, nonnumeric values and empty lists', async () => {
    await expect(run('sql-in', '1', 'generate', { column: 'id); DROP TABLE x;--' })).rejects.toThrow('字段名');
    await expect(run('sql-in', '1); DROP TABLE x;--', 'generate', { valueType: 'number' })).rejects.toThrow('数值');
    await expect(run('sql-in', '\n  ')).rejects.toThrow('至少一个');
  });
  it('regex returns captures, named groups and positions', async () => {
    const output = JSON.parse((await run('regex', 'ab12 cd34', 'match', { pattern: '(?<name>[a-z]+)(\\d+)', flags: 'g' })).output);
    expect(output[1].index).toBe(5);
    expect(output[1].groups.name).toBe('cd');
    expect(output[1].captures).toEqual(['cd', '34']);
  });
  it('regex handles empty Unicode matches without an infinite loop', async () => {
    const output = JSON.parse((await run('regex', '👋', 'match', { pattern: '(?:)', flags: 'gu' })).output);
    expect(output.map((row: { index: number }) => row.index)).toEqual([0, 2]);
    expect((await run('regex', 'a1 b2', 'replace', { pattern: '(\\w)(\\d)', flags: 'g', replacement: '$2-$1' })).output).toBe('1-a 2-b');
  });
  it('bounded regex replacement retains standard JavaScript replacement tokens', async () => {
    const input = 'abcd';
    const replacement = "$$|$&|$`|$'|$0|$01|$10|$2|$<first>|$<missing>";
    const pattern = '(?<first>b)(c)?';
    const result = await run('regex', input, 'replace', { pattern, flags: 'g', replacement });
    expect(result.output).toBe(input.replace(new RegExp(pattern, 'g'), replacement));
  });
  it('regex rejects invalid patterns, flags and overly large input', async () => {
    await expect(run('regex', 'test', 'match', { pattern: '[' })).rejects.toThrow('无效');
    await expect(run('regex', 'test', 'match', { flags: 'gg' })).rejects.toThrow('不重复');
    await expect(run('regex', 'x'.repeat(262145))).rejects.toThrow('256 KiB');
  });
});

describe('diff and conversion', () => {
  it('text diff exposes structured add/remove fragments', async () => {
    const result = await run('text-diff', 'a\nb\n', 'compare', {}, 'a\nc\n');
    expect(result.diff).toContainEqual({ type: 'remove', text: 'b\n' });
    expect(result.diff).toContainEqual({ type: 'add', text: 'c\n' });
    expect(result.summary).toContain('新增 1 行');
  });
  it('JSON comparison ignores object order and equal number representations', async () => {
    const result = await run('json-diff', '{"a":1,"b":1e2,"c":-0}', 'compare', {}, '{"c":0,"b":100.0,"a":1.0}');
    expect(result.output).toBe('[]');
  });
  it('JSON comparison describes array changes and escaped paths', async () => {
    const result = JSON.parse((await run('json-diff', '{"x/y":[1,2]}', 'compare', {}, '{"x/y":[1,3,4]}')).output);
    expect(result[0]).toEqual({ path: '/x~1y/1', type: 'changed', before: 2, after: 3 });
    expect(result[1]).toEqual({ path: '/x~1y/2', type: 'added', after: 4 });
  });
  it('JSON comparison preserves huge differing integers', async () => {
    const output = (await run('json-diff', '9007199254740993', 'compare', {}, '9007199254740992')).output;
    expect(output).toContain('9007199254740993');
    expect(output).toContain('9007199254740992');
  });
  it('round-trips JSON to YAML with large integers and decimal precision', async () => {
    const input = '{"id":90071992547409931234,"value":1.234567890123456789}';
    const yaml = (await run('convert', input)).output;
    expect(yaml).toContain('90071992547409931234');
    expect(yaml).toContain('1.234567890123456789');
    const json = (await run('convert', yaml, 'convert', { from: 'yaml', to: 'json' })).output;
    expect(json).toContain('90071992547409931234');
    expect(json).toContain('1.234567890123456789');
  });
  it('YAML rejects duplicate keys, unsafe cycles and nonfinite numbers', async () => {
    await expect(run('convert', 'a: 1\na: 2', 'convert', { from: 'yaml', to: 'json' })).rejects.toThrow('YAML');
    await expect(run('convert', 'a: &a\n  b: *a', 'convert', { from: 'yaml', to: 'json' })).rejects.toThrow('循环');
    await expect(run('convert', 'a: .inf', 'convert', { from: 'yaml', to: 'json' })).rejects.toThrow('Infinity');
  });
  it('CSV reads quoted commas, newlines and leading-zero values unchanged', async () => {
    const input = 'id,name,notes\r\n001,"Jojo, Lee","line1\nline2"\r\n';
    const result = JSON.parse((await run('convert', input, 'convert', { from: 'csv', to: 'json' })).output);
    expect(result).toEqual([{ id: '001', name: 'Jojo, Lee', notes: 'line1\nline2' }]);
  });
  it('CSV rejects duplicate headers and row width mismatch', async () => {
    await expect(run('convert', 'a,a\n1,2', 'convert', { from: 'csv', to: 'json' })).rejects.toThrow('重复列名');
    await expect(run('convert', 'a,b\n1,2,3', 'convert', { from: 'csv', to: 'json' })).rejects.toThrow('3 列');
  });
  it('CSV preserves prototype-looking keys and guards spreadsheet formulas', async () => {
    const result = JSON.parse((await run('convert', '__proto__,constructor\nhello,world', 'convert', { from: 'csv', to: 'json' })).output);
    expect(Object.hasOwn(result[0], '__proto__')).toBe(true);
    const output = (await run('convert', '[{"x":"=SUM(A1)","y":"safe"}]', 'convert', { from: 'json', to: 'csv' })).output;
    expect(output).toContain("'=SUM(A1)");
  });
});

describe('cURL parser never executes input', () => {
  it('parses repeated headers and body without losing the original', async () => {
    const input = "curl 'https://example.com/?a=1&a=2' -H 'X-A: 1' -H 'X-A: 2' --data-raw '{\"name\":\"Jojo\"}'";
    const parsed = JSON.parse((await run('curl', input)).output);
    expect(parsed.method).toBe('POST');
    expect(parsed.headers).toHaveLength(2);
    expect(parsed.query).toHaveLength(2);
    expect(parsed.body[0].value).toBe('{"name":"Jojo"}');
    expect(parsed.sendsRequest).toBe(false);
  });
  it('supports line continuation, joined flags and long equals flags', async () => {
    const input = "curl \\\n'https://example.com' -XPUT --header='Content-Type: text/plain' -dhello";
    const parsed = JSON.parse((await run('curl', input)).output);
    expect(parsed.method).toBe('PUT');
    expect(parsed.body[0].value).toBe('hello');
  });
  it('keeps @file as a string and supplies --json implied headers', async () => {
    const result = await run('curl', "curl https://example.com --json @private.json");
    const parsed = JSON.parse(result.output);
    expect(parsed.body[0].value).toBe('@private.json');
    expect(parsed.headers).toContainEqual({ name: 'Content-Type', value: 'application/json' });
    expect(result.warnings?.[0]).toContain('不会读取');
  });
  it('rejects shell substitution, pipes, unsupported options and file URLs', async () => {
    for (const input of ["curl https://example.com | sh", "curl \"$(whoami)\"", 'curl file:///etc/passwd', 'curl https://example.com --mystery x']) await expect(run('curl', input)).rejects.toThrow();
    await expect(run('curl', "curl 'https://example.com")).rejects.toThrow('引号未闭合');
  });
});
