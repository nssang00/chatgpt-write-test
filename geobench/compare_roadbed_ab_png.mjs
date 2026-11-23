import fs from 'node:fs/promises';
import {PNG} from 'pngjs';
const names=['top','oblique','low'];
const results={renderer:'Chromium SwiftShader software WebGL',camera:'exact same frozen stream manifest focus and OSM junction for both variants',views:{}};
for(const name of names){
  const a=PNG.sync.read(await fs.readFile('results/grade-baseline-'+name+'.png'));
  const b=PNG.sync.read(await fs.readFile('results/grade-constrained-'+name+'.png'));
  if(a.width!==b.width||a.height!==b.height)throw Error('Mismatched screenshots '+name);
  let total=0,changed=0,changedStrong=0,centerDiff=0,centerPixels=0;
  const W=a.width,H=a.height;
  const composite=new PNG({width:W*2,height:H});
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const idx=(y*W+x)*4,ia=(y*W*2+x)*4,ib=(y*W*2+W+x)*4;
    let maxDelta=0,delta=0;
    for(let c=0;c<3;c++){
      const v=Math.abs(a.data[idx+c]-b.data[idx+c]);
      delta+=v;maxDelta=Math.max(v,maxDelta);total+=v;
    }
    composite.data[ia]=a.data[idx];
    composite.data[ia+1]=a.data[idx+1];
    composite.data[ia+2]=a.data[idx+2];
    composite.data[ia+3]=255;
    composite.data[ib]=b.data[idx];
    composite.data[ib+1]=b.data[idx+1];
    composite.data[ib+2]=b.data[idx+2];
    composite.data[ib+3]=255;
    if(maxDelta>3)changed++;
    if(maxDelta>15)changedStrong++;
    if(x>W*.25&&x<W*.75&&y>H*.25&&y<H*.75){
      centerDiff+=delta;centerPixels++;
    }
  }
  await fs.writeFile('results/grade-ab-comparison-'+name+'.png',PNG.sync.write(composite));
  results.views[name]={
    resolution:[W,H],meanAbsRgb255:total/(W*H*3),
    changedPixelsOver3Pct:100*changed/(W*H),
    changedPixelsOver15Pct:100*changedStrong/(W*H),
    centralHalfMeanAbsRgb255:centerDiff/(3*centerPixels)
  };
}
await fs.writeFile('results/grade-ab-image-metrics.json',JSON.stringify(results,null,2));
console.log('GRADE_AB_PIXEL_COMPARE',JSON.stringify(results));
