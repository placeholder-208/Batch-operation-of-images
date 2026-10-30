import test from 'node:test';
import assert from 'node:assert/strict';
import {needsDenseDetection,denseTiles,mergeDenseRegions} from '../../../../js/dense-detection.js';
import {sampleGray,rankDensePhases,DENSE_SAMPLING_LIMITS} from '../../../../js/dense-sampling.js';
import {createQRStatistics,qrStatisticsCSV} from '../../../../js/qr-statistics.js';

test('sparse photos never trigger dense supplementation; require both density and weak detection',()=>{
 assert.equal(needsDenseDetection(Array(3),[],1280,1991),false);
 assert.equal(needsDenseDetection(Array(27),Array(2),1280,1991),true);
 assert.equal(needsDenseDetection(Array(8),Array(6),1280,1991),false);
 assert.equal(needsDenseDetection(Array(27),[],599,1991),false);
});
test('six overlapping tiles cover portrait and landscape without assuming code rows or columns',()=>{
 for(const [w,h]of [[1280,1991],[1991,1280],[1000,1000]]){
  const tiles=denseTiles(w,h);assert.equal(tiles.length,6);
  for(const t of tiles){assert.ok(t.left>=0&&t.top>=0&&t.left+t.width<=w&&t.top+t.height<=h);}
  for(let y=0;y<=h;y+=h/20)for(let x=0;x<=w;x+=w/20)assert.ok(tiles.some(t=>x>=t.left&&x<=t.left+t.width&&y>=t.top&&y<=t.top+t.height));
 }
});
test('candidate merge protects original proposals and retains distinct nearby entities',()=>{
 const original={x:0,y:0,right:100,bottom:100,score:.2};
 const duplicate={x:2,y:2,right:101,bottom:101,score:.99},next={x:105,y:0,right:205,bottom:100,score:.98};
 const result=mergeDenseRegions([original,duplicate,next],1);
 assert.deepEqual(result,[original,next]);assert.equal(result[0],original);
 assert.equal(mergeDenseRegions([{x:NaN,y:0,right:100,bottom:100,score:1}]).length,0);
 const protectedMany=Array.from({length:65},(_,i)=>({...original,x:i*200,right:i*200+100}));
 assert.deepEqual(mergeDenseRegions([...protectedMany,next],65),protectedMany);
});
test('continuous sampling uses centre-aligned bilinear values and rejects outside pixels',()=>{
 assert.equal(sampleGray([0,100,100,200],2,2,{x:.5,y:.5}),100);
 assert.ok(Number.isNaN(sampleGray([0,1,1,0],2,2,{x:-.1,y:0})));
 assert.ok(Number.isNaN(sampleGray([0,1,1,0],2,2,{x:Infinity,y:0})));
 assert.deepEqual(rankDensePhases([],[],1,1),[]);
 assert.deepEqual(rankDensePhases([{dimension:37}],[],1,1,()=>true),[]);
 assert.equal(DENSE_SAMPLING_LIMITS.maxAttempts,160);
});
test('dense statistics append columns without losing manual review or conflating parent time',()=>{
 const trace=createQRStatistics({name:'sheet.jpg',size:1},null,{},{});
 trace.record.detection={status:'ok',candidateCount:2};
 trace.record.manualReview.notes='manual';
 trace.record.denseDetection={status:'ok',elapsedMs:200,addedCandidates:28,tiles:Array.from({length:6},()=>({status:'ok'}))};
 trace.record.regions=[{covered:true,denseSampling:{status:'decoded',attempted:123}}];
 trace.record.stages.push({name:'dense_phase_total',elapsedMs:600,status:'ok',parent:true},{name:'dense_phase_decode',elapsedMs:200,status:'ok'});
 trace.finish([]);
 const rows=qrStatisticsCSV([{file:{name:'sheet.jpg'},qrStatistics:trace.record}]).slice(1).split('\r\n').map(row=>row.match(/"(?:[^"]|"")*"/g).map(x=>x.slice(1,-1)));
 const values=Object.fromEntries(rows[0].map((column,i)=>[column,rows[1][i]]));
 assert.equal(rows[0].length,rows[1].length);assert.equal(values['人工备注'],'manual');
 assert.equal(values['密集补检新增候选'],'28');assert.equal(values['密集相位尝试次数'],'123');
 assert.equal(values['密集相位总ms'],'600');assert.equal(values['密集相位ZXingms'],'200');
});
