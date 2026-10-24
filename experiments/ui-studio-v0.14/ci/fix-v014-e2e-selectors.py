#!/usr/bin/env python3
"""Use the actual accessible AntD Select combobox, not an obsolete CSS internals selector."""
from pathlib import Path
import sys
path=Path(sys.argv[1])
source=path.read_text(encoding="utf-8")
before="""  await scope.locator('.ant-select-selector').first().click();
  await page.locator('.ant-select-dropdown:visible').getByTitle(label).last().click();"""
after="""  const fields=scope.getByRole('combobox');
  const control=label.startsWith('state.')&&(await fields.count())>1?fields.nth(1):fields.first();
  await control.click();
  if(label.startsWith('state.')){
    // Search and Enter are actual keyboard UX; AntD's virtual menu may be offscreen.
    await control.fill(label);
    await expect(page.locator('.ant-select-dropdown:visible').getByText(label,{exact:true})).toHaveCount(1);
    await control.press('Enter');
  }else{
    await page.locator('.ant-select-dropdown:visible').getByText(label,{exact:true}).last().click();
  }"""
if source.count(before)!=1:
    raise SystemExit(f"Expected exactly one outdated Select helper, got {source.count(before)}")
source=source.replace(before,after)
for find,replacement in [
    ("const input=studio(page).locator('[data-control-id]').filter({has:page.locator('input')}).locator('input').first();",
     "const input=studio(page).locator('.v6-artboard').getByRole('textbox',{name:'Input'});"),
    ("const button=studio(page).locator('.v6-artboard [data-control-id]').filter({has:page.locator('button')}).locator('button').first();",
     "const button=studio(page).locator('.v6-artboard').getByRole('button',{name:'버튼',exact:true});")
]:
    if source.count(find)!=1:
        raise SystemExit(f"Expected exactly one v0.14 preview locator, got {source.count(find)}: {find}")
    source=source.replace(find,replacement)
# Inspect the canonical IR before preview: configuration failures and runtime
# failures must be distinguishable in browser evidence.
needle="""  await studio(page).locator('.v6-center-head .ant-segmented-item').filter({hasText:'Preview'}).click();"""
assert source.count(needle)==1, "expected preview switch"
source=source.replace(needle,"""  // Verify authoring mutations before evaluating runtime interactions.
  await studio(page).getByRole('button',{name:'JSON 편집'}).click();
  const configured=JSON.parse(await studio(page).getByRole('textbox',{name:'v6 JSON 문서'}).inputValue());
  const added=configured.pages.main.root.children.filter(n=>n.kind==='component');
  const inputDoc=added.find(n=>n.typeId==='core/Input');
  const buttonDoc=added.find(n=>n.typeId==='core/Button');
  const textDoc=added.find(n=>n.typeId==='core/Text' && n.id!=='demoTitle');
  expect(inputDoc?.props.value).toMatchObject({kind:'binding',source:'state',path:['keyword'],mode:'TwoWay'});
  expect(buttonDoc?.events?.click).toMatchObject({kind:'set',target:{source:'state',path:['lastSearch']},value:{kind:'binding',source:'state',path:['keyword']}});
  expect(textDoc?.props.text).toMatchObject({kind:'binding',source:'state',path:['lastSearch']});
  await studio(page).getByRole('button',{name:'JSON 편집'}).click();
"""+needle)
source=source.replace("  await input.fill('Alice');","  await input.fill('Alice');\\n  await expect(studio(page).locator('.v6-state-line').filter({hasText:'keyword'})).toContainText('Alice');")

path.write_text(source,encoding="utf-8")
print(f"Updated v0.14 Chrome E2E Select helper: {path}")
