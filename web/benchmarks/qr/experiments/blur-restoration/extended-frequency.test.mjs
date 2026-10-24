import test from 'node:test';
import assert from 'node:assert/strict';
import {spectrum,filterFrequency} from './frequency.mjs';
import {filterExtended} from './extended-frequency.mjs';
globalThis.ImageData??=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
function image(value){
 const data=new Uint8ClampedArray(8*8*4);
 for(let i=0;i<64;i++){data[4*i]=data[4*i+1]=data[4*i+2]=value??(i*17)%256;data[4*i+3]=255;}
 return {data,width:8,height:8};
}
test('anisotropic Gaussian reduces to isotropic filtering when axis spreads are equal',()=>{
 const input=spectrum(image()),a=filterExtended(input,{kind:'anisotropic',along:1.5,across:1.5,angle:30,regularization:.02});
 const b=filterFrequency(input,{sigma:1.5,regularization:.02});
 a.data.forEach((v,i)=>assert.ok(Math.abs(v-b.data[i])<=1));
});
test('experimental PSFs preserve a constant image',()=>{
 const original=image(127),input=spectrum(original);
 for(const config of [{kind:'motion',length:9,angle:30},{kind:'disk',radius:4.5},{kind:'anisotropic',along:3,across:.4,angle:60}])
  assert.deepEqual(filterExtended(input,config).data,original.data);
});
