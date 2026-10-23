#!/usr/bin/env python3
"""Use the actual accessible AntD Select combobox, not an obsolete CSS internals selector."""
from pathlib import Path
import sys
path=Path(sys.argv[1])
source=path.read_text(encoding="utf-8")
before="""  await scope.locator('.ant-select-selector').first().click();
  await page.locator('.ant-select-dropdown:visible').getByTitle(label).last().click();"""
after="""  const fields=scope.getByRole('combobox');
  await (label.startsWith('state.')&&(await fields.count())>1?fields.nth(1):fields.first()).click();
  await page.locator('.ant-select-dropdown:visible').getByText(label,{exact:true}).last().click({force:true});"""
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
path.write_text(source,encoding="utf-8")
print(f"Updated v0.14 Chrome E2E Select helper: {path}")
