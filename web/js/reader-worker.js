// Classic worker: the site's existing ZXing script exposes its global through importScripts.
let engine=null,queue=Promise.resolve();
function getEngine(){
 if(engine)return engine;
 importScripts(new URL('../zxing/index.js',self.location.href).href);
 const loaded=self.ZXingWASM;
 if(!loaded||typeof loaded.readBarcodes!=='function')throw new Error('后台 ZXing 脚本未提供解码接口');
 loaded.prepareZXingModule({overrides:{locateFile:(path,prefix)=>path.endsWith('.wasm')?new URL('../zxing/'+path,self.location.href).href:prefix+path}});
 engine=loaded;return engine;
}
async function decode(data){
 try{
  const pixels=new ImageData(new Uint8ClampedArray(data.pixels),data.width,data.height);
  const results=await getEngine().readBarcodes(pixels,data.options);
  // Only data fields consumed by this app cross the thread boundary.
  const result=results.map(item=>({text:item.text,format:item.format,isValid:item.isValid,position:item.position?{
   topLeft:{...item.position.topLeft},topRight:{...item.position.topRight},bottomRight:{...item.position.bottomRight},bottomLeft:{...item.position.bottomLeft}
  }:undefined}));
  self.postMessage({id:data.id,result});
 }catch(error){self.postMessage({id:data.id,error:error.message||String(error)});}
}
self.onmessage=({data})=>{queue=queue.then(()=>decode(data)).catch(()=>{});};
