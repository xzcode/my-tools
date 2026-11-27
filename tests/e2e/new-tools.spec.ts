import { test, expect, type Page } from '@playwright/test';
import { legacySvga, modernSvga } from '../fixtures/svga';
const input=(page:Page,name='输入内容')=>page.getByRole('textbox',{name,exact:true});
const output=(page:Page)=>input(page,'处理结果');
async function open(page:Page,id:string){await page.goto('/#/tools/'+id);await expect(page.locator('h1')).toBeVisible();}
async function run(page:Page){await page.keyboard.press('Control+Enter');}
test('all-tool tabs and history restore, single delete and date cleanup',async({page})=>{
 await open(page,'string-join');
 await input(page).fill('first\nsecond');await expect(input(page)).toHaveValue('first\nsecond');await page.getByRole('button',{name:/^拼接 Ctrl/}).click();await expect(output(page)).toHaveValue('first, second');
 await page.getByRole('button',{name:'新建标签',exact:true}).click();
 await input(page).fill('other');await run(page);await expect(output(page)).toHaveValue('other');
 await page.getByRole('tab',{name:'字符串拼接 1',exact:true}).click();await expect(input(page)).toHaveValue('first\nsecond');
 await page.getByRole('button',{name:'关闭标签 字符串拼接 1',exact:true}).click();await expect(output(page)).toHaveValue('other');
 await page.getByRole('button',{name:'历史记录',exact:true}).click();
 await page.getByLabel('历史类型').selectOption('closed');
 await page.getByRole('button',{name:'恢复历史 字符串拼接 1',exact:true}).click();await expect(input(page)).toHaveValue('first\nsecond');
 await page.getByRole('button',{name:'历史记录',exact:true}).click();
 await page.getByRole('button',{name:'删除历史 字符串拼接 1',exact:true}).click();await expect(page.getByText('暂无符合条件的记录。')).toBeVisible();
 await page.getByLabel('历史类型').selectOption('all');
 await page.getByLabel('历史清理时间').selectOption('custom');
 const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
 await page.getByLabel('清理截止日期').fill(tomorrow);
 await page.getByRole('button',{name:/^清理 \d+ 条$/}).click();await page.getByRole('button',{name:'确认清理',exact:true}).click();
 await expect(page.getByText('暂无符合条件的记录。')).toBeVisible();await expect(input(page)).toHaveValue('first\nsecond');
 await page.locator('.aes-save-status').click();
 await page.getByLabel('工作台自动保存范围').selectOption('full');
 await page.getByRole('button',{name:'确认开启加密保存'}).click();
 await expect(page.locator('.aes-save-status')).toContainText('已保存');
 await page.getByRole('button',{name:'关闭标签 字符串拼接 1',exact:true}).click();
 await expect(page.locator('.aes-save-status')).toContainText('已保存');
 await page.reload();
 await page.getByRole('button',{name:/恢复关闭/}).click();
 await expect(input(page)).toHaveValue('first\nsecond');
});
test('international phone country flags, searchable dial codes and real validation',async({page})=>{
 await open(page,'phone');const country=page.getByRole('button',{name:'国家 / 地区与区号'});
 await expect(country).toContainText('+86');await expect(country.locator('.fi-cn')).toBeVisible();
 const number=input(page,'手机号 / 电话号码（每行一个）');await number.fill('13800138000');await run(page);
 await expect(output(page)).toHaveValue(/"e164": "\+8613800138000"/);
 await country.click();await page.getByLabel('搜索国家或区号').fill('+60');await page.getByRole('option',{name:/马来西亚/}).click();
 await expect(country.locator('.fi-my')).toBeVisible();await expect(country).toContainText('+60');
 await number.fill('0123456789');await run(page);await expect(output(page)).toHaveValue(/"e164": "\+60123456789"/);
});
for(const [version,fixture] of [['1.x',legacySvga],['2.x',modernSvga]] as const){
 test('local SVGA '+version+' renders real image pixels and frame controls',async({page})=>{
  await open(page,'svga');const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'打开 SVGA 文件'}).click();
  await (await chooser).setFiles({name:'fixture.svga',mimeType:'application/octet-stream',buffer:fixture()});
  const canvas=page.locator('canvas[aria-label="SVGA 动画画布"]');await expect(canvas).toBeVisible({timeout:15000});
  await expect(page.getByText('64 × 48 px',{exact:true})).toBeVisible();await expect(page.getByText('12 FPS',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'停止动画'}).click();
  const rgba=await canvas.evaluate(el=>Array.from((el as HTMLCanvasElement).getContext('2d')!.getImageData(0,0,1,1).data));expect(rgba).toEqual([255,0,0,255]);
  await page.getByRole('button',{name:'下一帧'}).click();await expect(page.locator('.frame-label')).toHaveText('2 / 2 帧');
 });
}
test('one hundred tabs can be opened, jumped to, saved and restored',async({page})=>{
 await open(page,'aes');
 // Use the same UI shortcut a desktop user uses, then verify the real tab bar.
 const add=page.getByRole('button',{name:'新建 AES 标签',exact:true});
 for(let n=1;n<100;n++) await page.keyboard.press('Control+t');
 const tabs=page.getByRole('tablist',{name:'工具标签页'}).getByRole('tab');
 await expect(tabs).toHaveCount(100);
 await expect(add).toBeDisabled();
 const jump=page.getByLabel('快速切换标签');
 await jump.selectOption({label:'AES 1'});
 await expect(tabs.first()).toHaveAttribute('aria-selected','true');
 await jump.selectOption({label:'AES 100'});
 await expect(tabs.last()).toHaveAttribute('aria-selected','true');
 await page.locator('.aes-save-status').click();
 await page.getByRole('button',{name:'立即保存',exact:true}).click();
 await expect(page.locator('.aes-save-status')).toContainText('已保存');
 await page.reload();
 await expect(tabs).toHaveCount(100);
 await expect(tabs.last()).toHaveAttribute('aria-selected','true');
 await expect(add).toBeDisabled();
});
