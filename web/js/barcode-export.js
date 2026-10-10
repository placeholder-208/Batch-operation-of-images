import {cropBlob} from './crop-store.js';
import { canvasToBlob } from './image.js';
function cell(value) {
    // Exact contents, including leading zeroes. Import the text column as text.
    const text=String(value??'');return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
}
export function barcodeCSV(results) {
    const rows=[['filename','id','format','text','center_x','center_y','crop_file']];
    for(const result of results)for(const code of result.barcodes)rows.push([
        result.filename,code.id,code.format,code.text,code.center.x,code.center.y,
        result.crops.some(c=>c.id===code.id)?String(code.id).padStart(3,'0')+'.png':'']);
    return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
export async function barcodeZIP(results) {
    if(!window.JSZip)throw new Error('ZIP 库未加载');
    const zip=new window.JSZip(),used=new Set();
    for(const result of results) {
        const base=result.filename.replace(/\.[^/.]+$/,'').replace(/[\\/:*?"<>|]/g,'_')||'image';
        let name=base,index=2;while(used.has(name))name=base+'-'+index++;used.add(name);
        const folder=zip.folder(name);
        for(const crop of result.crops)folder.file(String(crop.id).padStart(3,'0')+'.png',await cropBlob(crop));
        folder.file('result.csv',barcodeCSV([result]));
    }
    // Root CSV identifies the unique directory of each crop, even with duplicate filenames.
    const rows=[['folder','filename','id','format','text','center_x','center_y','crop_file']];
    [...used].forEach((folder,index)=>{const r=results[index];for(const c of r.barcodes)rows.push([
        folder,r.filename,c.id,c.format,c.text,c.center.x,c.center.y,r.crops.some(v=>v.id===c.id)?folder+'/'+String(c.id).padStart(3,'0')+'.png':'']);});
    zip.file('all-results.csv','\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n'));
    return zip.generateAsync({type:'blob'});
}
