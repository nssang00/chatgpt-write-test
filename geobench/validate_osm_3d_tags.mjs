import fs from 'node:fs/promises';
const scene=JSON.parse(await fs.readFile('public/fixture-detailed.json','utf8'));
const meta=scene.metadata,stats=meta.meshStats;
const n=stats.buildings;
const fields=['buildingHeightTagged','buildingLevelsTagged','buildingRoofShapeTagged',
 'buildingNonflatRoofRendered','buildingRoofHeightEstimated','buildingMinHeightTagged',
 'buildingNamed','buildingStartDateTagged','OSMBuildingPartsPresent',
 'roadInclineNumeric','roadInclineText','roadElevationTaggedNodes','inferredHeights'];
const counts=Object.fromEntries(fields.map(k=>[k,stats[k]]));
let valid=n>=100 && counts.buildingHeightTagged+counts.buildingLevelsTagged>=0;
for(const name of fields)valid&&=Number.isInteger(counts[name])&&counts[name]>=0;
for(const name of ['buildingHeightTagged','buildingLevelsTagged',
 'buildingRoofShapeTagged','buildingNonflatRoofRendered','buildingRoofHeightEstimated',
 'buildingMinHeightTagged','buildingNamed','buildingStartDateTagged','inferredHeights']){
 valid&&=counts[name]<=n;
}
valid&&=counts.buildingNonflatRoofRendered<=counts.buildingRoofShapeTagged;
valid&&=counts.buildingRoofHeightEstimated<=counts.buildingRoofShapeTagged;
valid&&=(counts.buildingHeightTagged+counts.buildingLevelsTagged>=n-counts.inferredHeights);
const report={
 status:valid?'pass':'fail',dataset:meta.area||'Seoul Gangnam Yeoksam',
 bbox:meta.bbox,buildings:n,roadWays:stats.roads,counts,
 sourceInterpretation:{
  'height':'actual OSM height (when tagged); height includes roof',
  'building:levels':'otherwise use floor-count × 3.05m',
  'roof:shape':'flat or supported gabled/hipped/pyramidal on approximately rectangular footprints',
  'min_height':'raise the ground-floor facade only for tagged suspended buildings',
  'start_date,name':'metadata counts only; no invented geometry',
  'building:part':'counted only; building-part overlaps not yet reconstructed',
  'incline,ele':'audited; not trusted as absolute road alignment without vertical datum/road survey'
 },
 caveats:[
  'OSM data is downloaded at CI runtime and may change',
  'Terrarium DEM remains approximate',
  'A tagged roof shape on a complex footprint is kept flat to avoid fabrication',
  'Numerical QA pass does not mean visual quality pass'
 ]
};
await fs.mkdir('results',{recursive:true});
await fs.writeFile('results/osm-3d-tag-coverage.json',JSON.stringify(report,null,2));
console.log('OSM_3D_TAG_COVERAGE_RESULT',JSON.stringify(report));
if(!valid)process.exitCode=1;
