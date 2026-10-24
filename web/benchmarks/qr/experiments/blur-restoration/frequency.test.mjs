import test from 'node:test';
import assert from 'node:assert/strict';
import {fft,spectrum,filterFrequency} from './frequency.mjs';
globalThis.ImageData??=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
test('FFT round trip preserves real and complex signals',()=>{
 const real=Float64Array.from([1,2,-3,4,5,9,0,6]),imag=Float64Array.from([2,0,5,0,0,3,0,-2]);
 const a=real.slice(),b=imag.slice();fft(a,b);fft(a,b,true);
 a.forEach((v,i)=>assert.ok(Math.abs(v-real[i])<1e-10));
 b.forEach((v,i)=>assert.ok(Math.abs(v-imag[i])<1e-10));
});
test('FFT rejects invalid transform lengths',()=>assert.throws(()=>fft(new Float64Array(3),new Float64Array(3))));
test('identity frequency filtering preserves pixels and restoration preserves constant brightness',()=>{
 const data=new Uint8ClampedArray(8*8*4);
 for(let i=0;i<64;i++){data[4*i]=data[4*i+1]=data[4*i+2]=i*4;data[4*i+3]=255;}
 const source=spectrum({data,width:8,height:8});
 assert.deepEqual(filterFrequency(source,{sigma:0}).data,data);
 for(let i=0;i<64;i++)data[4*i]=data[4*i+1]=data[4*i+2]=127;
 const constant=spectrum({data,width:8,height:8});
 assert.deepEqual(filterFrequency(constant,{sigma:2,length:7,angle:45}).data,data);
});
test('frequency restoration rejects oversized FFT allocations',()=>{
 assert.throws(()=>spectrum({data:new Uint8ClampedArray(0),width:2000,height:1}),/memory limit/);
});
test('repeated filters keep the original spectrum and previous image results intact',()=>{
 const data=new Uint8ClampedArray(8*8*4);
 for(let i=0;i<64;i++){data[4*i]=data[4*i+1]=data[4*i+2]=(i*17)%256;data[4*i+3]=255;}
 const source=spectrum({data,width:8,height:8}),original=source.real.slice();
 const first=filterFrequency(source,{sigma:1}),saved=first.data.slice();
 filterFrequency(source,{length:5,angle:45});
 assert.deepEqual(first.data,saved);assert.deepEqual(source.real,original);
});
