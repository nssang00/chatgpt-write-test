import {test,expect} from '@playwright/test';

test('studio opens with finished workspace, rich controls and a browser screenshot',async({page},testInfo)=>{
  await page.goto('/');
  await expect(page.getByText('Easy GUI Studio')).toBeVisible();
  await expect(page.getByText('사용자 관리',{exact:true}).first()).toBeVisible();
  await expect(page.getByText('배송지',{exact:true})).toBeVisible();
  await expect(page.getByText('청구지',{exact:true})).toBeVisible();
  await expect(page.locator('.easy-stat')).toHaveCount(3);
  await expect(page.locator('.ant-table')).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath('studio-workspace.png'),fullPage:true});
});

test('toolbox search finds advanced basic controls and adds a real AntD input',async({page})=>{
  await page.goto('/');
  await page.getByRole('textbox',{name:'컨트롤 검색'}).fill('숫자 입력');
  await page.getByRole('button',{name:/NumberField/}).click();
  await page.locator('.preview .render-root > .design-node').click({position:{x:6,y:6}});
  await expect(page.getByRole('main').getByText('수량',{exact:true})).toBeVisible();
  await expect(page.locator('.ant-input-number')).toHaveCount(1);
  await expect(page.locator('.inspector > .ant-tag')).toBeVisible();
});

test('preconfigured form template changes the canvas and its data binding',async({page},testInfo)=>{
  await page.goto('/');
  await page.locator('.template-picker .ant-select').click();
  await page.getByText('고객 등록 폼',{exact:true}).last().click();
  await page.locator('.app-brand').click();
  await expect(page.getByText('신규 고객 등록',{exact:true})).toBeVisible();
  await expect(page.locator('.ant-picker')).toHaveCount(1);
  await expect(page.getByRole('main').getByText('메모',{exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('studio-form.png'),fullPage:true});
});

test('studio supports a small-screen canvas view',async({page},testInfo)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'모바일 보기'}).click();
  await expect(page.locator('.preview')).toHaveClass(/preview-mobile/);
  await page.screenshot({path:testInfo.outputPath('studio-mobile.png'),fullPage:true});
});

test('controls gallery renders real tree, slider and split panels',async({page},testInfo)=>{
  await page.goto('/');
  await page.locator('.template-picker .ant-select').click();
  await page.getByText('컴포넌트 갤러리',{exact:true}).last().click();
  await page.locator('.app-brand').click();
  await expect(page.getByRole('heading',{name:'컴포넌트 갤러리',exact:true})).toBeVisible();
  await expect(page.locator('.ant-tree')).toHaveCount(1);
  await expect(page.locator('.ant-slider')).toHaveCount(1);
  await expect(page.locator('.ant-steps')).toHaveCount(1);
  await expect(page.locator('.ant-splitter')).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath('studio-gallery.png'),fullPage:true});
});

test('inspector exposes binding tools and duplicates selected controls',async({page},testInfo)=>{
  await page.goto('/');
  await page.getByRole('textbox',{name:'컨트롤 검색'}).fill('숫자 입력');
  await page.getByRole('button',{name:/NumberField/}).click();
  await page.locator('.preview .render-root > .design-node').click({position:{x:6,y:6}});
  await page.getByRole('button',{name:'바인딩',exact:true}).click();
  await expect(page.locator('.inspector label').filter({hasText:'Binding: value'})).toBeVisible();
  await page.getByRole('button',{name:'속성',exact:true}).click();
  await page.getByRole('button',{name:'블록 복제'}).click();
  await expect(page.locator('.ant-input-number')).toHaveCount(2);
  await page.screenshot({path:testInfo.outputPath('studio-inspector.png'),fullPage:true});
});

test('composition: extract a selected form and reuse it as a new Toolbox component',async({page},testInfo)=>{
  await page.goto('/');
  await page.locator('.template-picker .ant-select').click();
  await page.getByText('고객 등록 폼',{exact:true}).last().click();
  await page.locator('.app-brand').click();
  const original=page.locator('.preview input').first();
  await expect(original).toHaveValue('김하늘');
  await page.locator('.tree-node').filter({hasText:'Panel'}).first().click();
  page.once('dialog',d=>d.accept('CustomerBlock'));
  await page.getByRole('button',{name:'컴포넌트로 추출',exact:true}).click();
  await expect(page.getByRole('button',{name:'+ CustomerBlock'})).toBeVisible();
  await expect(original).toHaveValue('김하늘');
  await page.getByRole('button',{name:'+ CustomerBlock'}).click();
  await page.locator('.preview .render-root > .design-node').click({position:{x:6,y:6}});
  await expect(page.getByText('고객 정보',{exact:true})).toHaveCount(2);
  await page.screenshot({path:testInfo.outputPath('studio-extracted-component.png'),fullPage:true});
});
test('composition: clicking nested composite fields selects the correct instance',async({page})=>{
  await page.goto('/');
  const form=page.locator('.easy-panel').filter({hasText:'배송지'}).first();
  await form.locator('input').first().click();
  await expect(page.locator('.inspector > .ant-tag')).toContainText('AddressEditor');
});
test('composition: move an item by dragging tree nodes into an existing container',async({page})=>{
  await page.goto('/');
  await page.locator('.template-picker .ant-select').click();
  await page.getByText('고객 등록 폼',{exact:true}).last().click();
  await page.locator('.app-brand').click();
  const source=page.locator('.tree-node').filter({hasText:'TextField'}).first();
  const target=page.locator('.tree-node').filter({hasText:'Row'}).first();
  await source.dragTo(target);
  await page.getByRole('button',{name:'json',exact:true}).click();
  const text=await page.locator('.bottom textarea').inputValue();
  const parsed=JSON.parse(text);
  const row=parsed.root.children.find(c=>c.type==='Panel').children.find(c=>c.type==='Row');
  expect(row.children.some(c=>c.type==='TextField')).toBeTruthy();
});
