from pathlib import Path
import sys
p=Path(sys.argv[1])/'e2e/component-authoring-v013.spec.js'
s=p.read_text()
old="getByRole('button',{name:/Preview Page|Preview Harness/}).click()"
new="getByRole('button',{name:'Preview Harness',exact:true}).click()"
assert s.count(old)==1
p.write_text(s.replace(old,new))
print('E2E preview selector is now strict and unambiguous')
