#!/usr/bin/env python3
"""Make Chrome E2E assertions refer to the current page rather than a presumed empty tree."""
from pathlib import Path
import sys
root=Path(sys.argv[1])

def change(path, before, after, n=1):
    p=root / path
    source=p.read_text(encoding='utf-8')
    if source.count(before) != n:
        raise SystemExit(f'Unexpected E2E fixture: {path}, expected {n}, got {source.count(before)}: {before}')
    p.write_text(source.replace(before,after),encoding='utf-8')

change('e2e/component-authoring-v013.spec.js',
       "getByRole('button',{name:'Preview Harness',exact:true}).click();",
       "getByRole('button',{name:'Preview Harness',exact:true}).first().click();")
change('e2e/editing-v015.spec.js',
       "await insert(page,'row');",
       "const baseCount=await tree(page).locator('[data-v6-tree-id]').count();\n await insert(page,'row');")
change('e2e/editing-v015.spec.js',
       'expect(ids).toHaveLength(4);expect(new Set(ids).size).toBe(4);',
       'expect(ids).toHaveLength(baseCount+3);expect(new Set(ids).size).toBe(baseCount+3);')
change('e2e/editing-v015.spec.js',
       ".toHaveCount(7);", ".toHaveCount(baseCount+6);",2)
change('e2e/editing-v015.spec.js',
       ".toHaveCount(4);", ".toHaveCount(baseCount+3);")
change('e2e/editing-v015.spec.js',
       "await insert(page,'Button');",
       "const baseCount=await tree(page).locator('[data-v6-tree-id]').count();\n await insert(page,'Button');")
change('e2e/editing-v015.spec.js',
       ".toHaveCount(2);", ".toHaveCount(baseCount+1);",4)
change('e2e/editing-v015.spec.js',
       ".toHaveCount(1);", ".toHaveCount(baseCount);",2)
print('PASS: v0.15 Chrome E2E selectors and fixture-relative counts updated')
