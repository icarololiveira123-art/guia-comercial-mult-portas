const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const {resolveAsset,serveAsset,CSP}=require('../app/assets.cjs');
const root=path.resolve(__dirname,'../app/web');

test('carrega a interface e todos os recursos locais essenciais',async()=>{
  for(const [file,type] of [['/','text/html'],['/app.mjs','text/javascript'],['/processing-limits.mjs','text/javascript'],['/vendor/pdfjs/pdf.min.mjs','text/javascript'],['/vendor/pdfjs/pdf.worker.min.mjs','text/javascript'],['/vendor/ocr/worker.min.js','text/javascript'],['/vendor/ocr/core/tesseract-core-simd-lstm.wasm.js','text/javascript'],['/vendor/ocr/core/tesseract-core-simd-lstm.wasm','application/wasm'],['/vendor/ocr/lang/eng.traineddata.gz','application/octet-stream']]){
    const response=await serveAsset(new Request('recorta://app'+file),root);
    assert.equal(response.status,200,file);assert.ok(response.headers.get('content-type').startsWith(type),file);assert.ok((await response.arrayBuffer()).byteLength>0,file);
  }
});
test('nega recursos externos, caminhos fora do aplicativo e métodos de escrita',async()=>{
  for(const u of ['https://example.com/','file:///etc/passwd','recorta://other/','recorta://app/%2e%2e%2fsecret.txt','recorta://app/%5c..%5csecret.txt','recorta://app/%00'])assert.ok(resolveAsset(u,root).status>=400,u);
  assert.equal((await serveAsset(new Request('recorta://app/no-such-resource'),root)).status,404);
  assert.equal((await serveAsset(new Request('recorta://app/',{method:'POST'}),root)).status,405);
  assert.equal((await serveAsset(new Request('recorta://app/app.mjs',{method:'HEAD'}),root)).status,200);
});
test('a interface desktop usa arquivos locais e mantém as funções do recorte',async()=>{
  const app=await fs.readFile(path.join(root,'app.mjs'),'utf8'),html=await fs.readFile(path.join(root,'index.html'),'utf8');
  assert.ok(app.includes('createCroppedPdf'));assert.ok(app.includes('Tesseract'));assert.ok(html.includes('downloadButton'));
  assert.ok(CSP.includes("script-src 'self' 'wasm-unsafe-eval'"));
  assert.ok(!CSP.includes("script-src 'self' 'unsafe-eval'"));
  assert.ok(!html.includes('http://')&&!html.includes('https://'));
  assert.ok(app.includes('isEvalSupported:false')&&app.includes('enableScripting:false'));
  assert.ok(html.includes('informações fora do recorte continuam no arquivo'));
  assert.ok(html.includes('value="sanitized"'));
});
