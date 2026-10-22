// Exact 2D thin-plate spline interpolation, U(r)=r^2 log(r), U(0)=0.
// Fit normalized standard-module coordinates -> observed image coordinates.
const kernel = squared => squared > 0 ? 0.5 * squared * Math.log(squared) : 0;
function solve(matrix, rhs) {
    const size=matrix.length, rows=matrix.map((row,i)=>Float64Array.from([...row,...rhs[i]]));
    for(let col=0;col<size;col++){
        let pivot=col;
        for(let row=col+1;row<size;row++)if(Math.abs(rows[row][col])>Math.abs(rows[pivot][col]))pivot=row;
        if(!Number.isFinite(rows[pivot][col])||Math.abs(rows[pivot][col])<1e-11)return null;
        [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
        const divisor=rows[col][col];
        for(let j=col;j<size+2;j++)rows[col][j]/=divisor;
        for(let row=0;row<size;row++){
            if(row===col)continue;
            const factor=rows[row][col];
            for(let j=col;j<size+2;j++)rows[row][j]-=factor*rows[col][j];
        }
    }
    return rows.map(row=>[row[size],row[size+1]]);
}
export function fitTPS(ideal, observed, dimension, imageScale) {
    const n=ideal.length;
    if(n<3||n!==observed.length||!(dimension>0&&imageScale>0))return null;
    if([...ideal,...observed].some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
    const points=ideal.map(p=>({x:p.x/dimension,y:p.y/dimension}));
    const matrix=Array.from({length:n+3},()=>new Float64Array(n+3));
    const rhs=Array.from({length:n+3},()=>[0,0]);
    for(let i=0;i<n;i++){
        for(let j=0;j<n;j++){
            const d=(points[i].x-points[j].x)**2+(points[i].y-points[j].y)**2;
            if(i!==j&&d<1e-12)return null;
            matrix[i][j]=kernel(d);
        }
        for(const [j,value]of [1,points[i].x,points[i].y].entries()){
            matrix[i][n+j]=value;matrix[n+j][i]=value;
        }
        rhs[i]=[observed[i].x/imageScale,observed[i].y/imageScale];
    }
    const coefficients=solve(matrix,rhs);
    if(!coefficients)return null;
    return (x,y)=>{
        const u=x/dimension,v=y/dimension;
        let px=coefficients[n][0]+coefficients[n+1][0]*u+coefficients[n+2][0]*v;
        let py=coefficients[n][1]+coefficients[n+1][1]*u+coefficients[n+2][1]*v;
        for(let i=0;i<n;i++){
            const weight=kernel((u-points[i].x)**2+(v-points[i].y)**2);
            px+=coefficients[i][0]*weight;py+=coefficients[i][1]*weight;
        }
        return {x:px*imageScale,y:py*imageScale};
    };
}
export function validateTPS(map, dimension, width, height) {
    // Additional engineering checks, not a claim of guaranteed correctness.
    let sign=0,minArea=Infinity,maxArea=0;
    const step=dimension/12;
    for(let iy=0;iy<12;iy++)for(let ix=0;ix<12;ix++){
        const x=ix*step,y=iy*step;
        const p=map(x,y),a=map(x+step,y),b=map(x,y+step);
        if([p,a,b].some(q=>!Number.isFinite(q.x+q.y)||q.x < -width*.25||q.x>width*1.25||q.y < -height*.25||q.y>height*1.25))return false;
        const cross=(a.x-p.x)*(b.y-p.y)-(a.y-p.y)*(b.x-p.x);
        if(Math.abs(cross)<1e-6||sign&&Math.sign(cross)!==sign)return false;
        sign=Math.sign(cross);minArea=Math.min(minArea,Math.abs(cross));maxArea=Math.max(maxArea,Math.abs(cross));
    }
    return maxArea/minArea<=100;
}
