from pathlib import Path
import sys
root=Path(sys.argv[1])
p=root/'src/framework/UnifiedStudio.jsx'
s=p.read_text()
old='value={publicField} options={Object.keys(meta?.properties||{}).map(k=>({label:k,value:k}))} onChange={setPublicField}/>'
new='value={meta?.properties?.[publicField]?publicField:Object.keys(meta?.properties||{})[0]} options={Object.keys(meta?.properties||{}).map(k=>({label:k,value:k}))} onChange={setPublicField}/>'
assert s.count(old)==2,f'expected 2 selectors: {s.count(old)}'
s=s.replace(old,new)
for a,b in [
('onClick={()=>onExpose(publicField,publicName)}>Expose Property','onClick={()=>onExpose(meta?.properties?.[publicField]?publicField:Object.keys(meta?.properties||{})[0],publicName)}>Expose Property'),
('onClick={()=>onAllowOverride(publicField)}>Allow Override','onClick={()=>onAllowOverride(meta?.properties?.[publicField]?publicField:Object.keys(meta?.properties||{})[0])}>Allow Override')]:
 assert s.count(a)==1;a_old=a;s=s.replace(a,b)
p.write_text(s)
p=root/'e2e/component-authoring-v013.spec.js'
s=p.read_text()
old="  if(internal && internal!=='value'){await field.locator('.ant-select').click();await page.getByRole('option',{name:internal,exact:true}).click();}"
new="  if(internal)await expect(field.locator('.ant-select-selection-item')).toContainText(internal);"
assert s.count(old)==1
p.write_text(s.replace(old,new))
p=root/'e2e/consumer-v013/consumer.spec.js'
s=p.read_text()
old=" await page.goto('/');"
new=""" page.on('pageerror',error=>console.log('CONSUMER_PAGE_ERROR:',error.stack||error.message));
 page.on('console',message=>{if(message.type()==='error')console.log('CONSUMER_CONSOLE_ERROR:',message.text());});
 await page.goto('/');
 console.log('CONSUMER_PAGE_URL:',page.url());
 console.log('CONSUMER_PAGE_HTML:',(await page.locator('body').innerHTML()).slice(0,1600));"""
assert s.count(old)==1
p.write_text(s.replace(old,new))
print('v0.13 public prop selection fallback + consumer debugging')
