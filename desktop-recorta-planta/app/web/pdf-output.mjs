import {rectToPdf} from './detector.mjs';

export async function createCroppedPdf(PDFLib,bytes,selections) {
  if(!selections.length)throw new Error('Selecione uma área para recortar.');
  const source=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
  const out=await PDFLib.PDFDocument.create();
  for(const s of selections){
    const [page]=await out.copyPages(source,[s.pageNumber-1]);
    const b=rectToPdf(s.viewport,s.rect);
    if(!Number.isFinite(b.x+b.y+b.w+b.h)||b.w<2||b.h<2)throw new Error('A área selecionada é muito pequena.');
    page.setMediaBox(b.x,b.y,b.w,b.h);
    page.setCropBox(b.x,b.y,b.w,b.h);
    page.setTrimBox(b.x,b.y,b.w,b.h);
    page.setBleedBox(b.x,b.y,b.w,b.h);
    page.setArtBox(b.x,b.y,b.w,b.h);
    out.addPage(page);
  }
  out.setTitle(selections.length===1?'Planta baixa recortada':'Plantas baixas recortadas');
  out.setProducer('Recorta Planta');
  out.catalog.set(PDFLib.PDFName.of('PageLayout'),PDFLib.PDFName.of('SinglePage'));
  return out.save();
}
