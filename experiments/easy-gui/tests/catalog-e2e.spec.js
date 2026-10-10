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
  await expect(page.getByRole('main').getByText('수량',{exact:true})).toBeVisible();
  await expect(page.locator('.ant-input-number')).toHaveCount(1);
  await expect(page.getByText('NumberField',{exact:true}).first()).toBeVisible();
});

test('preconfigured form template changes the canvas and its data binding',async({page},testInfo)=>{
  await page.goto('/');
  await page.locator('.template-picker .ant-select').click();
  await page.getByText('고객 등록 폼',{exact:true}).last().click();
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
  await expect(page.getByText('컴포넌트 갤러리',{exact:true}).first()).toBeVisible();
  await expect(page.locator('.ant-tree')).toHaveCount(1);
  await expect(page.locator('.ant-slider')).toHaveCount(1);
  await expect(page.locator('.ant-steps')).toHaveCount(1);
  await expect(page.locator('.ant-splitter')).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath('studio-gallery.png'),fullPage:true});
});
