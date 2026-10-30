// Benchmark-only adapter for quirc@1.0.0-alpha.4's import-free WASM.
// Deliberately bypasses its JS wrapper, which returns only two of four corners.
// ABI: https://github.com/dlbeer/quirc/blob/master/lib/quirc.h
const packageVersion='1.0.0-alpha.4';
const labels={1:'iso-8859-1',4:'iso-8859-2',5:'iso-8859-3',6:'iso-8859-4',
    7:'iso-8859-5',8:'iso-8859-6',9:'iso-8859-7',10:'iso-8859-8',11:'iso-8859-9',
    13:'windows-874',15:'iso-8859-13',20:'shift-jis',26:'utf-8'};

async function loadWasm(modulePath){
    if(modulePath instanceof WebAssembly.Instance)return modulePath;
    let bytes;
    if(modulePath instanceof ArrayBuffer||ArrayBuffer.isView(modulePath))bytes=modulePath;
    else if(typeof process!=='undefined'&&process.versions?.node){
        const fs=await import('node:fs/promises');
        const filename=String(modulePath).endsWith('.wasm')?modulePath:String(modulePath).replace(/\/$/,'')+'/dist/libquirc.wasm';
        bytes=await fs.readFile(filename);
    }else{
        const response=await fetch(modulePath);
        if(!response.ok)throw new Error('quirc WASM fetch failed: '+response.status);
        bytes=await response.arrayBuffer();
    }
    return (await WebAssembly.instantiate(bytes,{})).instance;
}

export async function createQuirc({modulePath}={}){
    if(!modulePath)throw new Error('quirc modulePath must name its package directory, WASM file, bytes or instance');
    const instance=await loadWasm(modulePath),api=instance.exports;
    const required=['quirc_new','quirc_destroy','quirc_resize','quirc_begin','quirc_end','quirc_count',
        'quirc_extract','quirc_decode','quirc_code_size','quirc_data_size','malloc','free'];
    if(!api.memory||required.some(key=>typeof api[key]!=='function'))throw new Error('Unsupported quirc WASM exports');
    let q=api.quirc_new(),code=api.malloc(api.quirc_code_size()),data=api.malloc(api.quirc_data_size());
    const close=()=>{if(q)api.quirc_destroy(q);if(code)api.free(code);if(data)api.free(data);q=code=data=0;};
    if(!q||!code||!data){close();throw new Error('quirc allocation failed');}
    const cString=pointer=>{
        const memory=new Uint8Array(api.memory.buffer);let end=pointer;
        while(end<memory.length&&memory[end])end++;
        return new TextDecoder().decode(memory.subarray(pointer,end));
    };
    const errorName=error=>api.quirc_strerror?cString(api.quirc_strerror(error)):'quirc error '+error;
    const wasmVersion=api.quirc_version?cString(api.quirc_version()):'unknown';
    let lastDiagnostics=null,lastWidth=0,lastHeight=0;
    const requireOpen=()=>{if(!q)throw new Error('quirc adapter is closed');};
    const readCode=()=>{
        const view=new DataView(api.memory.buffer),points=Array.from({length:4},(_,i)=>({
            x:view.getInt32(code+i*8,true),y:view.getInt32(code+i*8+4,true)}));
        const dimension=view.getInt32(code+32,true);
        // False candidate grids need not have a valid QR dimension. They are
        // decode failures, not runtime/ABI errors. Never read beyond the struct.
        if(dimension<1||dimension>177)return {points,dimension,bits:null,invalidGrid:true};
        const bitmap=new Uint8Array(api.memory.buffer,code+36,Math.ceil(dimension*dimension/8));
        const bits=Uint8Array.from({length:dimension*dimension},(_,i)=>(bitmap[i>>3]>>(i&7))&1);
        return {points,dimension,bits};
    };
    const decodeCode=()=>{
        let error=api.quirc_decode(code,data),mirrored=false;
        // Official quirc sample retries transposed data only for ECC failure.
        if(error===4&&api.quirc_flip){api.quirc_flip(code);error=api.quirc_decode(code,data);mirrored=error===0;}
        if(error)return {error,errorName:errorName(error),mirrored:false};
        const pointer=api.quirc_data_get_payload(data),length=api.quirc_data_get_payload_len(data);
        if(length<0||pointer+length>api.memory.buffer.byteLength)throw new Error('quirc returned invalid payload bounds');
        const bytes=new Uint8Array(api.memory.buffer.slice(pointer,pointer+length));
        const eci=api.quirc_data_get_eci(data),dataType=api.quirc_data_get_data_type(data);
        const encoding=labels[eci]||(dataType===8?'shift-jis':'utf-8');
        let text;
        try{text=new TextDecoder(encoding).decode(bytes);}catch{text=new TextDecoder('utf-8').decode(bytes);}
        return {error:0,text,bytes,eci,dataType,encoding,version:api.quirc_data_get_version(data),mirrored};
    };
    const decodeWithDiagnostics=async image=>{
        requireOpen();const {width,height,data:rgba}=image;
        if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||rgba.length!==width*height*4)
            throw new Error('Invalid RGBA image');
        if(width!==lastWidth||height!==lastHeight){
            if(api.quirc_resize(q,width,height)<0)throw new Error('quirc resize allocation failed');
            lastWidth=width;lastHeight=height;
        }
        const pointer=api.quirc_begin(q,0,0),gray=new Uint8Array(api.memory.buffer,pointer,width*height);
        for(let i=0;i<gray.length;i++){
            const alpha=rgba[i*4+3]/255;
            gray[i]=Math.round(alpha*(.299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2])+255*(1-alpha));
        }
        api.quirc_end(q);const codes=[],candidates=[];
        for(let index=0,count=api.quirc_count(q);index<count;index++){
            api.quirc_extract(q,index,code);
            const extracted=readCode(),result=extracted.invalidGrid?
                {error:1,errorName:'Invalid grid size',mirrored:false}:decodeCode();
            candidates.push({...extracted,index,error:result.error,errorName:result.errorName||null,mirrored:result.mirrored});
            if(!result.error)codes.push({...result,points:extracted.points});
        }
        lastDiagnostics={extracted:candidates.length,decoded:codes.length,candidates};
        return {codes,candidates};
    };
    const decodeGrid=async({bits,dimension})=>{
        requireOpen();
        if(!Number.isInteger(dimension)||dimension<21||dimension>177||(dimension-21)%4||bits?.length!==dimension*dimension||
            !bits.every(value=>value===0||value===1))throw new Error('Invalid QR module bitmap');
        new Uint8Array(api.memory.buffer,code,api.quirc_code_size()).fill(0);
        const view=new DataView(api.memory.buffer);
        [[0,0],[dimension,0],[dimension,dimension],[0,dimension]].forEach(([x,y],i)=>{
            view.setInt32(code+i*8,x,true);view.setInt32(code+i*8+4,y,true);
        });
        view.setInt32(code+32,dimension,true);
        const bitmap=new Uint8Array(api.memory.buffer,code+36,Math.ceil(dimension*dimension/8));
        for(let i=0;i<bits.length;i++)if(bits[i])bitmap[i>>3]|=1<<(i&7);
        const result=decodeCode();
        lastDiagnostics={grid:true,dimension,error:result.error,errorName:result.errorName||null,mirrored:result.mirrored};
        return result.error?[]:[{...result,coordinateSpace:'module-grid'}];
    };
    return {name:'quirc',version:packageVersion,wasmVersion,decodeGrid,decodeWithDiagnostics,
        get lastDiagnostics(){return lastDiagnostics;},
        async decode(image){return (await decodeWithDiagnostics(image)).codes;},close};
}
