import fs from 'node:fs/promises';
const baseline=JSON.parse(await fs.readFile('results/local-road-baseline-validation.json','utf8'));
const variant=JSON.parse(await fs.readFile('results/local-road-variant-validation.json','utf8'));
if(!baseline.pass||!variant.pass)throw Error('Baseline or variant road/terrain contact failed');
const v=variant.roadbed,b=baseline.roadbed;
if(!v?.method?.includes('planar asphalt polygon boundary'))
  throw Error('Local corridor pipeline was not activated');
if(v.maximumActualAdjustmentMeters>3.001||v.maximumCutMeters>3.001||v.maximumFillMeters>3.001)
  throw Error('Local earthwork exceeded safety budget (3m)');
if(!(v.changedVertices<b.changedVertices))
  throw Error('A true local corridor must modify fewer DEM nodes than the 50m baseline');
if(!(v.unchangedVertices>0&&v.terrainUnchangedPct>0))
  throw Error('Local road earthwork unexpectedly changes the entire map');

const name='road',newRoad=variant.materials[name],oldRoad=baseline.materials[name];
const result={
  source:'same cached Seoul OSM XML and exact same Terrarium DEM (one generate.mjs invocation)',
  comparison:'50m centerline-wide integrated terrain vs polygon-boundary local roadbed with a 3m per-vertex cut/fill budget',
  geometryValid:baseline.pass&&variant.pass,
  baseline:{roadbed:b,terrain:baseline.terrain,road:oldRoad},
  variant:{roadbed:v,terrain:variant.terrain,road:newRoad},
  terrainVerticesPreservedPct:v.terrainUnchangedPct,
  terrainVerticesChangedReductionPct:100*(1-v.changedVertices/b.changedVertices),
  maxCutReductionMeters:baseline.terrain.maximumCutMeters-variant.terrain.maximumCutMeters,
  maxFillReductionMeters:baseline.terrain.maximumFillMeters-variant.terrain.maximumFillMeters,
  slopeOver20ChangePct:newRoad.areaOver20Pct-oldRoad.areaOver20Pct,
  slopeOver40ChangePct:newRoad.areaOver40Pct-oldRoad.areaOver40Pct,
  visualSlopeImproved:newRoad.areaOver20Pct<oldRoad.areaOver20Pct,
  surveyedRoadGradesAvailable:false,
  goNoGo:'CANDIDATE FOR VISUAL REVIEW ONLY - structural deformation budget passes; road grade and screenshot quality must be judged separately',
  caveat:'Capping vertical changes at 3m necessarily trades off smoothing on DEM/OSM disagreement; cannot reconstruct true Seoul road elevations.'
};
await fs.writeFile('results/local-road-corridor-ab.json',JSON.stringify(result,null,2));
console.log('LOCAL_ROAD_CORRIDOR_AB_RESULT',JSON.stringify(result));
