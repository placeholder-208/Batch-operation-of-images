import test from 'node:test';
import assert from 'node:assert/strict';
import {renderContinuousModel} from '../../js/curved-region.js';
import {createQRStatistics,qrStatisticsCSV,qrStatisticsJSON,normalizeQROptions} from '../../js/qr-statistics.js';
import {deduplicateExactPolygons} from './annotation-utils.mjs';
import {RESTORATION_LIMITS,decodeBlurredRegion} from '../../js/blur-restoration.js';
import {finderQuality,decodeRestoredGeometry,RESTORED_GEOMETRY_LIMITS} from '../../js/restored-geometry.js';
import {iterateModuleRecovery,MODULE_RECOVERY_LIMITS} from '../../js/module-recovery.js';
import {fitStructureLevels,iterateStructureSampling} from '../../js/structure-sampling.js';
import {decodeStructureRegion,STRUCTURE_DECODER_LIMITS} from '../../js/structure-decoder.js';

test('annotation audit removes only exact duplicate entities, regardless of corner order',()=>{
 const box=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
 const near=box.map(p=>({...p,x:p.x+.001}));
 const {polygons,duplicates}=deduplicateExactPolygons([box,box.slice().reverse(),near]);
 assert.equal(polygons.length,2);assert.deepEqual(duplicates,[{index:1,duplicateOf:0}]);
 assert.deepEqual(box,[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]);
});

test('continuous rendering preserves gradients and the four-module quiet zone',()=>{
 const width=30,gray=Float32Array.from({length:900},(_,i)=>i%width*8);
 const rendered=renderContinuousModel({dimension:21},(x,y)=>({x,y}),gray,width,width);
 assert.equal(rendered.width,232);
 assert.equal(rendered.data[0],255);
 const pixel=(x,y)=>rendered.data[(y*rendered.width+x)*4];
 assert.equal(pixel(32,32),0);assert.equal(pixel(36,32),4);assert.equal(pixel(40,32),8);
 assert.equal(pixel(31,32),255);assert.equal(pixel(200,32),255);
 assert.equal(rendered.data[(32*232+32)*4+3],255);
});
test('out-of-bounds and nonfinite surface mappings are rejected',()=>{
 const gray=new Float32Array(900);
 for(const map of [()=>({x:-1,y:2}),()=>({x:NaN,y:2}),()=>({x:30,y:2})])
  assert.equal(renderContinuousModel({dimension:21},map,gray,30,30),null);
});
test('statistics retain manual fields and append gray retry measurements',()=>{
 const trace=createQRStatistics({name:'test.jpg',size:1},null,{}, {reordered:true,useTPS:true});
 trace.record.detection={status:'ok'};trace.record.manualReview.notes='manual';
 trace.record.stages.push({name:'curved_decode',samplingMode:'continuous-gray',elapsedMs:5,status:'ok'});
 trace.record.stages.push({name:'restored_geometry_fit',elapsedMs:20,status:'ok'},
  {name:'restored_curved_geometry',elapsedMs:8,status:'ok'},
  {name:'restored_curved_decode',elapsedMs:12,status:'ok'},
  {name:'structure_total',elapsedMs:30,status:'ok',parent:true},
  {name:'structure_decode',elapsedMs:6,status:'ok'});
 trace.finish([]);
 const item={file:{name:'test.jpg'},qrStatistics:trace.record};
 const csv=qrStatisticsCSV([item]);
 assert.match(csv,/人工备注/);assert.match(csv,/灰度解码ms/);assert.match(csv,/3.16-dense-sheet/);
 assert.match(csv,/模块恢复解码次数/);assert.match(csv,/模块恢复预算跳过数/);
 assert.match(csv,/结构灰度几何ms/);assert.match(csv,/结构灰度预算跳过数/);
 assert.match(csv,/模糊恢复滤波次数/);
 const rows=csv.slice(1).split('\r\n').map(r=>r.match(/"(?:[^"]|"")*"/g));
 assert.equal(rows[0].length,rows[1].length);
 assert.equal(rows[1][rows[0].indexOf('"恢复后校正ms"')],'"20"');
 assert.equal(rows[1][rows[0].indexOf('"恢复后几何ms"')],'"8"');
 assert.equal(rows[1][rows[0].indexOf('"恢复后ZXingms"')],'"12"');
 assert.equal(rows[1][rows[0].indexOf('"结构灰度ZXingms"')],'"6"');
 assert.equal(qrStatisticsJSON([item]).records[0].statistics.manualReview.notes,'manual');
 assert.equal(trace.record.settings.continuousModelLimit,3);
 assert.equal(createQRStatistics({name:'old'},null,{},{}).record.settings.continuousResample,true);
 assert.equal(trace.record.settings.restoration.maxFilters,RESTORATION_LIMITS.filters);
 assert.equal(trace.record.settings.restoration.maxEdge,RESTORATION_LIMITS.maxEdge);
 assert.equal(trace.record.settings.restoration.maxRegions,RESTORATION_LIMITS.maxRegions);
});

test('production pipeline ignores retired switches and keeps TPS opt-in',()=>{
 assert.deepEqual(normalizeQROptions(),{useTPS:false,detailedRecovery:false});
 assert.deepEqual(normalizeQROptions(null),{useTPS:false,detailedRecovery:false});
 assert.deepEqual(normalizeQROptions({reordered:false,useTPS:true}),{useTPS:true,detailedRecovery:false});
 assert.deepEqual(normalizeQROptions({useTPS:false,detailedRecovery:true}),{useTPS:false,detailedRecovery:true});
 const trace=createQRStatistics({name:'restored'},null,{}, {reordered:false});
 assert.equal(trace.record.settings.reordered,true);
 assert.equal(trace.record.settings.fullVariants,1);
 assert.equal(trace.record.settings.pipeline,'region-first');
 const deep=createQRStatistics({name:'deep'},null,{}, {detailedRecovery:true});
 assert.equal(deep.record.settings.restoration.maxEdge,RESTORATION_LIMITS.detailedEdge);
 assert.equal(deep.record.settings.restoration.maxFilters,RESTORATION_LIMITS.detailedFilters);
 assert.equal(deep.record.settings.restoration.imageBudgetMs,RESTORATION_LIMITS.detailedImageMs);
 assert.equal(trace.record.settings.restoredGeometry.enabled,false);
 assert.equal(deep.record.settings.restoredGeometry.enabled,true);
 for(const key of ['maxEdge','maxRegions','maxCandidates','budgetMs','imageBudgetMs','probeMs','geometryMs'])
  assert.equal(deep.record.settings.restoredGeometry[key],RESTORED_GEOMETRY_LIMITS[key]);
 assert.equal(trace.record.settings.moduleRecovery.enabled,false);
 assert.equal(deep.record.settings.moduleRecovery.enabled,true);
 assert.equal(trace.record.settings.structureSampling.enabled,false);
 assert.equal(deep.record.settings.structureSampling.enabled,true);
 for(const key of ['baseEdge','maxEdge','maxRegions','maxModels','maxAttempts','regionMs','imageMs','geometryMs'])
  assert.equal(deep.record.settings.structureSampling[key],STRUCTURE_DECODER_LIMITS[key]);
 for(const key of ['maxModels','maxAttempts','budgetMs'])
  assert.equal(deep.record.settings.moduleRecovery[key],MODULE_RECOVERY_LIMITS[key]);
});

test('mandatory structures calibrate gray levels without replacing unknown module values',()=>{
 const n=21;
 // Use two pixels/module to keep the bilinear footprint inside each cell.
 const w=58,pixels=new Float64Array(w*w).fill(100),cell=(x,y,v)=>{
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)pixels[((y+4)*2+dy)*w+(x+4)*2+dx]=v;
 };
 for(const [left,top]of[[0,0],[n-7,0],[0,n-7]])for(let y=0;y<7;y++)for(let x=0;x<7;x++)
  cell(left+x,top+y,Math.max(Math.abs(x-3),Math.abs(y-3))!==2?40:200);
 for(let k=8;k<n-8;k++){cell(k,6,k%2===0?40:200);cell(6,k,k%2===0?40:200);}
 const model={dimension:n,map:(x,y)=>({x:(x+4)*2,y:(y+4)*2}),groupIndex:0,axis:0,curvature:.4};
 const levels=fitStructureLevels(model,pixels,w,w);
 assert.ok(Math.abs(levels.black-40)<1e-8);assert.ok(Math.abs(levels.white-200)<1e-8);
 const before=pixels.slice(),trials=[...iterateStructureSampling([model,{...model,cutoff:.75}],pixels,w,w)];
 assert.equal(trials.length,4);assert.equal(trials[0].model.samples[12*n+12],.375);
 assert.deepEqual(pixels,before);
 const dimmed=pixels.map(v=>v*.4+20),again=[...iterateStructureSampling([model],dimmed,w,w)];
 assert.ok(again[0].model.samples.every((v,i)=>Math.abs(v-trials[0].model.samples[i])<1e-10));
 assert.equal(fitStructureLevels(model,new Float64Array(pixels.length).fill(120),w,w),null);
 assert.equal(fitStructureLevels({...model,map:()=>({x:-1,y:2})},pixels,w,w),null);
 assert.deepEqual([...iterateStructureSampling([model],pixels,w,w,{expired:()=>true})],[]);
});

test('structure decoding records budget skips and runtime errors separately and releases canvas',async()=>{
 const old=globalThis.document,canvas={width:0,height:0,getContext:()=>({drawImage(){throw Error('drawing failed');}})};
 globalThis.document={createElement:()=>canvas};
 try{
  const skipped={};assert.deepEqual(await decodeStructureRegion({}, {left:0,top:0,width:100,height:100},{statistics:skipped,budgetMs:0}),[]);
  assert.equal(skipped.status,'skipped');assert.equal(skipped.attempted,0);assert.equal(canvas.width,0);
  const failed={};await assert.rejects(decodeStructureRegion({}, {left:0,top:0,width:100,height:100},{statistics:failed}),/drawing failed/);
  assert.equal(failed.status,'error');assert.equal(failed.reason,'runtime-error');
  assert.equal(canvas.width,1);assert.equal(canvas.height,1);
 }finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}
});

test('structure sampling does not enlarge or repeat a small native ROI',async()=>{
 const before={document:globalThis.document,ImageData:globalThis.ImageData};
 globalThis.ImageData??=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
 const canvas={width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(8*8*4).fill(255),width:8,height:8})})};
 globalThis.document={createElement:()=>canvas};
 try{
  const statistics={};assert.deepEqual(await decodeStructureRegion({}, {left:0,top:0,width:8,height:8},{statistics}),[]);
  assert.equal(statistics.tiers.length,1);assert.equal(statistics.tiers[0].actualEdge,8);
  assert.equal(statistics.attempted,0);assert.equal(statistics.status,'undecoded');
 }finally{for(const [key,value]of Object.entries(before))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});

test('module recovery preserves flat brightness, geometry and caller samples, deduplicating identical geometry',()=>{
 const old=globalThis.ImageData;
 globalThis.ImageData??=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
 try{
  const samples=new Float64Array(21*21).fill(.5),map=()=>({x:1,y:2});
  const model={dimension:21,samples,map,groupIndex:0,axis:0,curvature:.4};
  const trials=[...iterateModuleRecovery([model,{...model,cutoff:.65}])];
  assert.equal(trials.length,15);assert.ok(trials.every(t=>t.model.map===map));
  assert.ok(trials.every(t=>t.model.samples.every(v=>Math.abs(v-128/255)<1/255)));
  assert.ok(samples.every(v=>v===.5));
  assert.deepEqual(trials.slice(0,5).map(t=>t.recovery.cutoff),[.4,.45,.5,.55,.6]);
 }finally{if(old===undefined)delete globalThis.ImageData;else globalThis.ImageData=old;}
});

test('module recovery rejects malformed grids and respects an exhausted budget before reading samples',()=>{
 const samples=new Float64Array(21*21).fill(.5);samples[3]=NaN;
 assert.deepEqual([...iterateModuleRecovery([{dimension:21,samples}])],[]);
 assert.deepEqual([...iterateModuleRecovery([{dimension:22,samples:new Float64Array(484)}])],[]);
 const invalid={get samples(){assert.fail('budget must be checked first');}};
 assert.deepEqual([...iterateModuleRecovery([invalid],{expired:()=>true})],[]);
});

test('finder structure ranking prefers the known pattern over flat, inverted or invalid samples',()=>{
 const width=72,height=72,data=new Uint8ClampedArray(width*height*4).fill(255);
 const finders=[{x:14,y:14},{x:54,y:14},{x:14,y:54}];
 for(const center of finders)for(let y=-7;y<=7;y++)for(let x=-7;x<=7;x++){
  const radius=Math.max(Math.abs(x),Math.abs(y)),value=radius<3||radius>=5&&radius<7?0:255;
  const i=((center.y+y)*width+center.x+x)*4;data[i]=data[i+1]=data[i+2]=value;
 }
 const image={width,height,data},diagnostics={finders,moduleSize:2};
 assert.ok(finderQuality(image,diagnostics)>.99);
 const inverted={...image,data:data.map((v,i)=>i%4===3?255:255-v)};
 assert.ok(finderQuality(inverted,diagnostics)<finderQuality(image,diagnostics));
 assert.equal(finderQuality({...image,data:new Uint8ClampedArray(data.length).fill(255)},diagnostics),0);
 assert.equal(finderQuality(image,{finders:finders.map(()=>({x:1,y:1})),moduleSize:2}),0);
 assert.equal(finderQuality(image,{finders:[...finders.slice(0,2),{x:NaN,y:1}],moduleSize:2}),0);
 assert.equal(finderQuality(image,{finders,moduleSize:Infinity}),0);
});

test('restored geometry respects exhausted budget before allocating a canvas',async()=>{
 const old=globalThis.document;
 globalThis.document={createElement:()=>assert.fail('must not allocate after budget exhaustion')};
 try{
  const statistics={};
  assert.deepEqual(await decodeRestoredGeometry({}, {width:100,height:100,left:0,top:0},{statistics,budgetMs:0}),[]);
  assert.equal(statistics.status,'skipped');assert.equal(statistics.reason,'restored-geometry-budget');
  assert.equal(statistics.probed,0);assert.equal(statistics.attempted,0);
 }finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}
});

test('restored geometry records runtime failure separately and releases the working canvas',async()=>{
 const old=globalThis.document,canvas={width:0,height:0,getContext:()=>({drawImage(){throw new Error('canvas failure');}})};
 globalThis.document={createElement:()=>canvas};
 try{
  const statistics={};
  await assert.rejects(decodeRestoredGeometry({}, {width:100,height:100,left:0,top:0},{statistics}),/canvas failure/);
  assert.equal(statistics.status,'error');assert.equal(statistics.reason,'runtime-error');
  assert.equal(canvas.width,1);assert.equal(canvas.height,1);
 }finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}
});

test('restoration records budget exhaustion and runtime errors as distinct outcomes',async()=>{
 const before={document:globalThis.document,window:globalThis.window};
 const fakeCanvas={width:1,height:1,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(256),width:8,height:8})})};
 globalThis.document={createElement:()=>fakeCanvas};
 globalThis.window={ZXingWASM:{readBarcodes:async()=>[]}};
 const crop={left:0,top:0,width:8,height:8};
 try{
  const skipped={};assert.deepEqual(await decodeBlurredRegion({},crop,{statistics:skipped,budgetMs:0}),[]);
  assert.equal(skipped.status,'skipped');assert.equal(skipped.reason,'restoration-budget');
  assert.equal(skipped.filtersAttempted,0);
  globalThis.window.ZXingWASM.readBarcodes=async()=>{throw new Error('reader failure');};
  const failed={};await assert.rejects(decodeBlurredRegion({},crop,{statistics:failed}),/reader failure/);
  assert.equal(failed.status,'error');assert.equal(failed.reason,'runtime-error');
 }finally{
  for(const [key,value]of Object.entries(before))if(value===undefined)delete globalThis[key];else globalThis[key]=value;
 }
});

test('small native regions are not enlarged or retried at an equivalent tier',async()=>{
 const before={document:globalThis.document,window:globalThis.window,ImageData:globalThis.ImageData};
 globalThis.ImageData??=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
 const canvas={width:1,height:1,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(256).fill(255),width:8,height:8})})};
 globalThis.document={createElement:()=>canvas};globalThis.window={ZXingWASM:{readBarcodes:async()=>[]}};
 try{
  const statistics={};await decodeBlurredRegion({}, {left:0,top:0,width:8,height:8},{statistics,budgetMs:10000,detailedRecovery:true});
  assert.equal(statistics.tiers.length,1);assert.equal(statistics.tiers[0].actualEdge,8);
  assert.equal(statistics.filtersAttempted,17);assert.equal(statistics.status,'undecoded');
 }finally{for(const [key,value]of Object.entries(before))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
