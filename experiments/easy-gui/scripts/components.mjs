#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installComponentBundle} from '../src/component-kit.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [command,file]=process.argv.slice(2);
if(command!=='add'||!file){
  console.error('Usage: node scripts/components.mjs add <bundle.easygui.json>');
  process.exitCode=1;
}else{
  try{
    const installed=path.join(root,'src/installed-components.json');
    const defs=JSON.parse(await readFile(installed,'utf8'));
    const bundle=JSON.parse(await readFile(path.resolve(file),'utf8'));
    const next=installComponentBundle(defs,bundle);
    await writeFile(installed,JSON.stringify(next,null,2)+'\n','utf8');
    console.log('Installed '+bundle.name+'@'+bundle.version);
    if(bundle.requires.react.length)console.log('Register React imports in src/code-components.jsx: '+bundle.requires.react.join(', '));
  }catch(error){console.error('Install failed: '+error.message);process.exitCode=1;}
}
