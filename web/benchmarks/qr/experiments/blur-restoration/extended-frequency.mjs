// Evaluation only: richer symmetric PSFs; no product pipeline imports this module.
import {fft} from '../../../../js/blur-frequency.js';
export function compactSpectrum(image){
 const {width,height,data}=image,n=2**Math.ceil(Math.log2(Math.max(width,height)));
 if(n>1024)throw new Error('Compact FFT memory limit');
 const ox=Math.floor((n-width)/2),oy=Math.floor((n-height)/2),real=new Float64Array(n*n),imag=new Float64Array(n*n);
 const mirror=(v,size)=>{if(size===1)return 0;const p=2*(size-1),k=((v%p)+p)%p;return k<size?k:p-k;};
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=(mirror(y-oy,height)*width+mirror(x-ox,width))*4,a=data[i+3]/255;
  real[y*n+x]=a*(.299*data[i]+.587*data[i+1]+.114*data[i+2])+255*(1-a);
 }
 for(let y=0;y<n;y++)fft(real.subarray(y*n,(y+1)*n),imag.subarray(y*n,(y+1)*n));
 const a=new Float64Array(n),b=new Float64Array(n);
 for(let x=0;x<n;x++){
  for(let y=0;y<n;y++){a[y]=real[y*n+x];b[y]=imag[y*n+x];}
  fft(a,b);for(let y=0;y<n;y++){real[y*n+x]=a[y];imag[y*n+x]=b[y];}
 }
 return {n,width,height,ox,oy,real,imag};
}
function inverse2(real,imag,n){
 for(let y=0;y<n;y++)fft(real.subarray(y*n,(y+1)*n),imag.subarray(y*n,(y+1)*n),true);
 const a=new Float64Array(n),b=new Float64Array(n);
 for(let x=0;x<n;x++){
  for(let y=0;y<n;y++){a[y]=real[y*n+x];b[y]=imag[y*n+x];}
  fft(a,b,true);for(let y=0;y<n;y++){real[y*n+x]=a[y];imag[y*n+x]=b[y];}
 }
}
// 2*J1(z)/z, evaluated as a bounded convergent series for the tested radii.
function diskTransfer(z){
 if(Math.abs(z)<1e-10)return 1;
 const q=z*z/4;let term=1,sum=1;
 for(let k=1;k<60;k++){term*=-q/(k*(k+1));sum+=term;if(Math.abs(term)<1e-13)break;}
 return sum;
}
export function filterExtended(source,config){
 if(config.kind==='ghost')return filterGhost(source,config);
 const {n,width,height,ox,oy}=source;
 const real=source.workReal??=new Float64Array(n*n),imag=source.workImag??=new Float64Array(n*n);
 real.set(source.real);imag.set(source.imag);
 const {kind,angle=0,regularization=.02,sigma=.6,length=0,along=1,across=.5,radius=2}=config;
 const c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180);
 const radial=kind==='disk'?Float64Array.from({length:2049},(_,i)=>diskTransfer(2*Math.PI*radius*Math.SQRT1_2*i/2048)):null;
 const gain=(fx,fy)=>{
  const u=fx*c+fy*s,v=-fx*s+fy*c;
  let h;
  if(kind==='anisotropic')h=Math.exp(-2*Math.PI*Math.PI*(along*along*u*u+across*across*v*v));
  else if(kind==='disk'){
   const i=Math.min(2047,Math.hypot(fx,fy)/Math.SQRT1_2*2048),k=Math.floor(i),t=i-k;
   h=radial[k]*(1-t)+radial[k+1]*t;
  }else{
   const t=Math.PI*length*u;
   h=(Math.abs(t)<1e-10?1:Math.sin(t)/t)*Math.exp(-2*Math.PI*Math.PI*sigma*sigma*(fx*fx+fy*fy));
  }
  return h/(h*h+regularization)*(1+regularization);
 };
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const fx=(x<=n/2?x:x-n)/n,fy=(y<=n/2?y:y-n)/n;
  let g=gain(fx,fy);if(x===n/2||y===n/2)g=(g+gain(x===n/2?fx:-fx,y===n/2?fy:-fy))/2;
  const i=y*n+x;real[i]*=g;imag[i]*=g;
 }
 inverse2(real,imag,n);
 const data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,v=real[(y+oy)*n+x+ox];data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
 }
 return new ImageData(data,width,height);
}

function filterGhost(source,{length=4,angle=0,mix=.5,sigma=.5,regularization=.02}){
 const {n,width,height,ox,oy}=source;
 const real=source.workReal??=new Float64Array(n*n),imag=source.workImag??=new Float64Array(n*n);
 real.set(source.real);imag.set(source.imag);
 const c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180);
 const gain=(fx,fy)=>{
  const t=Math.PI*length*(fx*c+fy*s),blur=Math.exp(-2*Math.PI*Math.PI*sigma*sigma*(fx*fx+fy*fy));
  const hr=Math.cos(t)*blur,hi=(2*mix-1)*Math.sin(t)*blur,d=(hr*hr+hi*hi+regularization)/(1+regularization);
  return [hr/d,-hi/d];
 };
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const fx=(x<=n/2?x:x-n)/n,fy=(y<=n/2?y:y-n)/n;
  let [a,b]=gain(fx,fy);
  if(x===n/2||y===n/2){const [a2,b2]=gain(x===n/2?fx:-fx,y===n/2?fy:-fy);a=(a+a2)/2;b=(b-b2)/2;}
  const i=y*n+x,r=real[i],im=imag[i];real[i]=r*a-im*b;imag[i]=r*b+im*a;
 }
 inverse2(real,imag,n);
 const data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,v=real[(y+oy)*n+x+ox];data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
 }
 return new ImageData(data,width,height);
}
