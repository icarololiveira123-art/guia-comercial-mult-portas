export function pdfTextWords(pdfjs,content,viewport){
  return content.items.filter(i=>i.str?.trim()).map(i=>{
    const t=pdfjs.Util.transform(viewport.transform,i.transform),h=Math.hypot(t[2],t[3]);
    return {text:i.str,x:t[4],y:t[5]-h,w:Math.max(1,i.width*viewport.scale),h:Math.max(2,h)};
  });
}

export function ocrWords(blocks){
  const out=[];
  for(const block of blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[])for(const word of line.words||[]){
    if(word.confidence<22)continue;
    const b=word.bbox;out.push({text:word.text,x:b.x0,y:b.y0,w:b.x1-b.x0,h:b.y1-b.y0});
  }
  return out;
}
