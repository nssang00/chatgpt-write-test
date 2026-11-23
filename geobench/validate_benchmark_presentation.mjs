import fs from 'node:fs/promises';
const d=JSON.parse(await fs.readFile('public/fixture-detailed.json','utf8'));
const result=JSON.parse(await fs.readFile('results/roadbed-integrated-validation.json','utf8'));
const stats=d.metadata.roadbed;
if(!stats?.mode?.startsWith('synthetic-visual-benchmark'))
 throw Error('This validator only accepts the explicitly synthetic benchmark mode');
if(!d.metadata.demSource?.includes('SYNTHETIC BENCHMARK TERRAIN'))
 throw Error('Synthetic terrain provenance must be shown in the dataset metadata');
if(!result.pass||result.terrain.invalidVertices!==0)
 throw Error('Synthetic terrain failed exact geometry contact');
const asphalt=result.materials.road;
const slope20=asphalt.areaOver20Pct;
const slope40=asphalt.areaOver40Pct;
const pass=slope20<=.15&&slope40<=.02&&
  stats.maximumTheoreticalSlope<=.08&&
  asphalt.maxContactErrorMeters<=.01;
const out={
 status:pass?'PASS - geometry only':'FAIL',
 scope:'Visual renderer-comparison benchmark, not surveyed Seoul 3D terrain',
 sourceDEM:'original AWS Mapzen Terrarium retained in fixture.json',
 roadGeometry:'OSM 2D centerline, unioned asphalt polygons; not surveyed road boundaries',
 terrainMode:stats.mode,
 profile:result.profile,
 roadAreaOver20Pct:slope20,roadAreaOver40Pct:slope40,
 surfaceContactErrorM:asphalt.maxContactErrorMeters,
 referenceTerrainDeviationMaxM:stats.maximumDeviationFromSourceMeters,
 geometryTriangles:result.terrain.triangles,
 fieldSlopeTheoreticalBound:stats.maximumTheoreticalSlope,
 pass,
 caveat:'A synthetic visually smooth city may be useful for engine performance, but is not a digital twin or realistic topographic reconstruction.'
};
await fs.mkdir('results',{recursive:true});
await fs.writeFile('results/benchmark-presentation-qa.json',JSON.stringify(out,null,2));
console.log('BENCHMARK_PRESENTATION_REAL_SCENE_QA',JSON.stringify(out));
if(!pass)process.exitCode=1;
