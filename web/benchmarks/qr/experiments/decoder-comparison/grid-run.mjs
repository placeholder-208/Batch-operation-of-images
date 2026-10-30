// Offline diagnostic: identical generated images/grids for every decoder.
// Candidate crops come from a completed product run, never annotation corners.
import fs from 'node:fs/promises';
import path from 'node:path';
import {root,hash,loadImage,crop,metrics,merge,opt,createCPP} from './common.mjs';
import {createJSQR,createZXingJS} from './js-adapters.mjs';
import {createZBar} from './zbar-adapter.mjs';
import {createQuirc} from './quirc-adapter.mjs';
import {restorationFilters} from '../../../../js/blur-restoration.js';
import {spectrum,filterFrequency} from '../../../../js/blur-frequency.js';
import {finderQuality} from '../../../../js/restored-geometry.js';
import {analyzeCurvedImage,renderCurvedModel,renderContinuousModel} from '../../../../js/curved-region.js';
import {iterateModuleRecovery} from '../../../../js/module-recovery.js';

const output=opt('output','benchmarks/qr/results/local-decoders-generated.jsonl');
const baseline=(await fs.readFile(process.env.QR_COMPARE_BASELINE||
    'benchmarks/qr/results/local-production-3.14-detailed-results.jsonl','utf8')).trim().split('\n').map(JSON.parse);
const manifest=JSON.parse(await fs.readFile('benchmarks/qr/results/local-manifest.json','utf8'));
const names=opt('files','').split(',').filter(Boolean),readers=[],initialization=[];
for(const factory of [
    ()=>createCPP(),
    ()=>createJSQR({modulePath:process.env.QR_JSQR_MODULE||'file:///tmp/xincai-decoder-comparison/js/node_modules/jsqr/dist/jsQR.js'}),
    ()=>createZBar({modulePath:process.env.QR_ZBAR_MODULE||'/tmp/xincai-decoder-comparison/main/node_modules/@undecaf/zbar-wasm/dist/main.mjs'}),
    ()=>createQuirc({modulePath:process.env.QR_QUIRC_MODULE||'/tmp/xincai-decoder-comparison/quirc/node_modules/quirc/dist/libquirc.wasm'}),
    ()=>createZXingJS({modulePath:process.env.QR_ZXING_JS_MODULE||'file:///tmp/xincai-decoder-comparison/js/node_modules/@zxing/library/cjs/index.js'})
]){
    const began=performance.now(),reader=await factory();readers.push(reader);
    initialization.push({name:reader.name,version:reader.version,wasmVersion:reader.wasmVersion,elapsedMs:performance.now()-began});
}
await fs.writeFile(output,'');
const append=record=>fs.appendFile(output,JSON.stringify(record)+'\n');
const bitsOf=model=>Uint8Array.from(model.samples,value=>Number(value<model.cutoff));
const rgba=rendered=>new ImageData(rendered.data,rendered.width,rendered.height);
const diagnosticsOf=(reader,raw)=>{
    const diagnostic=raw.diagnostics||reader.lastDiagnostics;
    if(!diagnostic)return null;
    const {candidates,...rest}=diagnostic;
    return {...rest,...(candidates?{candidates:candidates.map(c=>({dimension:c.dimension,error:c.error,errorName:c.errorName}))}:{})};
};
try{
    // Extract a known-clear payload, then regenerate its uncorrupted QR matrix.
    // A sampled photo grid can retain damaged finder bits, so it is not a
    // reliable all-readers initialization control. No test failure uses GT.
    const controlFile='curved/image008.jpg',quirc=readers.find(r=>r.name==='quirc');
    const original=await loadImage(path.join(root,'test/QRcode',controlFile));
    const control=crop(original,{left:0,top:0,width:original.width,height:original.height},800);
    const extracted=await quirc.decodeWithDiagnostics(control.image);
    const reference=extracted.codes[0],sampledGrid=extracted.candidates.find(c=>!c.error);
    if(!reference||!sampledGrid)throw Error('quirc could not extract the clear grid control');
    const imported=await import(process.env.QR_ZXING_JS_MODULE||'file:///tmp/xincai-decoder-comparison/js/node_modules/@zxing/library/cjs/index.js');
    const library=imported.QRCodeWriter?imported:imported.default;
    const matrix=new library.QRCodeWriter().encode(reference.text,library.BarcodeFormat.QR_CODE,0,0,
        new Map([[library.EncodeHintType.MARGIN,0]]));
    const dimension=matrix.getWidth(),grid={dimension,bits:Uint8Array.from({length:dimension*dimension},(_,i)=>Number(matrix.get(i%dimension,Math.floor(i/dimension))))};
    const expectedHash=hash(reference.text),samples=Float64Array.from(grid.bits,value=>1-value);
    const rendered=rgba(renderCurvedModel({dimension:grid.dimension,samples,cutoff:.5}));
    for(const reader of readers){
        const found=await reader.decode(rendered),hashes=found.map(c=>hash(c.text));
        if(!hashes.includes(expectedHash))throw Error('Generated image control failed: '+reader.name);
        await append({type:'control',reader:reader.name,path:'rendered-image',file:controlFile,
            decoded:hashes.length,payloadHashes:hashes});
    }
    for(const reader of readers.filter(r=>['quirc','zxing-js'].includes(r.name))){
        const found=await reader.decodeGrid(grid),hashes=found.map(c=>hash(c.text));
        if(!hashes.includes(expectedHash))throw Error('Direct bitgrid control failed: '+reader.name);
        await append({type:'control',reader:reader.name,path:'direct-grid',file:controlFile,
            decoded:hashes.length,payloadHashes:hashes});
    }
    const pure=await readers[0].decode(rendered,{pure:true});
    if(!pure.some(c=>hash(c.text)===expectedHash))throw Error('CPP pure rendered control failed');
    await append({type:'control',reader:readers[0].name,path:'cpp-pure-rendered',file:controlFile,
        decoded:pure.length,payloadHashes:pure.map(c=>hash(c.text))});
    const sampledImage=rgba(renderCurvedModel({dimension:sampledGrid.dimension,
        samples:Float64Array.from(sampledGrid.bits,value=>1-value),cutoff:.5}));
    for(const pure of [false,true]){
        const found=await readers[0].decode(sampledImage,{pure});
        await append({type:'sampled-grid-control',reader:readers[0].name,path:pure?'cpp-pure-rendered':'rendered-image',
            file:controlFile,decoded:found.length,payloadHashes:found.map(c=>hash(c.text)),diagnostics:diagnosticsOf(readers[0],found)});
    }
    control.canvas.width=control.canvas.height=1;
    if(process.argv.includes('--control-only')){
        console.log('Generated-image, direct-grid and CPP pure controls passed.');
    }else{
        const rows=baseline.filter(row=>row.matched<row.groundTruth&&(!names.length||names.includes(row.file)));
        for(const row of rows){
            const filename=path.join(root,'test/QRcode',row.file),entry=manifest.entries.find(e=>e.hash===row.sha256);
            if(hash(await fs.readFile(filename))!==row.sha256)throw Error('Image changed: '+row.file);
            const original=await loadImage(filename);
            for(const region of row.record.regions.filter(r=>!r.covered&&r.crop)){
                const began=performance.now(),working=crop(original,region.crop,384),shared={
                    type:'generated-region',file:row.file,sha256:row.sha256,regionId:region.id,crop:region.crop,
                    cachedDetection:true,diagnosticOnly:true,width:working.image.width,height:working.image.height,
                    initialization,selection:{maxEdge:384,originalIncluded:true,filters:17,maxCandidates:4,
                        probeMs:200,geometryMs:600,maxModels:12,moduleRecovery:{maxTrialsPerCandidate:180,wallClockLimit:false}},probes:[],fitting:[],errors:[]};
                const routes=[...readers.map(reader=>({reader,path:'rendered-image'})),
                    {reader:readers[0],path:'cpp-pure-rendered'},
                    ...readers.filter(r=>['quirc','zxing-js'].includes(r.name)).map(reader=>({reader,path:'direct-grid'}))];
                const states=routes.map(({reader,path:route})=>({reader:reader.name,version:reader.version,
                    path:route,codes:[],attempts:[],decodeMs:0,errors:[],solved:false}));
                const attempts=async(context,model,{samplingMode,recovery}={})=>{
                    let rendered,bits;
                    try{
                        if(samplingMode==='continuous-gray')rendered=renderContinuousModel(model,model.map,
                            context.gray,working.image.width,working.image.height);
                        else {bits=bitsOf(model);rendered=renderCurvedModel(model);}
                        if(!rendered){shared.errors.push({phase:'render',samplingMode,reason:'invalid-samples',model:context.modelId});return;}
                    }catch(error){shared.errors.push({phase:'render',samplingMode,error:error.message||String(error),model:context.modelId});return;}
                    const image=rgba(rendered),grid=bits?{bits,dimension:model.dimension}:null;
                    const imageHash=hash(image.data),gridHash=bits?hash(bits):null;
                    for(const [index,{reader,path:route}]of routes.entries()){
                        const state=states[index];if(state.solved||route==='direct-grid'&&!grid)continue;
                        const stamp={samplingMode,recovery,candidate:context.candidateId,model:context.modelId,
                            dimension:model.dimension,axis:model.axis,curvature:model.curvature,cutoff:model.cutoff,
                            imageHash,gridHash};
                        const started=performance.now();
                        try{
                            const raw=route==='direct-grid'?await reader.decodeGrid(grid):
                                await reader.decode(image,{pure:route==='cpp-pure-rendered',maxSymbols:1});
                            const elapsedMs=performance.now()-started;state.decodeMs+=elapsedMs;
                            const found=raw.filter(code=>typeof code.text==='string'&&code.text.length).map(code=>{
                                const outer=[{x:0,y:0},{x:model.dimension,y:0},{x:model.dimension,y:model.dimension},{x:0,y:model.dimension}];
                                const gridPoints=route==='direct-grid'?outer:code.points?.length===4?
                                    code.points.map(p=>({x:p.x/8-4,y:p.y/8-4})):outer;
                                return {payloadHash:hash(code.text),points:gridPoints.map(p=>working.map(model.map(p.x,p.y))),
                                    positionKind:'model-grid-derived',localization:route==='direct-grid'?'external-model-outer-grid':
                                        code.points?.length===4?'decoder-quad-in-rendered-grid':'external-model-outer-grid',...stamp};
                            });
                            merge(state.codes,found);state.solved=found.length>0;
                            state.attempts.push({...stamp,elapsedMs,decoded:raw.length,positioned:found.length,
                                status:found.length?'decoded':'undecoded',diagnostics:diagnosticsOf(reader,raw)});
                        }catch(error){
                            const elapsedMs=performance.now()-started;state.decodeMs+=elapsedMs;
                            const detail={...stamp,elapsedMs,status:'runtime-error',error:error.message||String(error)};
                            state.attempts.push(detail);state.errors.push(detail);
                        }
                    }
                };
                try{
                    const start=performance.now(),input=spectrum(working.image),selected=[];
                    for(const [index,config]of restorationFilters().entries()){
                        const image=filterFrequency(input,config),probeBegan=performance.now();
                        try{
                            const probe=await analyzeCurvedImage(image,{probeOnly:true,geometryMs:200});
                            const quality=finderQuality(image,probe.diagnostics);
                            shared.probes.push({index,config,quality,elapsedMs:performance.now()-probeBegan,diagnostics:probe.diagnostics});
                            if(quality>0){selected.push({candidateId:index+1,config,quality,image});selected.sort((a,b)=>b.quality-a.quality);if(selected.length>4)selected.pop();}
                        }catch(error){shared.errors.push({phase:'probe',config,error:error.message||String(error)});}
                    }
                    shared.selectionMs=performance.now()-start;
                    const candidates=[{candidateId:0,config:null,quality:null,image:working.image},...selected],contexts=[];
                    for(const candidate of candidates){
                        const fittingBegan=performance.now();
                        try{
                            const {models,diagnostics}=await analyzeCurvedImage(candidate.image,{geometryMs:600,maxModels:12});
                            shared.fitting.push({candidateId:candidate.candidateId,config:candidate.config,quality:candidate.quality,
                                elapsedMs:performance.now()-fittingBegan,diagnostics,selectedModels:models.length});
                            const gray=Float64Array.from({length:candidate.image.width*candidate.image.height},(_,i)=>{
                                const data=candidate.image.data,alpha=data[i*4+3]/255;
                                return alpha*(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2])+255*(1-alpha);
                            });
                            const context={candidateId:candidate.candidateId,gray,models};contexts.push(context);
                            for(const [index,model]of models.entries())await attempts({...context,modelId:index},model,{samplingMode:'module-binary'});
                            for(const [index,model]of models.slice(0,3).entries())await attempts({...context,modelId:index},model,{samplingMode:'continuous-gray'});
                        }catch(error){shared.errors.push({phase:'geometry',candidateId:candidate.candidateId,error:error.message||String(error)});}
                        if(states.every(s=>s.solved))break;
                    }
                    // Every original binary/gray attempt precedes every module-recovery attempt.
                    for(const context of contexts){
                        if(states.every(s=>s.solved))break;
                        let count=0;
                        try{
                            for(const trial of iterateModuleRecovery(context.models)){
                                if(count++>=180||states.every(s=>s.solved))break;
                                await attempts({...context,modelId:'recovered-'+count},trial.model,
                                    {samplingMode:'module-recovery',recovery:trial.recovery});
                            }
                        }catch(error){shared.errors.push({phase:'module-recovery',candidateId:context.candidateId,error:error.message||String(error)});}
                    }
                    shared.totalMs=performance.now()-began;
                }catch(error){shared.errors.push({phase:'roi',error:error.message||String(error)});}
                finally{working.canvas.width=working.canvas.height=1;}
                for(const state of states)await append({...shared,...state,...metrics(state.codes,entry.polygons),
                    errors:[...shared.errors,...state.errors],coordinateCaution:'All output coordinates depend on the external fitted model. Direct grids do not test reader localization.'});
                console.log(row.file,region.id,states.map(s=>s.reader+'/'+s.path+':'+s.codes.length+' ('+s.attempts.length+')').join(' | '));
            }
        }
    }
}finally{for(const reader of readers)await reader.close?.();}
