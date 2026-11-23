import fs from 'node:fs/promises';
const baseline=JSON.parse(await fs.readFile('results/roadbed-baseline-validation.json','utf8'));
const variant=JSON.parse(await fs.readFile('results/roadbed-variant-validation.json','utf8'));
const {gradeSolver}=variant.roadbed;
if(!baseline.pass||!variant.pass)throw Error('Baseline or variant failed geometric/contact validation');
if(baseline.roadbed.gradeSolver)throw Error('Baseline accidentally enabled grade solver');
if(!gradeSolver)throw Error('Variant did not enable grade solver');
const names=['road','road-edge','road-marking'];
const changes={};
for(const name of names){
  const a=baseline.materials[name],b=variant.materials[name];
  changes[name]={
    baselineGrade20AreaPct:a.areaOver20Pct,
    variantGrade20AreaPct:b.areaOver20Pct,
    grade20ReductionPct:a.areaOver20Pct>0?(a.areaOver20Pct-b.areaOver20Pct)/a.areaOver20Pct*100:null,
    baselineGrade40AreaPct:a.areaOver40Pct,
    variantGrade40AreaPct:b.areaOver40Pct,
    grade40ReductionPct:a.areaOver40Pct>0?(a.areaOver40Pct-b.areaOver40Pct)/a.areaOver40Pct*100:null,
    maxContactErrorM:b.maxContactErrorMeters,
    trianglesBefore:a.triangles,trianglesAfter:b.triangles
  };
}
const diff=(key)=>variant.terrain[key]-baseline.terrain[key];
const result={
  source:'Both fixtures use exactly one cached OSM XML and Terrarium DEM; only the grade solver switch changes.',
  comparison:'physical slope area and earthwork on identical OSM/DEM, not pixel appearance or surveyed elevation accuracy',
  baselineRoadbed:baseline.roadbed,variantRoadbed:variant.roadbed,
  gradeSolver,materials:changes,
  earthwork:{
    baselineMaxCutM:baseline.terrain.maximumCutMeters,
    variantMaxCutM:variant.terrain.maximumCutMeters,
    baselineMaxFillM:baseline.terrain.maximumFillMeters,
    variantMaxFillM:variant.terrain.maximumFillMeters,
    cutIncreaseM:diff('maximumCutMeters'),fillIncreaseM:diff('maximumFillMeters')
  },
  geometryValid:baseline.pass&&variant.pass,
  improved20:changes.road.variantGrade20AreaPct<changes.road.baselineGrade20AreaPct,
  improved40:changes.road.variantGrade40AreaPct<changes.road.baselineGrade40AreaPct,
  acceptableEarthwork:diff('maximumCutMeters')<=3&&diff('maximumFillMeters')<=3,
  caveat:'A slope projection on OSM/Mapzen is synthetic visual grading; not engineering-grade elevations.'
};
result.experimentalCandidate=result.geometryValid&&result.improved20&&result.improved40&&result.acceptableEarthwork;
await fs.writeFile('results/road-grade-controlled-ab.json',JSON.stringify(result,null,2));
console.log('ROAD_GRADE_CONTROLLED_AB',JSON.stringify(result));
if(!result.geometryValid)process.exitCode=1;
