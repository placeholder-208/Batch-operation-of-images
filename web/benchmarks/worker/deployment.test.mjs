import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import worker from '../../worker.js';

const origin='https://xincai.example';
const request=(path,options)=>new Request(origin+path,options);
async function withoutErrorLog(run){
    const original=console.error;
    console.error=()=>{};
    try{return await run();}finally{console.error=original;}
}

test('deployment config includes static assets, API routing and stored logs',async()=>{
    const config=JSON.parse(await readFile(new URL('../../wrangler.jsonc',import.meta.url),'utf8'));
    assert.equal(config.assets.directory,'.');
    assert.equal(config.assets.binding,'ASSETS');
    assert.ok(config.assets.run_worker_first.includes('/api/*'));
    assert.equal(config.observability.enabled,true);
});

test('static responses preserve bytes, headers and missing-file status',async()=>{
    for(const [path,status,type,bytes] of [
        ['/',200,'text/html',new TextEncoder().encode('<!doctype html>')],
        ['/zxing/zxing_reader.wasm',200,'application/wasm',new Uint8Array([0,97,115,109])],
        ['/favicon.ico',404,'text/plain',new Uint8Array()]
    ]){
        const response=new Response(bytes,{status,headers:{'Content-Type':type}});
        const actual=await worker.fetch(request(path),{ASSETS:{fetch:async input=>{
            assert.equal(new URL(input.url).pathname,path);return response;
        }}});
        assert.equal(actual,response);
        assert.equal(actual.status,status);
        assert.equal(actual.headers.get('content-type'),type);
        assert.deepEqual(new Uint8Array(await actual.arrayBuffer()),bytes);
    }
});

test('missing or incorrectly typed assets binding returns explicit uncached 503',async()=>{
    await withoutErrorLog(async()=>{
        for(const env of [{},{ASSETS:'not-a-binding'},{ASSETS:{}}]){
            const response=await worker.fetch(request('/'),env);
            assert.equal(response.status,503);
            assert.equal(response.headers.get('X-XinCai-Error'),'assets-binding-missing');
            assert.equal(response.headers.get('Cache-Control'),'no-store');
        }
    });
});

test('asynchronous asset fetch rejection is caught without exposing exception text',async()=>{
    await withoutErrorLog(async()=>{
        const response=await worker.fetch(request('/'),{ASSETS:{fetch:async()=>{throw new Error('private-upstream-details');}}});
        assert.equal(response.status,503);
        assert.equal(response.headers.get('X-XinCai-Error'),'assets-fetch-failed');
        assert.doesNotMatch(await response.text(),/private-upstream-details/);
    });
});

test('deployment check probes homepage without forwarding browser credentials or query',async()=>{
    let cancelled=false;
    const response=await worker.fetch(request('/api/deployment-status?token=private',{headers:{Cookie:'private',Authorization:'Bearer private'}}),{
        ASSETS:{fetch:async input=>{
            assert.equal(input.url,origin+'/');
            assert.equal(input.headers.get('Cookie'),null);
            assert.equal(input.headers.get('Authorization'),null);
            return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:200});
        }},GROQ_API_KEY:'private',SEMANTIC_TEST_TOKEN:'private'
    });
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{revision:'assets-check-2026-10-24',assetsBinding:true,homepageStatus:200,ok:true});
    assert.equal(cancelled,true);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('deployment check distinguishes missing binding, missing homepage and fetch failure',async()=>{
    await withoutErrorLog(async()=>{
        const cases=[
            [{},'assets-binding-missing',undefined],
            [{ASSETS:{fetch:async()=>new Response(null,{status:404})}},'assets-homepage-unavailable',404],
            [{ASSETS:{fetch:async()=>{throw new Error('private-upstream-details');}}},'assets-fetch-failed',undefined]
        ];
        for(const [env,code,status] of cases){
            const response=await worker.fetch(request('/api/deployment-status'),env);
            assert.equal(response.status,503);
            const result=await response.json();
            assert.equal(result.ok,false);assert.equal(result.code,code);
            assert.equal(result.homepageStatus,status);
            assert.doesNotMatch(JSON.stringify(result),/private-upstream-details/);
        }
    });
});

test('deployment check rejects POST without accessing assets',async()=>{
    const response=await worker.fetch(request('/api/deployment-status',{method:'POST'}),{ASSETS:{fetch:()=>assert.fail('unexpected fetch')}});
    assert.equal(response.status,405);
});

test('existing source exclusions and API dispatch remain intact',async()=>{
    for(const [path,status] of [
        ['/worker.js',404],['/server/semantic.js',404],['/wrangler.jsonc',404],
        ['/api/unknown',404],['/api/link-preview',405],['/api/semantic-detect',405]
    ]){
        const response=await worker.fetch(request(path),{ASSETS:{fetch:()=>assert.fail('unexpected fetch')}});
        assert.equal(response.status,status,path);
    }
});
