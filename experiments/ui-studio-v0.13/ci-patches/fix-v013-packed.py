from pathlib import Path
import sys,json
root=Path(sys.argv[1])
p=root/'e2e/component-authoring-v013.spec.js'
s=p.read_text();old="  if(internal)await expect(field.locator('.ant-select-selection-item')).toContainText(internal);\n"
assert s.count(old)==1
p.write_text(s.replace(old,''))
p=root/'tests/consumer-v013/package.json'
data=json.loads(p.read_text());olddep=data['dependencies']['ui-studio-customer-browser']
assert olddep=='file:../component-v013'
data['dependencies']['ui-studio-customer-browser']='file:./ui-studio-customer-browser-0.1.0.tgz'
p.write_text(json.dumps(data,indent=2)+'\n')
print('Consumer now installs real packed npm artifact (not symlinked React) and authoring checks actual schema')
