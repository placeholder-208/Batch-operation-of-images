// Research-only adapters. Product code does not import these optional readers.
// Browser callers may pass loaded library namespaces instead of module URLs.
async function library(input){
    const loaded=typeof input==='string'?await import(input):input;
    if(!loaded)throw new Error('A decoder module URL or namespace is required');
    return loaded.QRCodeReader||typeof loaded==='function'?loaded:loaded.default||loaded;
}
function unwrap(value){while(value?.default&&value.default!==value)value=value.default;return value;}
function validate(image){
    if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||
        image.data?.length!==image.width*image.height*4)throw new TypeError('Invalid RGBA image');
}
function failure(error,zxing){
    for(const [key,reason]of [['NotFoundException','not-found'],['ChecksumException','checksum'],['FormatException','format']])
        if(zxing[key]&&error instanceof zxing[key])return reason;
    throw error;
}
function erase(data,width,height,points){
    const center={x:points.reduce((s,p)=>s+p.x,0)/4,y:points.reduce((s,p)=>s+p.y,0)/4};
    const polygon=points.map(p=>({x:center.x+(p.x-center.x)*1.01,y:center.y+(p.y-center.y)*1.01}));
    const left=Math.max(0,Math.floor(Math.min(...polygon.map(p=>p.x))));
    const right=Math.min(width-1,Math.ceil(Math.max(...polygon.map(p=>p.x))));
    const top=Math.max(0,Math.floor(Math.min(...polygon.map(p=>p.y))));
    const bottom=Math.min(height-1,Math.ceil(Math.max(...polygon.map(p=>p.y))));
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
        let positive=false,negative=false;
        for(let i=0;i<4;i++){
            const a=polygon[i],b=polygon[(i+1)%4],cross=(b.x-a.x)*(y+.5-a.y)-(b.y-a.y)*(x+.5-a.x);
            if(cross>0)positive=true;if(cross<0)negative=true;
        }
        if(!(positive&&negative))data.fill(255,(y*width+x)*4,(y*width+x)*4+4);
    }
}
function renderGrid({bits,dimension}){
    if(!Number.isInteger(dimension)||dimension<21||dimension>177||(dimension-21)%4||bits?.length!==dimension*dimension)
        throw new TypeError('Invalid QR module grid');
    const size=(dimension+8)*8,data=new Uint8ClampedArray(size*size*4).fill(255);
    for(let y=0;y<dimension;y++)for(let x=0;x<dimension;x++)if(bits[y*dimension+x])
        for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){
            const i=(((y+4)*8+dy)*size+(x+4)*8+dx)*4;data[i]=data[i+1]=data[i+2]=0;
        }
    return {data,width:size,height:size};
}
export async function createJSQR({modulePath}={}){
    const jsqr=unwrap(await library(modulePath));
    if(typeof jsqr!=='function')throw new Error('jsQR entry point is not callable');
    const adapter={name:'jsqr',version:'1.4.0',license:'Apache-2.0',
        multiMethod:'bounded-successful-polygon-erasure',maxSymbols:8,pureSupported:false,
        gridPath:'rendered-redetection',lastDiagnostics:null,
        async decode(image,{pure=false,maxSymbols=8}={}){
            validate(image);const data=new Uint8ClampedArray(image.data),results=[];
            const diagnostics={pureRequested:pure,pureUsed:false,method:this.multiMethod,attempted:0,failures:[]};
            for(let i=0;i<Math.min(8,maxSymbols);i++){
                diagnostics.attempted++;
                const result=jsqr(data,image.width,image.height,{inversionAttempts:'attemptBoth'});
                if(!result){diagnostics.failures.push('not-found-or-undecodable');break;}
                const location=result.location,points=[location.topLeftCorner,location.topRightCorner,location.bottomRightCorner,location.bottomLeftCorner].map(p=>({x:p.x,y:p.y}));
                if(!points.every(p=>Number.isFinite(p.x+p.y)))throw new Error('jsQR returned nonfinite corners');
                if(results.some(r=>r.text===result.data&&Math.hypot(r.points[0].x-points[0].x,r.points[0].y-points[0].y)<1))break;
                results.push({text:result.data,points,positionKind:'sample-grid-transform',version:result.version});
                erase(data,image.width,image.height,points);
            }
            this.lastDiagnostics=diagnostics;return results;
        },
        async decodeGrid(grid){
            // npm's public jsQR entry point does not expose its internal bit decoder.
            const results=await this.decode(renderGrid(grid),{pure:true,maxSymbols:1});
            this.lastDiagnostics.gridPath=this.gridPath;
            return results.map(result=>({...result,renderedPoints:result.points,points:[],positionKind:'input-grid-no-location'}));
        }
    };
    return adapter;
}
export async function createZXingJS({modulePath,detectorPath}={}){
    const zxing=await library(modulePath);
    let Detector=zxing.QRDetector||zxing.QRCodeDetector;
    if(!Detector&&typeof modulePath==='string'){
        const path=detectorPath||new URL('./core/qrcode/detector/Detector.js',modulePath).href;
        Detector=unwrap(await import(path));
    }
    if(!Detector?.createTransform)throw new Error('ZXing-JS Detector with createTransform must be supplied');
    const hints=new Map([[zxing.DecodeHintType.TRY_HARDER,true]]),reader=new zxing.QRCodeReader(),decoder=reader.getDecoder();
    const makeBitmap=(image,inverted=false)=>{
        const values=new Uint8ClampedArray(image.width*image.height);
        for(let i=0;i<values.length;i++){
            const at=i*4,alpha=image.data[at+3]/255;
            values[i]=alpha*(.299*image.data[at]+.587*image.data[at+1]+.114*image.data[at+2])+255*(1-alpha);
        }
        let source=new zxing.RGBLuminanceSource(values,image.width,image.height);
        if(inverted)source=source.invert();
        return new zxing.BinaryBitmap(new zxing.HybridBinarizer(source));
    };
    const adapter={name:'zxing-js',version:'0.23.0',license:'Apache-2.0',
        multiMethod:'bounded-successful-polygon-erasure',maxSymbols:8,pureSupported:true,
        gridPath:'direct-bitmatrix-decoder',lastDiagnostics:null,
        async decode(image,{pure=false,maxSymbols=8}={}){
            validate(image);const work={width:image.width,height:image.height,data:new Uint8ClampedArray(image.data)},results=[];
            const diagnostics={pureRequested:pure,pureUsed:pure,method:this.multiMethod,attempted:0,failures:[]};
            for(let symbol=0;symbol<Math.min(8,maxSymbols);symbol++){
                let found=null;
                for(const inverted of [false,true]){
                    diagnostics.attempted++;
                    try{
                        const bitmap=makeBitmap(work,inverted);
                        if(pure){
                            const result=reader.decode(bitmap,new Map([...hints,[zxing.DecodeHintType.PURE_BARCODE,true]]));
                            // Pure mode deliberately supplies no localization points.
                            found={text:result.getText(),points:[],positionKind:'pure-no-location'};
                        }else{
                            const detected=new Detector(bitmap.getBlackMatrix()).detect(hints);
                            const bits=detected.getBits(),n=bits.getWidth(),p=detected.getPoints();
                            const transform=Detector.createTransform(p[1],p[2],p[0],p[3]||null,n);
                            const coordinates=Float32Array.from([0,0,n,0,n,n,0,n]);transform.transformPoints(coordinates);
                            const points=Array.from({length:4},(_,i)=>({x:coordinates[i*2],y:coordinates[i*2+1]}));
                            if(!points.every(p=>Number.isFinite(p.x+p.y)))throw new Error('ZXing-JS returned nonfinite grid corners');
                            const result=decoder.decodeBitMatrix(bits,hints);
                            found={text:result.getText(),points,positionKind:'sample-grid-transform',
                                finderPoints:p.slice(0,3).map(p=>({x:p.getX(),y:p.getY()})),dimension:n};
                        }
                        break;
                    }catch(error){diagnostics.failures.push(failure(error,zxing));}
                }
                if(!found)break;
                if(results.some(r=>r.text===found.text&&found.points.length&&Math.hypot(r.points[0].x-found.points[0].x,r.points[0].y-found.points[0].y)<1))break;
                results.push(found);if(pure)break;
                erase(work.data,image.width,image.height,found.points);
            }
            this.lastDiagnostics=diagnostics;return results;
        },
        async decodeGrid({bits,dimension}){
            // Validate separately; never run finder detection or binarization here.
            if(!Number.isInteger(dimension)||dimension<21||dimension>177||(dimension-21)%4||bits?.length!==dimension*dimension)
                throw new TypeError('Invalid QR module grid');
            const matrix=new zxing.BitMatrix(dimension,dimension);
            for(let y=0;y<dimension;y++)for(let x=0;x<dimension;x++)if(bits[y*dimension+x])matrix.set(x,y);
            try{
                const result=decoder.decodeBitMatrix(matrix,hints);
                this.lastDiagnostics={gridPath:this.gridPath,attempted:1,failures:[]};
                return [{text:result.getText(),points:[],positionKind:'input-grid-no-location'}];
            }catch(error){this.lastDiagnostics={gridPath:this.gridPath,attempted:1,failures:[failure(error,zxing)]};return [];}
        }
    };
    return adapter;
}
