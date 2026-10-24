import test from 'node:test';
import assert from 'node:assert/strict';
import {renderContinuousModel} from '../../js/curved-region.js';
import {createQRStatistics,qrStatisticsCSV,qrStatisticsJSON,normalizeQROptions} from '../../js/qr-statistics.js';
import {deduplicateExactPolygons} from './annotation-utils.mjs';
import {RESTORATION_LIMITS,decodeBlurredRegion} from '../../js/blur-restoration.js';

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
 trace.finish([]);
 const item={file:{name:'test.jpg'},qrStatistics:trace.record};
 const csv=qrStatisticsCSV([item]);
 assert.match(csv,/人工备注/);assert.match(csv,/灰度解码ms/);assert.match(csv,/3.12-tiered-restoration/);
 assert.match(csv,/模糊恢复滤波次数/);
 const rows=csv.slice(1).split('\r\n').map(r=>r.match(/"(?:[^"]|"")*"/g));
 assert.equal(rows[0].length,rows[1].length);
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
