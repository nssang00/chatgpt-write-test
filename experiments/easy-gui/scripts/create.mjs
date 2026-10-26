#!/usr/bin/env node
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=process.argv[2];
if(!arg||arg.startsWith('-')){console.error('Usage: npm run create -- <project-folder>');process.exitCode=1;}
else{
  const dest=path.resolve(arg);
  if(existsSync(dest)){console.error('Target already exists; refusing to overwrite: '+dest);process.exitCode=1;}
  else{
    await mkdir(dest,{recursive:true});
    for(const file of ['index.html','vite.config.js','.gitignore'])await cp(path.join(root,file),path.join(dest,file));
    for(const dir of ['src','tests','scripts'])await cp(path.join(root,dir),path.join(dest,dir),{recursive:true});
    const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
    pkg.name=path.basename(dest).toLowerCase().replace(/[^a-z0-9_-]/g,'-');
    await writeFile(path.join(dest,'package.json'),JSON.stringify(pkg,null,2)+'\n');
    console.log('Created '+dest+'\nNext: cd '+dest+' && npm install && npm run dev');
  }
}
