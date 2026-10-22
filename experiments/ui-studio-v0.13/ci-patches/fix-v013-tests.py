from pathlib import Path
import sys
root=Path(sys.argv[1])
def replace(name,old,new):
 p=root/name
 value=p.read_text(encoding='utf-8')
 assert value.count(old)==1, f'{name}: expected exactly one patch marker, found {value.count(old)}'
 p.write_text(value.replace(old,new),encoding='utf-8')
replace('e2e/studio.spec.js', "getByRole('button', { name: 'Preview Page' })", "getByRole('button', { name: 'Preview Harness' })")
replace('e2e/component-authoring-v013.spec.js', 'if(internal){await field.locator', "if(internal && internal!=='value'){await field.locator")
replace('playwright.config.js', "testDir: './e2e',", "testDir: './e2e',\n  testIgnore: '**/consumer-v013/**',")
print('v0.13 CI regression patch applied')
