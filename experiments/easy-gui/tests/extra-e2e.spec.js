import {test,expect} from '@playwright/test';

test('trusted React component is selectable with editable manifest metadata',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'+ StatusBadge'}).click();
  await expect(page.getByText('상태: 활성')).toBeVisible();
  await expect(page.getByText('활성 색상')).toBeVisible();
});

test('Studio exports a package and imports it into its component catalog',async({page})=>{
  await page.goto('/');
  page.once('dialog',d=>d.accept('PortableScreen'));
  const [download]=await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button',{name:'컴포넌트 패키지'}).click()
  ]);
  const file=await download.path();
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByRole('button',{name:'+ PortableScreen'})).toBeVisible();
});
