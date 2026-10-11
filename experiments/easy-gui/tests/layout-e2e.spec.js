import {test,expect} from '@playwright/test';

const root=page=>page.locator('.preview .render-root > .design-node');
async function blank(page){
  await page.goto('/');
  await page.locator('.template-picker .ant-select').click();
  await page.getByText('빈 화면',{exact:true}).last().click();
  await page.locator('.app-brand').click();
}
async function json(page){
  await page.getByRole('button',{name:'json',exact:true}).click();
  return JSON.parse(await page.locator('.bottom textarea').inputValue());
}
test('clicking Toolbox enters placement mode; placement at exact canvas location',async({page},testInfo)=>{
  await blank(page);
  await page.getByRole('button',{name:/TextField/}).click();
  await expect(page.getByRole('status')).toContainText('배치 모드');
  await expect(page.locator('.preview input')).toHaveCount(0);
  await page.locator('.preview [data-node-id="startText"]').click({position:{x:8,y:3}});
  await expect(page.locator('.preview input')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(0);
  const doc=await json(page);
  expect(doc.root.children[1].type).toBe('TextField');
  await page.screenshot({path:testInfo.outputPath('click-to-place.png'),fullPage:true});
});
test('escape cancels placement without mutating canvas',async({page})=>{
  await blank(page);
  await page.getByRole('button',{name:/Button/}).first().click();
  await expect(page.getByRole('status')).toContainText('배치 모드');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status')).toHaveCount(0);
  const doc=await json(page);
  expect(doc.root.children).toHaveLength(2);
});
test('native drag from Toolbox inserts a control adjacent to its target',async({page})=>{
  await blank(page);
  const drag=page.getByRole('button',{name:/NumberField/});
  const target=page.locator('.preview [data-node-id="startHeading"]');
  await drag.dragTo(target,{targetPosition:{x:10,y:25}});
  await expect(page.locator('.preview .ant-input-number')).toHaveCount(1);
  const doc=await json(page);
  expect(doc.root.children.map(n=>n.type)).toContain('NumberField');
});
test('canvas move handle reorders an existing control',async({page})=>{
  await blank(page);
  await page.locator('.preview [data-node-id="startText"]').click();
  const handle=page.getByRole('button',{name:'선택 요소 이동'});
  const target=page.locator('.preview [data-node-id="startHeading"]');
  await handle.dragTo(target,{targetPosition:{x:8,y:4}});
  const doc=await json(page);
  expect(doc.root.children[0].id).toBe('startText');
});
test('Grid child can span multiple columns and keyboard resize stays responsive',async({page},testInfo)=>{
  await page.goto('/');
  await page.locator('.preview [data-node-id="metricOne"]').click();
  await expect(page.getByRole('combobox',{name:'Grid 너비'})).toBeVisible();
  await page.locator('.layout-controls .ant-select').last().click();
  await page.getByText('2칸',{exact:true}).last().click();
  await expect(page.locator('.preview [data-node-id="metricOne"]')).toHaveAttribute('data-grid-span','2');
  const handle=page.getByRole('button',{name:'Grid 열 너비 조절'});
  await handle.focus();
  await handle.press('ArrowRight');
  await expect(page.locator('.preview [data-node-id="metricOne"]')).toHaveAttribute('data-grid-span','3');
  await page.getByRole('button',{name:'모바일 보기'}).click();
  await expect(page.locator('.preview [data-node-id="metricOne"]')).toHaveAttribute('data-grid-span','1');
  await page.screenshot({path:testInfo.outputPath('grid-span-responsive.png'),fullPage:true});
});
test('selected control supports Hug Fill and Fixed sizing',async({page})=>{
  await blank(page);
  await page.locator('.preview [data-node-id="startText"]').click();
  await page.locator('.layout-controls .ant-select').first().click();
  await page.getByText('Fixed · 고정 너비',{exact:true}).last().click();
  await expect(page.getByRole('spinbutton',{name:'고정 너비(px)'})).toBeVisible();
  const doc=await json(page);
  expect(doc.root.children[1].sizing).toEqual({mode:'fixed',px:320});
});

test('FreeCanvas opt-in allows position-specific placement and x/y Inspector edits',async({page},testInfo)=>{
  await blank(page);
  await page.getByRole('button',{name:/FreeCanvas/}).click();
  await root(page).click({position:{x:8,y:8}});
  await expect(page.locator('.easy-free-canvas')).toHaveCount(1);
  await page.getByRole('button',{name:/Tag/}).dragTo(page.locator('.easy-free-canvas'),
    {targetPosition:{x:150,y:120}});
  const positioned=page.locator('.easy-free-canvas > .design-node').first();
  await expect(positioned).toBeVisible();
  await positioned.click();
  await expect(page.getByRole('spinbutton',{name:'자유 배치 x'})).toBeVisible();
  await page.getByRole('spinbutton',{name:'자유 배치 x'}).fill('180');
  await expect(positioned).toHaveCSS('left','180px');
  await page.screenshot({path:testInfo.outputPath('free-canvas.png'),fullPage:true});
  const doc=await json(page);
  const free=doc.root.children.find(n=>n.type==='FreeCanvas');
  expect(free.children[0].placement.free.x).toBe(180);
});
test('FreeCanvas handle moves a selected element without changing its layout parent',async({page})=>{
  await blank(page);
  await page.getByRole('button',{name:/FreeCanvas/}).click();
  await root(page).click({position:{x:8,y:8}});
  await page.getByRole('button',{name:/Text/}).first().dragTo(page.locator('.easy-free-canvas'),
    {targetPosition:{x:130,y:100}});
  const floating=page.locator('.easy-free-canvas > .design-node').first();
  await floating.click();
  const before=Number.parseFloat(await floating.evaluate(el=>getComputedStyle(el).left));
  const handle=page.getByRole('button',{name:'선택 요소 이동'});
  const b=await handle.boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);
  await page.mouse.down();
  await page.mouse.move(b.x+b.width/2+75,b.y+b.height/2+20,{steps:6});
  await page.mouse.up();
  const after=Number.parseFloat(await floating.evaluate(el=>getComputedStyle(el).left));
  expect(after).toBeGreaterThan(before);
});
