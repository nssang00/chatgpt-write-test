import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('smoke: CLI creates React/Vite project without overwriting existing files',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'easy-gui-smoke-'));
  const target=path.join(temp,'new-app');
  try{
    const run=spawnSync(process.execPath,[path.join(project,'scripts/create.mjs'),target],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    for(const f of ['index.html','vite.config.js','src/main.jsx','src/blueprint.mjs','tests/unit.test.mjs','scripts/create.mjs','package.json'])await stat(path.join(target,f));
    const pkg=JSON.parse(await readFile(path.join(target,'package.json'),'utf8'));
    assert.ok(pkg.dependencies.react&&pkg.dependencies.antd);
    assert.notEqual(spawnSync(process.execPath,[path.join(project,'scripts/create.mjs'),target],{encoding:'utf8'}).status,0);
  }finally{await rm(temp,{recursive:true,force:true});}
});
test('smoke: entrypoint renders real AntD components',async()=>{
  const main=await readFile(path.join(project,'src/main.jsx'),'utf8');
  assert.match(main,/from ['"]antd['"]/);
  assert.match(main,/createRoot/);
  assert.match(main,/validateBlueprint/);
});
