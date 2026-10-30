import { loadSegmentationLibrary } from './runtime-library.js';
import { normalizeModelAlpha, resizeAlphaBilinear } from './alpha-utils.js';
let loading;
export async function releasePortrait(){
    if(!loading)return;
    const state=await loading.catch(()=>null);loading=null;await state?.model.dispose();
}
async function loadPortrait(report){
    if(!loading)loading=(async()=>{
        report('正在加载人物精细抠图 · MODNet FP32（约 26 MB）…');
        const library=await loadSegmentationLibrary();
        let model;
        try{
            model=await library.AutoModel.from_pretrained('modnet',{dtype:'fp32',device:'wasm',local_files_only:true,progress_callback:event=>{
                if(event.status==='progress')report('人物模型 '+Math.round(event.progress||0)+'% · '+event.file);
            }});
            const processor=await library.AutoProcessor.from_pretrained('modnet',{local_files_only:true});
            const imageProcessor=processor.image_processor||processor.feature_extractor;
            if(!imageProcessor)throw new Error('人物模型图像预处理器不可用');
            imageProcessor.size={shortest_edge:512,longest_edge:1024};
            return {library,model,processor};
        }catch(error){await model?.dispose();throw error;}
    })().catch(error=>{loading=null;throw error;});
    return loading;
}
export async function mattePortrait(canvas,report=()=>{}){
    if(Math.max(canvas.width,canvas.height)/Math.min(canvas.width,canvas.height)>16)throw new Error('人物裁剪范围过于狭长，请扩大裁剪范围后重试');
    const {library,model,processor}=await loadPortrait(report);
    let inputs,outputs;
    const start=performance.now();
    try{
        inputs=await processor(library.RawImage.fromCanvas(canvas));
        report('人物模型已就绪，正在估计连续透明度…');
        outputs=await model({input:inputs.pixel_values});
        const tensor=outputs.output;
        if(!tensor||tensor.dims.length!==4||tensor.dims[0]!==1||tensor.dims[1]!==1)throw new Error('人物模型返回了无效蒙版尺寸');
        const {alpha,range}=normalizeModelAlpha(tensor.data),[h,w]=tensor.dims.slice(-2);
        return {valueType:'alpha',engine:'modnet',width:canvas.width,height:canvas.height,
            candidates:[{index:0,score:null,logits:resizeAlphaBilinear(alpha,w,h,canvas.width,canvas.height)}],order:[{index:0,score:null}],
            elapsedMs:Math.round(performance.now()-start),inputShape:inputs.pixel_values.dims,outputRange:range};
    }finally{
        inputs?.pixel_values?.dispose();for(const tensor of Object.values(outputs||{}))tensor?.dispose?.();
    }
}
