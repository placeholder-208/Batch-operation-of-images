import assert from 'node:assert/strict';
import {ImageData,loadImage,crop,decode,valid} from './runtime.mjs';
import {linearSpectrum,wiener,tv} from './frequency.mjs';
import {spectrum,filterFrequency} from '../../../../js/blur-frequency.js';
const data=new Uint8ClampedArray(32*32*4);
for(let i=0;i<data.length;i+=4){data[i]=(i*17)%256;data[i+1]=(i*7+37)%256;data[i+2]=(i*3+79)%256;data[i+3]=255;}
const input=new ImageData(data,32,32),config={length:5,angle:45,sigma:.6,regularization:.02};
const before=filterFrequency(spectrum(input),config),after=wiener(linearSpectrum(input,1),config);
assert.ok(after.data.every((value,i)=>Math.abs(value-before.data[i])<=1));
const constantData=new Uint8ClampedArray(32*32*4).fill(255);for(let i=0;i<constantData.length;i+=4)constantData[i]=constantData[i+1]=constantData[i+2]=137;
for(const gamma of [1,2.2]){
 const source=linearSpectrum(new ImageData(constantData,32,32),gamma);
 for(const restored of [wiener(source,config),...[...tv(source,config,{iterations:5,checkpoints:[5]})].map(v=>v.image)])
  assert.ok(restored.data.every((value,i)=>i%4===3?value===255:Math.abs(value-137)<=1));
}
const identity=[...tv(linearSpectrum(input),{},{lambda:0,iterations:5,checkpoints:[5]})].at(-1).image;
const original=filterFrequency(spectrum(input),{regularization:0});
assert.ok(identity.data.every((value,i)=>Math.abs(value-original.data[i])<=1));
const image=await loadImage('test/QRcode/curved/image008.jpg');
const control=crop(image,{left:0,top:0,width:image.width,height:image.height},384).image;
assert.ok(valid(await decode(control)).length>0);
console.log('Gamma identity, constant brightness, zero-TV identity and real decoder control passed.');
