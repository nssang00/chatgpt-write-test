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
  await page.locator('.ant-select-dropdown:visible').getByText(label,{exact:true}).last().click();"""
if source.count(before)!=1:
    raise SystemExit(f"Expected exactly one outdated Select helper, got {source.count(before)}")
path.write_text(source.replace(before,after),encoding="utf-8")
print(f"Updated v0.14 Chrome E2E Select helper: {path}")
