// PDF pages become ordinary local image Files; no API or upload is involved.
const MAX_PDF_BYTES=50*1024*1024,MAX_PAGES=100,MAX_RENDER_BYTES=256*1024*1024;
let pdfLibrary;
export const isPDF=file=>file.type==='application/pdf'||/\.pdf$/i.test(file.name||'');
export const acceptsFile=file=>isPDF(file)||file.type?.startsWith('image/');
const abortError=()=>new DOMException('已停止导入','AbortError');
function check(signal){if(signal?.aborted)throw abortError();}
async function loadPDF(){
    if(!pdfLibrary)pdfLibrary=import('../vendor/pdfjs-6.4.299/build/pdf.min.mjs').then(library=>{
        library.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdfjs-6.4.299/build/pdf.worker.min.mjs',import.meta.url).href;
        return library;
    }).catch(error=>{pdfLibrary=null;throw new Error('PDF 运行库加载失败：'+error.message);});
    return pdfLibrary;
}
export function pageViewport(page){
    const natural=page.getViewport({scale:1});
    if(!Number.isFinite(natural.width)||!Number.isFinite(natural.height)||natural.width<=0||natural.height<=0)throw new Error('PDF 页面尺寸无效');
    const scale=Math.min(3,3200/Math.max(natural.width,natural.height),Math.sqrt(9_000_000/(natural.width*natural.height)));
    return page.getViewport({scale});
}
async function* renderPDF(file,signal,onProgress,budget){
    if(file.size>MAX_PDF_BYTES)throw new Error('PDF 文件不能超过 50 MiB');
    const library=await loadPDF();check(signal);
    const data=new Uint8Array(await file.arrayBuffer());check(signal);
    const assetBase=new URL('../vendor/pdfjs-6.4.299/',import.meta.url);
    const loading=library.getDocument({data,isEvalSupported:false,enableHWA:false,
        cMapUrl:new URL('cmaps/',assetBase).href,cMapPacked:true,
        standardFontDataUrl:new URL('standard_fonts/',assetBase).href,wasmUrl:new URL('wasm/',assetBase).href});
    let password=false,renderTask=null;
    loading.onPassword=()=>{password=true;void loading.destroy().catch(()=>{});};
    const abort=()=>{renderTask?.cancel();void loading.destroy().catch(()=>{});};
    signal?.addEventListener('abort',abort,{once:true});
    try{
        const pdf=await loading.promise;check(signal);
        if(pdf.numPages>MAX_PAGES-budget.pages)throw new Error('一次导入的 PDF 页面总数不能超过 100 页，请拆分文件');
        budget.pages+=pdf.numPages;
        for(let number=1;number<=pdf.numPages;number++){
            check(signal);onProgress('正在转换 '+file.name+' · 第 '+number+' / '+pdf.numPages+' 页');
            const page=await pdf.getPage(number),canvas=document.createElement('canvas');
            try{
                const viewport=pageViewport(page);canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));
                renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'});
                await renderTask.promise;renderTask=null;check(signal);
                const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('PDF 页面转图片失败')),'image/png'));
                check(signal);budget.bytes+=blob.size;
                if(budget.bytes>MAX_RENDER_BYTES)throw new Error('本次 PDF 页面图片累计超过 256 MiB，请拆分导入');
                const stem=file.name.replace(/\.pdf$/i,'')||'document',index=String(number).padStart(Math.max(3,String(pdf.numPages).length),'0');
                yield {file:new File([blob],stem+'-第'+index+'页.png',{type:'image/png',lastModified:file.lastModified}),source:{type:'pdf',name:file.name,page:number,pages:pdf.numPages}};
            }finally{renderTask=null;canvas.width=canvas.height=1;page.cleanup();}
            await new Promise(resolve=>setTimeout(resolve,0));
        }
    }catch(error){if(signal?.aborted)throw abortError();if(password)throw new Error('PDF 需要密码，请先解锁文件后再导入');throw error;}
    finally{signal?.removeEventListener('abort',abort);await loading.destroy().catch(()=>{});}
}
export async function importFiles(files,{signal,onProgress=()=>{},onItem}){
    const budget={pages:0,bytes:0},errors=[];let added=0;
    for(const file of Array.from(files||[])){
        check(signal);
        try{
            if(isPDF(file)){for await(const item of renderPDF(file,signal,onProgress,budget)){await onItem(item.file,item.source);added++;}}
            else if(file.type?.startsWith('image/')){await onItem(file,null);added++;}
            else errors.push((file.name||'未知文件')+'：格式不支持');
        }catch(error){if(signal?.aborted||error.name==='AbortError')throw Object.assign(abortError(),{added,errors});errors.push(file.name+'：'+error.message);}
    }
    return {added,errors};
}
export function createFileImport({status,canStart,onLock,onItem,onComplete}){
    let controller=null;
    const stop=document.createElement('button');stop.type='button';stop.className='secondary import-stop';stop.textContent='停止导入';stop.hidden=true;
    status.after(stop);stop.onclick=()=>controller?.abort();
    const help=document.createElement('details'),summary=document.createElement('summary'),note=document.createElement('p');
    help.className='context-help';summary.textContent='PDF 导入说明';note.textContent='在本机逐页转为图片：单个 PDF 最多 50 MiB，一次最多 100 页；支持停止导入并保留已完成页面。导出为图片，密码保护文件请先解锁。';
    help.append(summary,note);status.parentElement?.after(help);
    return {
        isBusy:()=>Boolean(controller),
        async add(files){
            if(controller||!canStart())return;
            if(!Array.from(files||[]).some(acceptsFile)){status.textContent='请选择图片或 PDF 文件。';return;}
            controller=new AbortController();onLock(true);stop.hidden=false;
            let result;
            try{result=await importFiles(files,{signal:controller.signal,onItem,onProgress:text=>{status.textContent=text;}});}
            catch(error){result={added:error.added||0,errors:error.errors||[error.message],cancelled:error.name==='AbortError'};}
            finally{controller=null;stop.hidden=true;onLock(false);}
            onComplete(result);
        }
    };
}
