import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.argv[2]||process.cwd();
const base=join(root,'tests','round14_gpu_compare');
const scenarios=['building-fill','building-stroke','road-width1','road-width3','water-fill','railway-width2'];
const DIAG=String.raw\`const SCENES={
 'building-fill':[{layer:'building',style:{'fill-color':'rgba(210,194,169,0.52)'}}],
 'building-stroke':[{layer:'building',style:{'stroke-color':'#766655','stroke-width':1}}],
 'road-width1':[{layer:'road',style:{'stroke-color':'rgba(220,65,55,0.92)','stroke-width':1}}],
 'road-width3':[{layer:'road',style:{'stroke-color':'rgba(220,65,55,0.92)','stroke-width':3}}],
 'water-fill':[{layer:'water',style:{'fill-color':'rgba(90,154,227,0.75)'}}],
 'railway-width2':[{layer:'railway',style:{'stroke-color':'rgba(70,70,70,0.9)','stroke-width':2}}]
};
\`.replaceAll('\\\`','\`');
const modify=(str,a,b,replacement)=>{let x=str.indexOf(a),y=str.indexOf(b,x+a.length);if(x<0||y<0)throw Error('Diag SCENES anchors not found: '+a+' / '+b);return str.slice(0,x)+replacement+str.slice(y)};
async function change(file,fn){const path=join(base,file);const a=await readFile(path,'utf8');const b=fn(a);if(a===b)throw Error('No changes '+file);await writeFile(path,b)}
await change('ol_stock.html',s=>{
 s=modify(s,'const SCENES={','const tileNames=',DIAG);
 if(!s.includes('result.scenes.length===3'))throw Error('OL scene count anchor missing');
 return s.replace('result.scenes.length===3','result.scenes.length===6')
});
await change('round14_m5.html',s=>modify(s,'const SCENES={','const clampRounds=',DIAG));
await change('oneclick.mjs',s=>{
 const needle="const scenes=['building-1l','road-1l','mixed-4l'];";
 if(!s.includes(needle))throw Error('oneclick scenes anchor missing');
 return s.replace(needle,"const scenes="+JSON.stringify(scenarios)+";")
});
await change('run_one.mjs',s=>{
 const needle="result.scenes.length!==3";
 if(!s.includes(needle))throw Error('run_one length anchor missing');
 s=s.replace(needle,'result.scenes.length!==6');
 const regex="/^(building-1l|road-1l|mixed-4l)\\.png$/";
 if(!s.includes(regex))throw Error('image regex anchor missing');
 s=s.replace(regex,'/^('+scenarios.join('|')+')\\.png$/');
 const scenes="['building-1l','road-1l','mixed-4l']";
 if(!s.includes(scenes))throw Error('screenshot names anchor missing');
 s=s.replace(scenes,JSON.stringify(scenarios));
 return s;
});
console.log('PARITY_ISOLATION_SCENES',scenarios.join(','));
