export async function createZBar({modulePath}){
 const url=modulePath.startsWith('/')&&typeof process!=='undefined'&&process.versions?.node?
  (await import('node:url')).pathToFileURL(modulePath).href:modulePath;
 const lib=await import(url);
 const scanner=await lib.getDefaultScanner();
 const {ZBarSymbolType:S,ZBarConfigType:C}=lib;
 for(const [sym,config,value]of [[S.ZBAR_NONE,C.ZBAR_CFG_ENABLE,0],[S.ZBAR_QRCODE,C.ZBAR_CFG_ENABLE,1],
  [S.ZBAR_NONE,C.ZBAR_CFG_TEST_INVERTED,1]]){
  if(scanner.setConfig(sym,config,value)!==0)throw Error('Unsupported ZBar configuration');
 }
 scanner.enableCache(false);
 return {name:'zbar',version:'0.11.0',async decode(image){
  const raw=await lib.scanImageData(image,scanner),result=[];
  for(const qr of raw){
   if(qr.type!==S.ZBAR_QRCODE)continue;
   if(qr.points.length!==4)throw Error('QR result lacks four polygon points');
   result.push({text:qr.decode(),points:qr.points,positionKind:'decoder-quadrilateral'});
  }
  return result;
 },close(){scanner.destroy();}};
}
