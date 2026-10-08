export function pixelBox(bbox, width, height) {
    if (!Array.isArray(bbox) || bbox.length!==4 || !bbox.every(n=>Number.isFinite(n)&&n>=0&&n<=1000) ||
        bbox[2]<=bbox[0] || bbox[3]<=bbox[1]) throw new Error('检测坐标无效');
    const left=Math.floor(bbox[0]*width/1000),top=Math.floor(bbox[1]*height/1000);
    const right=Math.min(width,Math.ceil(bbox[2]*width/1000)),bottom=Math.min(height,Math.ceil(bbox[3]*height/1000));
    return {left,top,right,bottom,width:right-left,height:bottom-top};
}
export async function detectObjects(image, prompt, token, signal) {
    const scale=Math.min(1,1024/Math.max(image.width,image.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    try {
        const response=await fetch('/api/semantic-detect',{method:'POST',signal,
            headers:{'Content-Type':'application/json','X-Semantic-Token':token},
            body:JSON.stringify({image:canvas.toDataURL('image/jpeg',0.85),prompt,width:canvas.width,height:canvas.height})});
        let data;
        try { data=await response.json(); } catch { throw Object.assign(new Error('接口没有返回 JSON；本地 Python 静态服务器不支持此接口，请在部署后的 Worker 网站测试'),{status:response.status}); }
        if(!response.ok)throw Object.assign(new Error(data.error||'检测失败'),{status:response.status});
        if(data.coordinateSystem!=='normalized-1000'||!Array.isArray(data.objects)||data.objects.length>20)throw new Error('接口坐标格式异常');
        data.objects=data.objects.map(object=>({...object,box:pixelBox(object.bbox,image.width,image.height)}));
        return data;
    } finally {canvas.width=canvas.height=1;}
}
const cell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
export function semanticCSV(items) {
    const rows=[['filename','prompt','id','label','left','top','right','bottom','model','crop_file']];
    items.forEach((item,index)=>{for(const object of item.result?.objects||[])
        rows.push([item.file.name,item.result.prompt,object.id,object.label,object.box.left,object.box.top,object.box.right,object.box.bottom,item.result.model,
            item.crops?.some(c=>c.id===object.id)?String(index+1).padStart(3,'0')+'/object-'+object.id+'.png':'']);});
    return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
