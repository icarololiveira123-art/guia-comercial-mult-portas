const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

async function waitFor(window,expression,timeout=90000){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await window.webContents.executeJavaScript(expression))return;await new Promise(r=>setTimeout(r,150));}
  throw new Error('Tempo esgotado: '+expression);
}
exports.run=async window=>{
  const errors=[];window.webContents.on('console-message',(_event,details)=>{if(details.level==='error'){errors.push(details.message);console.error('RENDERER',details.message);}});
  await waitFor(window,"!!window.PDFLib && !!window.Tesseract && !!document.getElementById('demoButton')");
  await window.webContents.executeJavaScript("document.getElementById('demoButton').click()",true);
  await waitFor(window,"!document.getElementById('workspace').hidden && !document.body.classList.contains('busy') && !document.getElementById('downloadButton').disabled");
  const first=await window.webContents.executeJavaScript("({count:document.getElementById('resultCount').textContent,status:document.getElementById('documentStatus').textContent,error:document.getElementById('errorDialog').open})");
  assert.equal(first.count,'1');assert.equal(first.error,false);
  console.log('NATIVE_DIGITAL_OK',JSON.stringify(first));
  const output=await window.webContents.executeJavaScript(`(async()=>{
    const {createCroppedPdf}=await import('/pdf-output.mjs');
    const p=await PDFLib.PDFDocument.create(),page=p.addPage([600,800]);page.drawText('PLANTA BAIXA',{x:100,y:100});
    const source=await p.save(),rect={x:.1,y:.1,w:.6,h:.7};
    const viewport={width:600,height:800,convertToPdfPoint:(x,y)=>[x,800-y]};
    const bytes=await createCroppedPdf(PDFLib,source,[{pageNumber:1,viewport,rect}]);
    const doc=await PDFLib.PDFDocument.load(bytes);return {pages:doc.getPageCount(),box:doc.getPage(0).getMediaBox()};
  })()`);
  assert.equal(output.pages,1);assert.equal(output.box.width,360);assert.equal(output.box.height,560);
  console.log('NATIVE_PDF_OUTPUT_OK',JSON.stringify(output));
  const ocr=await window.webContents.executeJavaScript(`(async()=>{
    const worker=await Tesseract.createWorker('eng',1,{workerPath:new URL('/vendor/ocr/worker.min.js',location.href).href,corePath:new URL('/vendor/ocr/core',location.href).href,langPath:new URL('/vendor/ocr/lang',location.href).href,cacheMethod:'none',workerBlobURL:false});
    try{const c=document.createElement('canvas');c.width=700;c.height=140;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,700,140);ctx.fillStyle='black';ctx.font='42px Arial';ctx.fillText('PLANTA BAIXA',30,85);const r=await worker.recognize(c);return r.data.text.trim();}finally{await worker.terminate();}
  })()`);
  assert.match(ocr,/PLANTA BAIXA/);console.log('NATIVE_OCR_OK',ocr);
  await window.webContents.executeJavaScript(`(async()=>{
    const c=document.createElement('canvas');c.width=2400;c.height=1700;
    const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.strokeStyle='black';x.lineWidth=5;
    x.strokeRect(180,180,650,1100);x.beginPath();x.moveTo(180,680);x.lineTo(830,680);x.moveTo(500,180);x.lineTo(500,1280);x.stroke();
    x.strokeRect(1240,180,650,1100);for(let p=1250;p<1890;p+=20){x.beginPath();x.moveTo(p,180);x.lineTo(p,1280);x.stroke();}
    x.fillStyle='black';x.font='bold 36px Arial';x.fillText('PLANTA BAIXA',180,1410);x.fillText('PLANTA DE COBERTURA',1240,1410);x.font='28px Arial';x.fillText('QUARTO',250,430);x.fillText('SALA',570,900);
    const doc=await PDFLib.PDFDocument.create(),image=await doc.embedPng(c.toDataURL('image/png')),page=doc.addPage([1200,850]);page.drawImage(image,{x:0,y:0,width:1200,height:850});
    const file=new File([await doc.save()],'teste_escaneado.pdf',{type:'application/pdf'}),data=new DataTransfer();data.items.add(file);
    const input=document.getElementById('fileInput');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(window,"!document.body.classList.contains('busy') && !document.getElementById('downloadButton').disabled");
  const scanned=await window.webContents.executeJavaScript("({count:document.getElementById('resultCount').textContent,method:document.getElementById('results').textContent,error:document.getElementById('errorDialog').open})");
  assert.equal(scanned.count,'1',JSON.stringify(scanned));assert.match(scanned.method,/leitura de imagem/);assert.equal(scanned.error,false);
  console.log('NATIVE_SCANNED_PDF_OK',JSON.stringify(scanned));
  const adjustment=await window.webContents.executeJavaScript(`(()=>{
    const s=document.getElementById('selection'),before=parseFloat(s.style.left);
    s.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    const after=parseFloat(s.style.left),margin=document.getElementById('margin');margin.value='2';margin.dispatchEvent(new Event('input',{bubbles:true}));
    return {before,after,margin:document.getElementById('marginValue').textContent};
  })()`);
  assert.ok(adjustment.after>adjustment.before);assert.equal(adjustment.margin,'2 mm');console.log('NATIVE_ADJUSTMENT_OK',JSON.stringify(adjustment));
  const target=path.join(path.dirname(process.env.RECORTA_SMOKE_REPORT||__filename),'native-download.pdf');
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Download nativo não terminou')),20000);
    window.webContents.session.once('will-download',(_event,item)=>{
      item.setSavePath(target);item.once('done',(_e,state)=>{clearTimeout(timer);state==='completed'?resolve():reject(new Error('Download: '+state));});
    });
    window.webContents.executeJavaScript("document.getElementById('downloadButton').click()",true).catch(reject);
  });
  const download=await fs.readFile(target);assert.equal(download.subarray(0,5).toString(),'%PDF-');assert.ok(download.length>1000);console.log('NATIVE_DOWNLOAD_OK',download.length,'bytes');
  assert.equal(errors.filter(e=>/content security policy|refused|not allowed/i.test(e)).length,0,errors.join('\n'));
  const report={digital:first,pdf:output,ocr,scanned,adjustment,downloadBytes:download.length,errors,platform:process.platform,version:process.versions.electron};
  if(process.env.RECORTA_SMOKE_REPORT)await fs.writeFile(process.env.RECORTA_SMOKE_REPORT,JSON.stringify(report,null,2));
  console.log('NATIVE_SMOKE_PASSED');
};
