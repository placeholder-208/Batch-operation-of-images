import test from 'node:test';
import assert from 'node:assert/strict';
import {maskAlpha,resizeAlphaBilinear,normalizeModelAlpha} from '../../../js/segmentation/alpha-utils.js';
import {createMaskCache} from '../../../js/segmentation/batch-cache.js';
import {paintStrokes,applyAlphaRGBA} from '../../../js/segmentation/postprocess.js';
import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('shipped FP32 asset is pinned, below the CF per-file limit, with local configuration and license',async()=>{
    const base=new URL('../../../models/segmentation/modnet/',import.meta.url);
    const bytes=await readFile(new URL('onnx/model.onnx',base));
    assert.equal(bytes.length,25888640);assert.ok(bytes.length<=25*1024*1024);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),'07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9');
    for(const path of ['config.json','preprocessor_config.json','LICENSE.txt'])await access(new URL(path,base));
});

test('portrait opacity survives thresholds and smoothing settings instead of turning opaque',()=>{
    const result={valueType:'alpha',width:3,height:1},candidate={logits:Float32Array.from([0,.2,.8])};
    assert.deepEqual([...maskAlpha(result,candidate,3,1,{threshold:-3,smooth:true})],[0,Math.fround(.2),Math.fround(.8)]);
    const inverted=maskAlpha(result,candidate,3,1,{threshold:3,invert:true,smooth:false});
    assert.ok(Math.abs(inverted[1]-.8)<1e-6);
    assert.ok(Math.abs(inverted[2]-.2)<1e-6);
    assert.equal(candidate.logits[0],0);
});
test('legacy caches with no valueType continue to interpret SAM logits',()=>{
    assert.deepEqual([...maskAlpha({width:3,height:1},{logits:Float32Array.from([-2,0,2])},3,1,{smooth:false})],[0,0,1]);
});
test('continuous opacity interpolates and round-off is bounded without hiding invalid outputs',()=>{
    assert.deepEqual([...resizeAlphaBilinear([0,1,1,0],2,2,1,1)],[.5]);
    const result=normalizeModelAlpha([-1.1920928955078125e-7,.12345,1.0000001192092896]);
    assert.deepEqual([...result.alpha],[0,Math.fround(.12345),1]);assert.equal(result.range.rounded,2);
    for(const value of [NaN,Infinity,-.01,1.01])assert.throws(()=>normalizeModelAlpha([value]));
    assert.throws(()=>resizeAlphaBilinear([NaN],1,1,2,2));
});
test('alpha and old logits caches coexist and survive persistence round-trip',async()=>{
    const cache=createMaskCache();
    const make=(id,valueType)=>({cacheRevision:id,width:2,height:2,valueType,region:[0,0,20,20],
        candidates:[{index:0,score:null,logits:Float32Array.from(valueType==='alpha'?[0,.123,.5,1]:[-2,0,1,3])}],order:[{index:0,score:null}]});
    await cache.put(1,make(1,'alpha'));await cache.put(2,make(2,undefined));
    const saved=structuredClone(cache.exportEntries()),restored=createMaskCache();restored.importEntries(saved);
    assert.equal((await restored.get(1)).valueType,'alpha');
    assert.deepEqual([...(await restored.get(1)).candidates[0].logits],[0,Math.fround(.123),.5,1]);
    assert.equal((await restored.get(2)).valueType,undefined);
    const invalid=structuredClone(saved);invalid[0].metadata.valueType='unrecognized';
    assert.throws(()=>createMaskCache().importEntries(invalid));
});
test('portrait manual edits apply after opacity and affect exported RGBA',()=>{
    const alpha=maskAlpha({valueType:'alpha',width:8,height:8},{logits:new Float32Array(64).fill(.2)},8,8);
    paintStrokes(alpha,8,8,8,8,[{mode:'add',radius:2,points:[{x:4,y:4}]}]);
    assert.ok(alpha[4*8+4]>.9);
    const rgba=new Uint8ClampedArray(64*4).fill(255);applyAlphaRGBA(rgba,alpha);
    assert.ok(rgba[(4*8+4)*4+3]>230);assert.equal(rgba[3],51);
});
