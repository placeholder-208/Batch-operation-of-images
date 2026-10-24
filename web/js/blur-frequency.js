// Bounded radix-2 FFT and symmetric PSF Wiener restoration.
export function fft(real,imag,inverse=false){
 const n=real.length;
 if(n<1||(n&(n-1))||imag.length!==n)throw new Error('FFT size must be a power of two');
 for(let i=1,j=0;i<n;i++){
  let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
  if(i<j){[real[i],real[j]]=[real[j],real[i]];[imag[i],imag[j]]=[imag[j],imag[i]];}
 }
 for(let size=2;size<=n;size<<=1){
  const angle=(inverse?2:-2)*Math.PI/size,cr=Math.cos(angle),ci=Math.sin(angle),half=size>>1;
  for(let start=0;start<n;start+=size){
   let wr=1,wi=0;
   for(let j=0;j<half;j++){
    const a=start+j,b=a+half,tr=wr*real[b]-wi*imag[b],ti=wr*imag[b]+wi*real[b];
    real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;
    const next=wr*cr-wi*ci;wi=wr*ci+wi*cr;wr=next;
   }
  }
 }
 if(inverse)for(let i=0;i<n;i++){real[i]/=n;imag[i]/=n;}
}
function fft2(real,imag,n,inverse=false){
 for(let y=0;y<n;y++)fft(real.subarray(y*n,(y+1)*n),imag.subarray(y*n,(y+1)*n),inverse);
 const a=new Float64Array(n),b=new Float64Array(n);
 for(let x=0;x<n;x++){
  for(let y=0;y<n;y++){a[y]=real[y*n+x];b[y]=imag[y*n+x];}
  fft(a,b,inverse);
  for(let y=0;y<n;y++){real[y*n+x]=a[y];imag[y*n+x]=b[y];}
 }
}
const mirror=(v,n)=>{if(n===1)return 0;const p=2*(n-1),x=((v%p)+p)%p;return x<n?x:p-x;};
export function spectrum(image){
 const {width,height,data}=image;
 const n=2**Math.ceil(Math.log2(Math.max(width,height)+64));
 if(n>1024)throw new Error('Evaluation ROI exceeds FFT memory limit');
 const real=new Float64Array(n*n),imag=new Float64Array(n*n),ox=Math.floor((n-width)/2),oy=Math.floor((n-height)/2);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=(mirror(y-oy,height)*width+mirror(x-ox,width))*4,alpha=data[i+3]/255;
  real[y*n+x]=alpha*(.299*data[i]+.587*data[i+1]+.114*data[i+2])+255*(1-alpha);
 }
 fft2(real,imag,n);return {real,imag,n,width,height,ox,oy};
}
export function filterFrequency(source,{sigma=0,length=0,angle=0,regularization=.002,forward=false}={}){
 const {n,width,height,ox,oy}=source;
 const real=source.workReal??=new Float64Array(n*n),imag=source.workImag??=new Float64Array(n*n);
 real.set(source.real);imag.set(source.imag);
 const c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180);
 const transfer=(fx,fy)=>{
  const t=Math.PI*length*(fx*c+fy*s),motion=Math.abs(t)<1e-10?1:Math.sin(t)/t;
  const h=motion*Math.exp(-2*Math.PI*Math.PI*sigma*sigma*(fx*fx+fy*fy));
  return forward?h:h/(h*h+regularization)*(1+regularization);
 };
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const fx=(x<=n/2?x:x-n)/n,fy=(y<=n/2?y:y-n)/n;
  let gain=transfer(fx,fy);
  // A Nyquist bin is its own negative on that axis. Average conjugate
  // gains so the restored spectrum remains Hermitian for angled motion.
  if(x===n/2||y===n/2)gain=(gain+transfer(x===n/2?fx:-fx,y===n/2?fy:-fy))/2;
  const i=y*n+x;
  real[i]*=gain;imag[i]*=gain;
 }
 fft2(real,imag,n,true);
 const data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,v=real[(y+oy)*n+x+ox];data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
 }
 return new ImageData(data,width,height);
}
