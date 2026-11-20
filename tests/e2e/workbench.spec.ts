import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function tool(page: Page, id: string) {
  await page.goto(`/#/tools/${id}`);
  await expect(page.locator('h1')).toBeVisible();
}
async function process(page: Page) {
  await page.keyboard.press('Control+Enter');
}
const output = (page: Page) => page.getByRole('textbox', { name: '处理结果', exact: true });

test('JSON keeps exact integers and gives a recoverable validation error', async ({ page }, info) => {
  await tool(page, 'json');
  await expect(output(page)).toHaveValue(/My Tools/);
  await page.screenshot({ path: info.outputPath('workbench.png'), fullPage: true });
  await page.getByRole('textbox', { name: 'JSON 输入', exact: true }).fill('{"id":900719925474099312345,"name":"Jojo"}');
  await process(page);
  await expect(output(page)).toHaveValue('{\n  "id": 900719925474099312345,\n  "name": "Jojo"\n}');
  await page.getByRole('button', { name: '树形', exact: true }).click();
  await expect(page.locator('.tree-view')).toContainText('900719925474099312345');
  await page.getByRole('textbox', { name: 'JSON 输入', exact: true }).fill('{broken');
  await process(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('textbox', { name: 'JSON 输入', exact: true }).fill('{"ok":true}');
  await process(page);
  await expect(output(page)).toHaveValue('{\n  "ok": true\n}');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('string join applies options and removes repeated/empty rows', async ({ page }) => {
  await tool(page, 'string-join');
  await page.getByRole('textbox', { name: '输入内容', exact: true }).fill(' apple \nbanana\n\napple');
  await page.getByLabel('去重', { exact: true }).check();
  await page.getByLabel('包裹字符', { exact: true }).selectOption('double');
  await page.getByLabel('分隔符', { exact: true }).fill(',');
  await process(page);
  await expect(output(page)).toHaveValue('"apple","banana"');
});

test('UTF-8 Base64 roundtrips Chinese and emoji', async ({ page }) => {
  await tool(page, 'base64');
  const original = '你好，Jojo 👋';
  await page.getByRole('textbox', { name: '输入内容', exact: true }).fill(original);
  await process(page);
  await expect(output(page)).toHaveValue(Buffer.from(original).toString('base64'));
  await page.getByRole('button', { name: '交换', exact: true }).click();
  await page.getByRole('button', { name: '解码', exact: true }).click();
  await process(page);
  await expect(output(page)).toHaveValue(original);
});

test('binary files roundtrip through Base64 without UTF-8 corruption', async ({ page }) => {
  await tool(page, 'base64');
  const bytes = Buffer.from([0, 255, 128, 65, 13, 10, 240, 159, 145, 139]);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '文件 → Base64', exact: true }).click();
  await (await chooser).setFiles({ name: 'binary-test.bin', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(output(page)).toHaveValue(bytes.toString('base64'));
  await page.getByRole('textbox', { name: '输入内容', exact: true }).fill(bytes.toString('base64'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '输入 Base64 → 文件', exact: true }).click();
  const downloaded = await download;
  const path = await downloaded.path();
  expect(await readFile(path!)).toEqual(bytes);
});

test('tool search keyboard navigation and independent launcher use actual routes', async ({ page }, info) => {
  await tool(page, 'json');
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: '搜索工具', exact: true }).fill('时间戳');
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toHaveText('时间戳转换');
  await expect(page).toHaveURL(/tools\/timestamp/);
  await page.goto('/?window=launcher');
  await page.getByRole('textbox', { name: '搜索工具', exact: true }).fill('Base64');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('launcher.png') });
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toHaveText('Base64 编解码');
});

test('theme and favorites persist while payload and HMAC key never do', async ({ page }, info) => {
  await tool(page, 'hash');
  const secret = 'private-hmac-key-do-not-save-490817';
  const body = 'private-request-body-do-not-save-765130';
  await page.getByRole('textbox', { name: '输入内容', exact: true }).fill(body);
  await page.getByLabel('HMAC 密钥', { exact: true }).fill(secret);
  await page.getByRole('button', { name: '计算 HMAC', exact: true }).click();
  await process(page);
  await expect(output(page)).not.toHaveValue('');
  await page.getByRole('button', { name: '收藏工具', exact: true }).click();
  await page.getByRole('button', { name: '切换深浅主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: info.outputPath('dark-theme.png'), fullPage: true });
  const saved = await page.evaluate(() => JSON.stringify(localStorage));
  expect(saved).not.toContain(secret);
  expect(saved).not.toContain(body);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '输入内容', exact: true })).toHaveValue('');
  await expect(page.getByLabel('HMAC 密钥', { exact: true })).toHaveValue('');
});

test('catastrophic regex times out without freezing the interface, then recovers', async ({ page }) => {
  await tool(page, 'regex');
  await page.getByLabel('表达式', { exact: true }).fill('(a+)+$');
  await page.getByRole('textbox', { name: '输入内容', exact: true }).fill(`${'a'.repeat(50)}!`);
  await process(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alert')).toContainText('已中断', { timeout: 7000 });
  await page.getByLabel('表达式', { exact: true }).fill('a+');
  await process(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(output(page)).toHaveValue(/a{50}/);
});

test('text diff renders changes from both inputs', async ({ page }) => {
  await tool(page, 'text-diff');
  await page.getByRole('textbox', { name: '原始文本', exact: true }).fill('keep\nold\n');
  await page.getByRole('textbox', { name: '修改后文本', exact: true }).fill('keep\nnew\n');
  await process(page);
  await expect(page.locator('.diff-add')).toContainText('new');
  await expect(page.locator('.diff-remove')).toContainText('old');
});

test('batch conversion isolates a bad file and exports only successful output', async ({ page }) => {
  await tool(page, 'json');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '批量处理', exact: true }).click();
  await (await chooser).setFiles([
    { name: 'good.json', mimeType: 'application/json', buffer: Buffer.from('{"id":900719925474099312345}') },
    { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{broken') },
  ]);
  await page.getByRole('button', { name: '开始处理', exact: true }).click();
  await expect(page.locator('.batch-heading')).toContainText('1 成功 · 1 失败');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出成功结果', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('my-tools-results.zip');
});

test('cURL parsing causes no outgoing requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:1420/') && !request.url().startsWith('data:')) external.push(request.url());
  });
  await tool(page, 'curl');
  await page.getByRole('textbox', { name: '输入内容', exact: true }).fill("curl 'https://never-send.example/private' -H 'Authorization: Bearer secret-test' --data-raw '{\"name\":\"Jojo\"}'");
  await process(page);
  await expect(output(page)).toHaveValue(/never-send\.example/);
  expect(external).toEqual([]);
});


test('AES encrypts and decrypts locally without saving the passphrase', async ({ page }) => {
  await tool(page, 'aes');
  const passphrase = 'private-ui-passphrase-2026!';
  const original = '你好，桌面 AES 👋';
  await page.getByRole('textbox', { name: '输入内容', exact: true }).fill(original);
  const input = page.getByLabel('加密口令', { exact: true });
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill(passphrase);
  await process(page);
  await expect(output(page)).toHaveValue(/"algorithm": "AES-256-GCM"/);
  const envelope = await output(page).inputValue();
  const saved = await page.evaluate(() => JSON.stringify(localStorage));
  expect(saved).not.toContain(passphrase);
  expect(saved).not.toContain(original);
  await page.getByRole('textbox', { name: '输入内容', exact: true }).fill(envelope);
  await page.getByRole('button', { name: '解密', exact: true }).click();
  await process(page);
  await expect(output(page)).toHaveValue(original);
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(input).toHaveValue('');
});

test('strong password generator enforces selected categories', async ({ page }) => {
  await tool(page, 'password');
  await page.getByLabel('密码长度', { exact: true }).fill('32');
  await page.getByLabel('生成数量', { exact: true }).fill('3');
  await process(page);
  await expect(output(page)).not.toHaveValue('');
  const rows = (await output(page).inputValue()).split('\n');
  expect(rows).toHaveLength(3);
  for (const value of rows) {
    expect(value).toHaveLength(32);
    expect(value).toMatch(/[a-z]/);
    expect(value).toMatch(/[A-Z]/);
    expect(value).toMatch(/[2-9]/);
    expect(value).toMatch(/[^A-Za-z0-9]/);
    expect(value).not.toMatch(/[O0Il1|]/);
  }
});
