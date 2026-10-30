let loading;
export function loadSegmentationLibrary(){
    if(!loading)loading=import('../../vendor/segmentation/transformers.local.js').then(library=>{
        const {env}=library;
        env.allowRemoteModels=false;env.allowLocalModels=true;env.useBrowserCache=true;
        env.localModelPath=new URL('../../models/segmentation/',import.meta.url).href;
        env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
        env.backends.onnx.wasm.wasmPaths={
            mjs:new URL('../../vendor/segmentation/ort-wasm-simd-threaded.mjs',import.meta.url).href,
            wasm:new URL('../../vendor/segmentation/ort-wasm-simd-threaded.wasm',import.meta.url).href
        };
        return library;
    }).catch(error=>{loading=null;throw error;});
    return loading;
}
