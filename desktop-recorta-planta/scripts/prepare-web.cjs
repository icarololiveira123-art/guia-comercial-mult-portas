'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {gzipSync}=require('node:zlib');
const root=path.resolve(__dirname,'..'),modules=path.join(root,'node_modules'),vendor=path.join(root,'app/web/vendor');
const modelUrl='https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/eng.traineddata';
const modelHash='7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2';

async function prepare(){
  for(const d of ['pdfjs','ocr/core','ocr/lang','licenses'])await fs.mkdir(path.join(vendor,d),{recursive:true});
  for(const n of ['pdf.min.mjs','pdf.worker.min.mjs'])await fs.copyFile(path.join(modules,'pdfjs-dist/build',n),path.join(vendor,'pdfjs',n));
  for(const n of ['cmaps','standard_fonts','wasm'])await fs.cp(path.join(modules,'pdfjs-dist',n),path.join(vendor,'pdfjs',n),{recursive:true});
  await fs.copyFile(path.join(modules,'pdf-lib/dist/pdf-lib.min.js'),path.join(vendor,'pdf-lib.min.js'));
  for(const n of ['tesseract.min.js','worker.min.js'])await fs.copyFile(path.join(modules,'tesseract.js/dist',n),path.join(vendor,'ocr',n));
  for(const n of await fs.readdir(path.join(modules,'tesseract.js-core')))if(/\.wasm(?:\.js)?$/.test(n))await fs.copyFile(path.join(modules,'tesseract.js-core',n),path.join(vendor,'ocr/core',n));
  for(const pkg of ['pdfjs-dist','pdf-lib','tesseract.js','tesseract.js-core']){
    let found=false;
    for(const n of ['LICENSE','LICENSE.md','LICENSE.txt']){
      try{await fs.copyFile(path.join(modules,pkg,n),path.join(vendor,'licenses',pkg+'.txt'));found=true;break;}catch(e){if(e.code!=='ENOENT')throw e;}
    }
    if(!found)throw new Error('Licença não encontrada: '+pkg);
  }
  const response=await fetch(modelUrl,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error('Não foi possível obter o modelo OCR: '+response.status);
  const model=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(model).digest('hex')!==modelHash)throw new Error('O modelo OCR não confere com a versão fixada.');
  await fs.writeFile(path.join(vendor,'ocr/lang/eng.traineddata.gz'),gzipSync(model,{level:6}));
  await fs.mkdir(path.join(root,'build'),{recursive:true});
  for(const name of ['icon.ico','icon-512.png','icon-192.png']){
    const encoded=await fs.readFile(path.join(root,'source-assets',name+'.base64'),'utf8');
    await fs.writeFile(name==='icon.ico'?path.join(root,'build',name):path.join(root,'app/web',name),Buffer.from(encoded.trim(),'base64'));
  }
  await fs.copyFile(path.join(root,'app/web/icon-512.png'),path.join(root,'build/icon.png'));
  console.log('Interface, bibliotecas, ícones e modelo OCR preparados para uso offline.');
}
prepare().catch(error=>{console.error(error);process.exitCode=1;});
