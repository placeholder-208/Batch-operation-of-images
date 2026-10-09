import { boxPrompt, candidateOrder } from './mask-utils.js';
let library,model,processor,loading;
export async function loadSlimSAM(report=()=>{}) {
    if(model)return {library,model,processor};
    if(!loading)loading=(async()=>{
        report('加载独立浏览器运行库…');
        library=await import('../../vendor/segmentation/transformers.local.js');
        const {env,SamModel,AutoProcessor}=library;
        env.allowRemoteModels=false;env.allowLocalModels=true;
        env.localModelPath=new URL('../../models/segmentation/',import.meta.url).href;
        env.useBrowserCache=true;
        env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
        env.backends.onnx.wasm.wasmPaths={
            mjs:new URL('../../vendor/segmentation/ort-wasm-simd-threaded.mjs',import.meta.url).href,
            wasm:new URL('../../vendor/segmentation/ort-wasm-simd-threaded.wasm',import.meta.url).href
        };
        const progress_callback=event=>{
            if(event.status==='progress')report('下载 '+event.file+' · '+Math.round(event.progress||0)+'%');
            else if(event.status==='initiate')report('准备 '+event.file);
        };
        let nextModel;
        try {
            nextModel=await SamModel.from_pretrained('slimsam',{dtype:'q8',device:'wasm',local_files_only:true,progress_callback});
            processor=await AutoProcessor.from_pretrained('slimsam',{local_files_only:true});model=nextModel;
            report('量化模型已就绪 · 单线程 WASM');return {library,model,processor};
        }catch(error){await nextModel?.dispose();throw error;}
    })().catch(error=>{loading=null;throw error;});
    return loading;
}
export async function encodeImage(canvas,report) {
    const state=await loadSlimSAM(report),raw=state.library.RawImage.fromCanvas(canvas);
    const began=performance.now(),inputs=await state.processor(raw);
    try {
        const embeddings=await state.model.get_image_embeddings(inputs);
        return {embeddings,originalSizes:inputs.original_sizes,reshapedSizes:inputs.reshaped_input_sizes,
            width:canvas.width,height:canvas.height,elapsedMs:Math.round(performance.now()-began)};
    }finally{inputs.pixel_values?.dispose();}
}
export function releaseEncoding(encoded) {
    for(const tensor of Object.values(encoded?.embeddings||{}))tensor?.dispose?.();
}
export async function segmentBox(encoded,box,points,originalWidth,originalHeight) {
    if(!model||!processor)throw new Error('模型尚未加载');
    const began=performance.now(),{coords,labels}=boxPrompt(box,points,encoded.width/originalWidth,encoded.height/originalHeight);
    const input_points=processor.reshape_input_points([coords],encoded.originalSizes,encoded.reshapedSizes);
    const input_labels=new library.Tensor('int64',BigInt64Array.from(labels,BigInt),[1,1,labels.length]);
    let outputs,masks;
    try {
        outputs=await model({...encoded.embeddings,input_points,input_labels});
        masks=await processor.post_process_masks(outputs.pred_masks,encoded.originalSizes,encoded.reshapedSizes,{binarize:false});
        const tensor=masks[0],size=encoded.width*encoded.height,scores=Array.from(outputs.iou_scores.data);
        if(tensor.data.length!==size*scores.length)throw new Error('模型输出蒙版维度不符合预期');
        const candidates=scores.map((score,index)=>({index,score,logits:Float32Array.from(tensor.data.subarray(index*size,(index+1)*size))}));
        return {candidates,order:candidateOrder(scores),width:encoded.width,height:encoded.height,elapsedMs:Math.round(performance.now()-began)};
    } finally {
        input_points.dispose?.();input_labels.dispose?.();
        outputs?.pred_masks?.dispose?.();outputs?.iou_scores?.dispose?.();
        for(const tensor of masks||[])tensor.dispose?.();
    }
}
