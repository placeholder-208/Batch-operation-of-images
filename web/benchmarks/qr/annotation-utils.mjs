// Deduplicate only identical coordinates, independent of corner order.
// Overlapping or nearby but different annotations remain separate.
export function deduplicateExactPolygons(raw){
 const polygons=[],duplicates=[],seen=new Map();
 for(const [index,polygon]of raw.entries()){
  if(polygon.length!==4||polygon.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))
   throw new Error('Invalid four-corner annotation');
  const key=JSON.stringify(polygon.map(p=>[p.x,p.y]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]));
  if(seen.has(key))duplicates.push({index,duplicateOf:seen.get(key)});
  else{seen.set(key,index);polygons.push(polygon);}
 }
 return {polygons,duplicates};
}
