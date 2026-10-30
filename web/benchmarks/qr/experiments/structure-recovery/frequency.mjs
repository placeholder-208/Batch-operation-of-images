import {fft,spectrum} from '../../../../js/blur-frequency.js';
export function fft2(real,imag,n,inverse=false){
 for(let y=0;y<n;y++)fft(real.subarray(y*n,(y+1)*n),imag.subarray(y*n,(y+1)*n),inverse);
 const a=new Float64Array(n),b=new Float64Array(n);
 for(let x=0;x<n;x++){
  for(let y=0;y<n;y++){a[y]=real[y*n+x];b[y]=imag[y*n+x];}
  fft(a,b,inverse);for(let y=0;y<n;y++){real[y*n+x]=a[y];imag[y*n+x]=b[y];}
 }
}
export function linearSpectrum(image,gamma=1){
 if(!(gamma>0))throw Error('Invalid gamma');
 const data=new Float64Array(image.data.length);
 for(let i=0;i<data.length;i+=4){
  const alpha=image.data[i+3]/255;
  const gray=alpha*(.299*image.data[i]+.587*image.data[i+1]+.114*image.data[i+2])+255*(1-alpha);
  const v=255*Math.pow(gray/255,gamma);
  data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
 }
 return {...spectrum({width:image.width,height:image.height,data}),gamma};
}
export function transfer(n,{sigma=0,length=0,angle=0}={},transform=value=>value){
 const h=new Float64Array(n*n),c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180);
 const value=(x,y)=>{
  const t=Math.PI*length*(x*c+y*s);
  return (Math.abs(t)<1e-10?1:Math.sin(t)/t)*Math.exp(-2*Math.PI*Math.PI*sigma*sigma*(x*x+y*y));
 };
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const fx=(x<=n/2?x:x-n)/n,fy=(y<=n/2?y:y-n)/n;
  h[y*n+x]=(x===n/2||y===n/2)?(transform(value(fx,fy))+transform(value(x===n/2?fx:-fx,y===n/2?fy:-fy)))/2:transform(value(fx,fy));
 }
 return h;
}
export function render(source,values,{normalized=false,gamma=source.gamma||1}={}){
 const {width,height,n,ox,oy}=source,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let v=values[(y+oy)*n+x+ox]/(normalized?1:255);
  v=255*Math.pow(Math.max(0,Math.min(1,v)),1/gamma);
  const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
 }
 return new ImageData(data,width,height);
}
export function wiener(source,config){
 const {n}=source,regularization=config.regularization??.01;
 const gains=transfer(n,config,h=>h/(h*h+regularization)*(1+regularization));
 const real=source.real.slice(),imag=source.imag.slice();
 for(let i=0;i<real.length;i++){real[i]*=gains[i];imag[i]*=gains[i];}
 fft2(real,imag,n,true);return render(source,real);
}
export function* tv(source,config,{lambda=.002,rho=.02,iterations=20,checkpoints=[5,10,20]}={}){
 const {n}=source,size=n*n,h=transfer(n,config),denominator=new Float64Array(size);
 const baseR=new Float64Array(size),baseI=new Float64Array(size),real=source.real.slice(),imag=source.imag.slice();
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=y*n+x,L=4*(Math.sin(Math.PI*x/n)**2+Math.sin(Math.PI*y/n)**2);
  denominator[i]=h[i]*h[i]+rho*L+1e-12;baseR[i]=h[i]*source.real[i]/255;baseI[i]=h[i]*source.imag[i]/255;
 }
 fft2(real,imag,n,true);
 const zx=new Float64Array(size),zy=new Float64Array(size),bx=new Float64Array(size),by=new Float64Array(size);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=y*n+x;zx[i]=(real[y*n+(x+1)%n]-real[i])/255;zy[i]=(real[((y+1)%n)*n+x]-real[i])/255;
 }
 for(let iteration=1;iteration<=iterations;iteration++){
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const i=y*n+x,left=y*n+(x+n-1)%n,up=((y+n-1)%n)*n+x;
   real[i]=zx[left]-bx[left]-zx[i]+bx[i]+zy[up]-by[up]-zy[i]+by[i];imag[i]=0;
  }
  fft2(real,imag,n);
  for(let i=0;i<size;i++){real[i]=(baseR[i]+rho*real[i])/denominator[i];imag[i]=(baseI[i]+rho*imag[i])/denominator[i];}
  fft2(real,imag,n,true);
  for(let i=0;i<size;i++)real[i]=Math.max(0,Math.min(1,real[i]));
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const i=y*n+x,dx=real[y*n+(x+1)%n]-real[i],dy=real[((y+1)%n)*n+x]-real[i];
   const vx=dx+bx[i],vy=dy+by[i],gain=Math.max(0,1-lambda/(rho*Math.max(1e-12,Math.hypot(vx,vy))));
   zx[i]=gain*vx;zy[i]=gain*vy;bx[i]+=dx-zx[i];by[i]+=dy-zy[i];
  }
  if(checkpoints.includes(iteration))yield {image:render(source,real,{normalized:true}),iteration};
 }
}
