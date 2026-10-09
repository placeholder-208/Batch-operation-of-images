import { $ } from './ui.js?v=sam-1.8';
export function createSamWorkspace(actions) {
    const tab=document.createElement('button');tab.id='samTab';tab.className='tab';tab.textContent='本地分割';tab.setAttribute('role','tab');tab.setAttribute('aria-selected','false');tab.tabIndex=-1;$('semanticTab').after(tab);
    const root=document.createElement('section');root.id='samWorkspace';root.className='workspace';root.hidden=true;
    root.style.gridTemplateColumns='minmax(0,1fr)';root.innerHTML='<section class="panel"><div class="panel-head"><h2>本地分割 · SlimSAM</h2><span class="small" id="samTransferStatus" role="status" aria-live="polite">进入后按需加载，不上传图片</span></div><iframe id="samFrame" title="本地分割与透明图片导出" style="display:block;width:100%;height:1250px;border:0" referrerpolicy="same-origin"></iframe></section>';
    $('semanticWorkspace').after(root);
    const frame=$('samFrame'),origin=location.origin;
    let loaded=false,ready=false,childBusy=false,pending=null,sequence=0,lastBusy=false;
    const busy=()=>childBusy||Boolean(pending);
    function refreshBusy(){const value=busy();if(value!==lastBusy){lastBusy=value;actions.onBusy(value);}}
    function post(data){frame.contentWindow.postMessage(data,origin);}
    function sendPending(){if(ready&&pending&&!pending.sent){pending.sent=true;post({type:'xincai-sam-input',id:pending.id,blob:pending.blob,filename:pending.filename});}}
    function load(){if(loaded)return;loaded=true;frame.src='./sam-test/index.html?embedded=1&v=1.8';}
    frame.addEventListener('load',()=>post({type:'xincai-sam-ping'}));
    tab.addEventListener('click',load);
    window.addEventListener('message',event=>{
        if(event.origin!==origin||event.source!==frame.contentWindow)return;
        const data=event.data;if(!data||typeof data.type!=='string')return;
        if(data.type==='xincai-sam-ready'){ready=true;sendPending();}
        else if(data.type==='xincai-sam-busy'){childBusy=data.busy===true;refreshBusy();}
        else if(data.type==='xincai-sam-result'&&pending&&data.id===pending.id){
            const job=pending;clearTimeout(job.timer);pending=null;refreshBusy();
            $('samTransferStatus').textContent=data.ok?'首个识别框已完成本地分割，请检查蒙版':('本地分割未完成：'+String(data.error||'请查看分割页状态'));
            data.ok?job.resolve():job.reject(new Error(String(data.error||'本地分割失败')));
        }
    });
    function openCrop(blob,filename){
        if(busy()||actions.isBlocked())return Promise.reject(new Error('其他任务正在处理，请稍后再转入本地分割'));
        if(!(blob instanceof Blob)||!blob.size)return Promise.reject(new Error('首个目标的裁图不可用'));
        return new Promise((resolve,reject)=>{
            const id='sam-'+Date.now()+'-'+(++sequence);
            const timer=setTimeout(()=>{if(pending?.id!==id)return;pending=null;refreshBusy();$('samTransferStatus').textContent='等待分割结果超时；请查看分割页。';reject(new Error('等待本地分割结果超时，任务可能仍在浏览器中运行'));},180000);
            pending={id,blob,filename,resolve,reject,timer,sent:false};refreshBusy();
            $('samTransferStatus').textContent='接收首个目标裁图，准备自动分割…';load();tab.click();sendPending();
        });
    }
    return {openCrop,isBusy:busy};
}
