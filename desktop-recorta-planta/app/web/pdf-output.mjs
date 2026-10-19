import {rectToPdf} from './detector.mjs';
import {LIMITS} from './processing-limits.mjs';

// A new document must not relay actions from a PDF supplied by somebody else.
// Keep drawing streams, fonts and static annotation appearances unchanged.
const actionNames=new Set(['JavaScript','Launch','URI','GoTo','GoToR','GoToE','SubmitForm','ImportData','ResetForm','Rendition','Movie','Sound','Hide','Named','SetOCGState','Thread','Trans','GoTo3DView']);
const activeAnnotations=new Set(['FileAttachment','RichMedia','Screen','Movie','Sound','3D']);

function sanitizeDocument(PDFLib,document){
  const {PDFName,PDFDict,PDFArray,PDFRef}=PDFLib,seen=new Set();
  const name=value=>value instanceof PDFName?value.decodeText():null;
  const visit=value=>{
    if(value instanceof PDFRef)value=document.context.lookup(value);
    if(!value||typeof value!=='object'||seen.has(value))return;
    seen.add(value);
    if(value instanceof PDFArray){for(let i=0;i<value.size();i++)visit(value.get(i));return;}
    if(!(value instanceof PDFDict)){if(value.dict)visit(value.dict);return;}
    const action=name(document.context.lookup(value.get(PDFName.of('S'))));
    if(actionNames.has(action)){
      for(const key of value.keys())value.delete(key);
      return;
    }
    const type=name(document.context.lookup(value.get(PDFName.of('Type'))));
    if(type==='Page'||type==='Annot'||value.has(PDFName.of('FT'))){
      for(const key of ['AA','OpenAction','AF'])value.delete(PDFName.of(key));
      if(type==='Annot')value.delete(PDFName.of('A'));
    }
    const annots=document.context.lookup(value.get(PDFName.of('Annots')));
    if(annots instanceof PDFArray){
      for(let i=annots.size()-1;i>=0;i--){
        const annotation=document.context.lookup(annots.get(i));
        const subtype=annotation instanceof PDFDict?name(document.context.lookup(annotation.get(PDFName.of('Subtype')))):null;
        if(activeAnnotations.has(subtype))annots.remove(i);
      }
    }
    for(const [_key,child] of value.entries())visit(child);
  };
  // Include copied, now unreferenced objects too, so no action dictionaries are
  // written into the output just because copyPages eagerly copied them.
  for(const [_reference,value] of document.context.enumerateIndirectObjects())visit(value);
  visit(document.catalog);
}

function validateSelections(selections){
  if(!selections.length)throw new Error('Selecione uma área para recortar.');
  if(selections.length>LIMITS.exportPages)throw new Error(`Exporte até ${LIMITS.exportPages} recortes por vez.`);
}

export async function createCroppedPdf(PDFLib,bytes,selections) {
  validateSelections(selections);
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
  sanitizeDocument(PDFLib,out);
  out.setTitle(selections.length===1?'Planta baixa recortada':'Plantas baixas recortadas');
  out.setProducer('Recorta Planta');
  out.catalog.set(PDFLib.PDFName.of('PageLayout'),PDFLib.PDFName.of('SinglePage'));
  return out.save();
}

// This path receives only pixels of the chosen region, never the source PDF.
// It intentionally trades vectors/searchable text for removal of hidden data.
export async function createRasterizedPdf(PDFLib,selections,renderSelection){
  validateSelections(selections);
  const out=await PDFLib.PDFDocument.create();
  for(const selection of selections){
    const {pngBytes,width,height}=await renderSelection(selection);
    if(!Number.isFinite(width+height)||width<2||height<2)throw new Error('A área selecionada é muito pequena.');
    const image=await out.embedPng(pngBytes);
    const page=out.addPage([width,height]);
    page.drawImage(image,{x:0,y:0,width,height});
  }
  out.setTitle(selections.length===1?'Planta baixa sanitizada':'Plantas baixas sanitizadas');
  out.setProducer('Recorta Planta');
  return out.save();
}
