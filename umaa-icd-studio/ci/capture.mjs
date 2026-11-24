import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('screenshots', {recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1,locale:'ko-KR'});
const errors=[];
page.on('pageerror', e=>errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'networkidle'});
  await page.getByRole('tab',{name:'Interface Matrix'}).waitFor();
  await page.getByText('INTERFACE DETAILS',{exact:true}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:'screenshots/01-interface-matrix.png',fullPage:true,animations:'disabled'});
  await page.getByRole('tab',{name:'Data Dictionary'}).click();
  await page.locator('.type-card').first().waitFor();
  await page.screenshot({path:'screenshots/02-data-dictionary.png',fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'ICD 미리보기'}).click();
  await page.locator('.preview').waitFor();
  await page.screenshot({path:'screenshots/03-icd-preview.png',fullPage:true,animations:'disabled'});
  assert.equal(errors.length,0,errors.join('\n'));
  await writeFile('screenshots/smoke-test.txt','Production build opened in Chromium; matrix, data dictionary and ICD preview passed. No page errors.\n');
  console.log('Browser smoke test passed; 3 PNG screenshots captured.');
} catch(e) {
  await page.screenshot({path:'screenshots/error.png',fullPage:true}).catch(()=>{});
  throw e;
} finally {
  await browser.close();
}
