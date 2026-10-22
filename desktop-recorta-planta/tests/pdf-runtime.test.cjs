const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createCanvas}=require('@napi-rs/canvas');
const PDFLib=require('pdf-lib');

test('PDF.js corrigido renderiza PDF digital e o OCR offline lê sua imagem', {timeout:120000},async()=>{
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const version=require('pdfjs-dist/package.json').version.split('.').map(Number);
  assert.ok(version[0]>6||version[0]===6&&(version[1]>2||version[1]===2&&version[2]>=108));
  const document=await PDFLib.PDFDocument.create(),page=document.addPage([600,400]);
  const font=await document.embedFont(PDFLib.StandardFonts.HelveticaBold);
  page.drawText('PLANTA BAIXA',{x:70,y:200,size:42,font});
  const vendor=path.resolve(__dirname,'../app/web/vendor/pdfjs');
  const task=pdfjs.getDocument({data:new Uint8Array(await document.save()),isEvalSupported:false,enableScripting:false,standardFontDataUrl:path.join(vendor,'standard_fonts')+path.sep,cMapUrl:path.join(vendor,'cmaps')+path.sep,wasmUrl:path.join(vendor,'wasm')+path.sep});
  let pdf,worker;
  try{
    pdf=await task.promise;
    const pdfPage=await pdf.getPage(1),viewport=pdfPage.getViewport({scale:2});
    const canvas=createCanvas(viewport.width,viewport.height);
    await pdfPage.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    const text=await pdfPage.getTextContent();
    assert.match(text.items.map(value=>value.str).join(' '),/PLANTA BAIXA/);
    const {createWorker}=require('tesseract.js');
    worker=await createWorker('eng',1,{langPath:path.resolve(__dirname,'../app/web/vendor/ocr/lang'),cacheMethod:'none',gzip:true});
    const result=await worker.recognize(canvas.toBuffer('image/png'));
    assert.match(result.data.text,/PLANTA\s+BAIXA/);
  }finally{
    if(worker)await worker.terminate();
    await task.destroy();
  }
});
