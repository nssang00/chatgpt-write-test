from pathlib import Path
import sys
p=Path(sys.argv[1])/'e2e/component-authoring-v013.spec.js'
s=p.read_text()
old="  await page.getByRole('button',{name:'컴포넌트 생성'}).click();"
new="  if(name==='MiniSearch')await page.getByRole('button',{name:/새 컴포넌트 프로젝트로 시작/}).click();\n  else await page.getByRole('button',{name:'컴포넌트 생성'}).click();"
assert s.count(old)==1
p.write_text(s.replace(old,new))
print('E2E now creates a blank Component-first project, without SearchBox demo page instances')
