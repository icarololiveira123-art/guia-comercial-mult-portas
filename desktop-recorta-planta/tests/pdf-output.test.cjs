const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inflateSync}=require('node:zlib');
const PDFLib=require('pdf-lib');
const {PDFDocument,PDFName,PDFDict,PDFString,StandardFonts}=PDFLib;
const output=import('../app/web/pdf-output.mjs');
const viewport={width:600,height:800,convertToPdfPoint:(x,y)=>[x,800-y]};
const selection={pageNumber:1,viewport,rect:{x:.2,y:.15,w:.4,h:.4}};

test('exportação vetorial remove ações e anexos ativos, mantendo texto e anotações estáticas',async()=>{
  const source=await PDFDocument.create(),page=source.addPage([600,800]);
  const font=await source.embedFont(StandardFonts.Helvetica);
  const outside='SYNTHETIC_PRIVATE_OUTSIDE';
  page.drawText(outside,{x:10,y:10,font,size:12});
  page.drawText('SYNTHETIC_VISIBLE',{x:150,y:550,font,size:12});
  page.node.set(PDFName.of('AA'),source.context.obj({O:{S:'JavaScript',JS:PDFString.of('app.alert("fixture")')}}));
  const annotations=[
    {Type:'Annot',Subtype:'Link',Rect:[100,500,200,600],A:{S:'JavaScript',JS:PDFString.of('app.alert("fixture")')}},
    {Type:'Annot',Subtype:'Text',Rect:[150,500,170,520],Contents:PDFString.of('Keep this static comment')},
    {Type:'Annot',Subtype:'FileAttachment',Rect:[100,100,120,120],FS:{Type:'Filespec',F:PDFString.of('fixture.txt')}},
    {Type:'Annot',Subtype:'RichMedia',Rect:[100,100,120,120]},
  ];
  page.node.set(PDFName.of('Annots'),source.context.obj(annotations.map(value=>source.context.register(source.context.obj(value)))));
  source.catalog.set(PDFName.of('OpenAction'),source.context.obj({S:'JavaScript',JS:PDFString.of('app.alert("fixture")')}));
  const {createCroppedPdf}=await output;
  const document=await PDFDocument.load(await createCroppedPdf(PDFLib,await source.save(),[selection]));
  const result=document.getPage(0),box=result.getMediaBox();
  assert.ok(Math.abs(box.width-240)<.001&&Math.abs(box.height-320)<.001);
  assert.equal(result.node.has(PDFName.of('AA')),false);
  assert.equal(document.catalog.has(PDFName.of('OpenAction')),false);
  const annots=result.node.lookup(PDFName.of('Annots'));
  assert.equal(annots.size(),2);
  for(let i=0;i<annots.size();i++){
    const annotation=document.context.lookup(annots.get(i));
    assert.equal(annotation.has(PDFName.of('A')),false);
    assert.equal(annotation.has(PDFName.of('AA')),false);
  }
  assert.equal(document.context.lookup(annots.get(1)).get(PDFName.of('Contents')).decodeText(),'Keep this static comment');
  let drawingTextPreserved=false;
  for(const [_ref,object] of document.context.enumerateIndirectObjects()){
    if(object instanceof PDFDict){
      assert.notEqual(object.get(PDFName.of('S'))?.toString(),'/JavaScript');
      assert.equal(object.has(PDFName.of('JS')),false);
    }
    if(typeof object.getContents==='function'){
      let contents=Buffer.from(object.getContents());
      try{contents=inflateSync(contents);}catch{}
      if(contents.toString('latin1').includes(Buffer.from(outside).toString('hex').toUpperCase()))drawingTextPreserved=true;
    }
  }
  assert.equal(drawingTextPreserved,true,'vector mode preserves original drawing streams; it is not redaction');
});

test('exportação sanitizada cria um documento novo somente com os pixels selecionados',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64');
  const {createRasterizedPdf}=await output;
  let called=0;
  const bytes=await createRasterizedPdf(PDFLib,[selection],async value=>{
    assert.equal(value,selection);called++;
    return {pngBytes:png,width:240,height:320};
  });
  const document=await PDFDocument.load(bytes),page=document.getPage(0);
  assert.equal(called,1);
  assert.equal(document.getPageCount(),1);
  assert.deepEqual(page.getSize(),{width:240,height:320});
  assert.equal(page.node.lookup(PDFName.of('Annots'))?.size()||0,0);
  assert.equal(page.node.has(PDFName.of('AA')),false);
  const xobjects=page.node.Resources().lookup(PDFName.of('XObject'));
  assert.equal(xobjects.keys().length,1);
  const image=document.context.lookup(xobjects.get(xobjects.keys()[0]));
  assert.equal(image.dict.get(PDFName.of('Subtype')).toString(),'/Image');
});
