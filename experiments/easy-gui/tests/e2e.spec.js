import {test,expect} from '@playwright/test';
test('browser smoke: Studio displays real React/AntD controls',async({page})=>{
  await page.goto('/');
  await expect(page.getByText('Easy GUI Studio')).toBeVisible();
  await expect(page.getByText('배송지',{exact:true})).toBeVisible();
  await expect(page.getByText('청구지',{exact:true})).toBeVisible();
  await expect(page.locator('.ant-card').filter({hasText:'배송지'}).locator('input').first()).toHaveValue('김민수');
});
test('browser regression: two editors maintain independent data',async({page})=>{
  await page.goto('/');
  const first=page.locator('.ant-card').filter({hasText:'배송지'}).locator('input').first();
  const second=page.locator('.ant-card').filter({hasText:'청구지'}).locator('input').first();
  await first.fill('변경된 배송지');
  await expect(first).toHaveValue('변경된 배송지');
  await expect(second).toHaveValue('이서연');
});
test('browser regression: composite registers in current Toolbox',async({page})=>{
  await page.goto('/');
  page.once('dialog',d=>d.accept('SharedEditor'));
  await page.getByRole('button',{name:'컴포넌트로 등록'}).click();
  await expect(page.getByRole('button',{name:'+ SharedEditor'})).toBeVisible();
});
test('browser regression: invalid JSON does not destroy current screen',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'json',exact:true}).click();
  await page.locator('.bottom textarea').fill('{"type":"Missing"}');
  await page.getByRole('button',{name:/JSON 적용/}).click();
  await expect(page.getByText(/Unknown component: Missing/)).toBeVisible();
  await expect(page.getByText('배송지',{exact:true})).toBeVisible();
});
