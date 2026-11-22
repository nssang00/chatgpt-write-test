// OSM Simple 3D Buildings tag interpretation.
// Source: https://wiki.openstreetmap.org/wiki/Simple_3D_buildings
// Height is relative to local ground and roof is included in height=*.
// There is no implied survey-grade geometry; untagged values remain estimates.
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
export function parseMeters(value){
  if(value==null)return null;
  const match=String(value).trim().match(/^([+]?(?:\d+(?:\.\d+)?|\.\d+))\s*(m|metres?|meters?|ft|feet)?$/i);
  if(!match)return null;
  const number=Number(match[1]);
  const meters=/^(ft|feet)$/i.test(match[2]||'')?number*.3048:number;
  return Number.isFinite(meters)&&meters>=0&&meters<=1000?meters:null;
}
const levels=value=>{
  if(value==null||!/^(?:\d+(?:\.\d+)?)$/.test(String(value).trim()))return null;
  const v=Number(value);
  return Number.isFinite(v)&&v>=0&&v<=200?v:null;
};
export function interpretBuildingTags(tags,seed=0){
  const heightTag=parseMeters(tags.height);
  const levelTag=levels(tags['building:levels']);
  const minHeightTag=parseMeters(tags.min_height);
  const minLevelTag=levels(tags['building:min_level']);
  const roofHeightTag=parseMeters(tags['roof:height']);
  const roofLevelTag=levels(tags['roof:levels']);
  const requestedRoof=String(tags['roof:shape']||'flat').toLowerCase();
  const supportedRoofs=new Set(['flat','gabled','hipped','pyramidal']);
  const roofShape=supportedRoofs.has(requestedRoof)?requestedRoof:'flat';
  const fallbackFloors=3+(seed%5);
  const storeys=levelTag??(heightTag!=null?Math.max(1,Math.round(heightTag/3.05)):fallbackFloors);
  const hasRoof=(roofShape!=='flat');
  // A missing nonflat roof height is an assumption, not an OSM measurement.
  const inferredRoof=hasRoof?2.8:0;
  const roofHeight=hasRoof?(roofHeightTag??(roofLevelTag!=null?roofLevelTag*3:inferredRoof)):0;
  const totalHeight=heightTag??(storeys*3.05+roofHeight);
  const roofH=hasRoof?clamp(roofHeight,0,Math.max(0,totalHeight-1)):0;
  const minHeight=clamp(minHeightTag??((minLevelTag??0)*3.05),0,Math.max(0,totalHeight-roofH-.5));
  return {
    height:totalHeight,
    minHeight,
    roofHeight:roofH,
    roofShape,
    requestedRoof,
    roofHeightEstimated:hasRoof&&roofHeightTag==null&&roofLevelTag==null,
    wallHeight:totalHeight-roofH,
    floors:Math.max(1,Math.round(storeys-(minLevelTag??0))),
    source:heightTag!=null?'height':levelTag!=null?'building:levels':'inferred',
    levelsPresent:levelTag!=null,
    heightPresent:heightTag!=null,
    roofTagPresent:tags['roof:shape']!=null,
    minHeightPresent:minHeightTag!=null||minLevelTag!=null,
    namePresent:!!tags.name,
    datePresent:!!tags.start_date
  };
}
const midpoint=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
const lerp2=(a,b,t)=>[a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t];
export function roofTriangles(points,wallY,topY,shape){
  if(!['gabled','hipped','pyramidal'].includes(shape)||points.length!==4||topY<=wallY)return null;
  // These roof forms are generated only for a nearly rectangular footprint.
  let p=points;
  const vectors=p.map((a,i)=>[p[(i+1)%4][0]-a[0],p[(i+1)%4][1]-a[1]]);
  const lengths=vectors.map(v=>Math.hypot(...v));
  if(lengths.some(x=>x<1.5))return null;
  const dot=(a,b)=>(a[0]*b[0]+a[1]*b[1])/(Math.hypot(...a)*Math.hypot(...b));
  if(Math.abs(dot(vectors[0],vectors[1]))>.20||Math.abs(dot(vectors[1],vectors[2]))>.20||
     Math.abs(1-lengths[0]/lengths[2])>.18||Math.abs(1-lengths[1]/lengths[3])>.18)return null;
  if(lengths[1]>lengths[0])p=[p[1],p[2],p[3],p[0]];
  const [a,b,c,d]=p;
  const vertical=(point,y)=>[point[0],y,point[1]];
  const tri=(a,b,c)=>[a,b,c];
  const edgeRoof=[a,b,c,d].map(v=>vertical(v,wallY));
  if(shape==='pyramidal'){
    const center=[(a[0]+b[0]+c[0]+d[0])/4,(a[1]+b[1]+c[1]+d[1])/4];
    const peak=vertical(center,topY);
    return {roof:[tri(edgeRoof[0],edgeRoof[1],peak),tri(edgeRoof[1],edgeRoof[2],peak),
      tri(edgeRoof[2],edgeRoof[3],peak),tri(edgeRoof[3],edgeRoof[0],peak)],gable:[]};
  }
  const left=midpoint(d,a),right=midpoint(b,c);
  const long=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const short=Math.hypot(c[0]-b[0],c[1]-b[1]);
  const t=shape==='hipped'?clamp(short/(2*long),0,.48):0;
  const u=vertical(lerp2(left,right,t),topY),v=vertical(lerp2(left,right,1-t),topY);
  const roof=[
    tri(edgeRoof[0],edgeRoof[1],v),tri(edgeRoof[0],v,u),
    tri(edgeRoof[2],edgeRoof[3],u),tri(edgeRoof[2],u,v)
  ];
  if(shape==='hipped'){
    roof.push(tri(edgeRoof[3],edgeRoof[0],u),tri(edgeRoof[1],edgeRoof[2],v));
    return {roof,gable:[]};
  }
  return {roof,gable:[
    tri(edgeRoof[3],edgeRoof[0],u),tri(edgeRoof[1],edgeRoof[2],v)
  ]};
}
