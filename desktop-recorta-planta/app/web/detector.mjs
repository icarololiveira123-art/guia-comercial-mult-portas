export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const normalize = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function groupWords(words) {
  const rows = [];
  for (const w of [...words].filter(w => w.text?.trim() && w.w > 0 && w.h > 0).sort((a,b) => a.y-b.y || a.x-b.x)) {
    const mid = w.y + w.h/2;
    const row = rows.find(r => Math.abs(r.mid-mid) < Math.max(3, Math.min(r.h,w.h)*0.52));
    if (row) { row.words.push(w); row.mid = (row.mid*(row.words.length-1)+mid)/row.words.length; row.h=Math.max(row.h,w.h); }
    else rows.push({mid,h:w.h,words:[w]});
  }
  const lines=[];
  for (const row of rows) {
    const sorted=row.words.sort((a,b)=>a.x-b.x); let part=[];
    const flush=()=>{
      if(!part.length)return;
      const x=Math.min(...part.map(w=>w.x)),y=Math.min(...part.map(w=>w.y));
      lines.push({text:part.map(w=>w.text).join(' '),x,y,w:Math.max(...part.map(w=>w.x+w.w))-x,h:Math.max(...part.map(w=>w.y+w.h))-y});part=[];
    };
    for(const word of sorted) {
      const last=part.at(-1);
      const startsTitle=/^(?:PLANTA|PAVIMENTO|FLOOR\s*PLAN)\b/.test(normalize(word.text));
      const alreadyTitle=part.some(w=>/\b(?:PLANTA|PAVIMENTO|FLOOR\s*PLAN)\b/.test(normalize(w.text)));
      if(last && (word.x-last.x-last.w>Math.max(last.h,word.h)*3.1 || startsTitle&&alreadyTitle))flush();
      part.push(word);
    }
    flush();
  }
  return lines;
}

export function findHeadings(words) {
  return groupWords(words).map(line=>{
    const n=normalize(line.text);
    const floor=/PLANTA\s+(?:DO\s+|DE\s+)?(?:PAVIMENTO|BAI[XK]A|ARQUITETONICA)|PAVIMENTO\s+(?:TERREO|SUPERIOR|INFERIOR|TIPO|1|2)|FLOOR\s*PLAN/.test(n);
    const excluded=/COBERTURA|HUMANIZAD|LOCALIZACAO|SITUACAO|IMPLANTACAO|ELETRIC|HIDRAULIC|ESTRUTURAL/.test(n);
    const drawing=/PLANTA|PAVIMENTO|FLOOR PLAN|FACHADA|CORTE|LEGENDA|DETALHE|TABELA|VISTA/.test(n);
    return {...line,normalized:n,target:floor&&!excluded,drawing};
  }).filter(h=>h.drawing);
}

export function prepareInk({data,width,height}) {
  const ink=new Uint8Array(width*height),horizontalRules=[],verticalRules=[];
  for(let i=0;i<ink.length;i++) {
    const p=i*4;
    ink[i]=data[p+3]>80 && Math.min(data[p],data[p+1],data[p+2])<160 && (data[p]*.299+data[p+1]*.587+data[p+2]*.114)<212 ? 1:0;
  }
  // Sheet borders should not join otherwise separate drawings.
  for(let y=0;y<height;y++) {
    let run=0;
    for(let x=0;x<width;x++){
      run=ink[y*width+x]?run+1:0;
      if(run>width*.66){horizontalRules.push(y);break;}
    }
  }
  for(let x=0;x<width;x++) {
    let run=0,longest=0,start=0,end=0;
    for(let y=0;y<height;y++){
      run=ink[y*width+x]?run+1:0;
      if(run>longest){longest=run;start=y-run+1;end=y;}
    }
    const joinsFrame=horizontalRules.some(y=>Math.abs(y-start)<5)&&horizontalRules.some(y=>Math.abs(y-end)<5);
    if(longest>height*.82 || longest>height*.48&&joinsFrame)verticalRules.push(x);
  }
  for(const y of horizontalRules)for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)ink.fill(0,yy*width,(yy+1)*width);
  // A double sheet border also contains short registration ticks between its lines.
  for(let i=1;i<horizontalRules.length;i++){
    const a=horizontalRules[i-1],b=horizontalRules[i];
    if(b-a<Math.max(4,height*.018))for(let y=a;y<=b;y++)ink.fill(0,y*width,(y+1)*width);
  }
  for(const x of verticalRules)for(let y=0;y<height;y++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++)ink[y*width+xx]=0;
  return {ink,width,height,horizontalRules,verticalRules};
}

const median = a => {const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)];};

function inferRegion(anchor,headings,image) {
  const {width:W,height:H,ink}=image;
  const peers=headings.filter(h=>Math.abs(h.y-anchor.y)<Math.max(H*.035,anchor.h*2.2) && h.h>=anchor.h*.77 && /PLANTA|PAVIMENTO|FLOOR PLAN|FACHADA|CORTE/.test(h.normalized)).sort((a,b)=>a.x-b.x);
  const distinct=[];
  for(const p of peers)if(!distinct.some(o=>Math.abs(o.x-p.x)<W*.04))distinct.push(p);
  const gaps=distinct.slice(1).map((p,i)=>p.x-distinct[i].x).filter(g=>g>W*.09);
  const col=gaps.length?median(gaps):(W/H>1.2?W*.31:W*.86);
  const previous=distinct.filter(p=>p.x<anchor.x-W*.04).at(-1);
  const next=distinct.find(p=>p.x>anchor.x+W*.04);
  let left=clamp(anchor.x-col*.15,3,W-10);
  let right=clamp(next?next.x-col*.15:anchor.x+col*.96,left+20,W-3);
  if(!previous && !next && anchor.x>W*.3){left=W*.04;right=W*.96;}
  const rows=new Uint32Array(H);
  for(let y=0;y<H;y++)for(let x=Math.floor(left);x<Math.ceil(right);x++)rows[y]+=ink[y*W+x];
  const whitespace=Math.max(anchor.h*4.8,H*.033);
  function seek(start,dir,maxDistance) {
    let blank=0,last=clamp(Math.round(start),0,H-1),count=0;
    for(let y=last;y>=0&&y<H&&Math.abs(y-start)<maxDistance;y+=dir){
      if(rows[y]>=2){last=y;blank=0;count+=rows[y];}else blank++;
      if(blank>whitespace)break;
    }
    return {last,count};
  }
  const above=seek(anchor.y,-1,H),below=seek(anchor.y+anchor.h,1,H);
  const topTitle=anchor.y<H*.25 && below.count>above.count*1.25;
  let top=topTitle?anchor.y:above.last;
  let bottom=topTitle?below.last:seek(anchor.y+anchor.h,1,Math.max(H*.025,anchor.h*4)).last;
  if(bottom-top<anchor.h*5){top=Math.max(0,anchor.y-H*.46);bottom=anchor.y+anchor.h*3;}
  let minX=right,maxX=left,minY=bottom,maxY=top;
  for(let y=Math.floor(top);y<=Math.ceil(bottom)&&y<H;y++)for(let x=Math.floor(left);x<Math.ceil(right)&&x<W;x++)if(ink[y*W+x]){
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  if(maxX<=minX || maxY<=minY)return {x:left/W,y:top/H,w:(right-left)/W,h:(bottom-top)/H};
  const pad=Math.max(4,Math.min(W,H)*.006);
  left=Math.max(0,minX-pad);right=Math.min(W,maxX+pad);
  top=Math.max(0,minY-pad);bottom=Math.min(H,maxY+pad);
  for(const line of image.horizontalRules){if(line>=top&&line<minY)top=line+2;if(line>maxY&&line<=bottom)bottom=line-2;}
  for(const line of image.verticalRules){if(line>=left&&line<minX)left=line+2;if(line>maxX&&line<=right)right=line-2;}
  return {x:left/W,y:top/H,w:(right-left)/W,h:(bottom-top)/H};
}

export function detectPlans(words,image,method='text') {
  const headings=findHeadings(words),targets=headings.filter(h=>h.target);
  const unique=targets.filter((t,i)=>!targets.slice(0,i).some(o=>Math.abs(t.x-o.x)<image.width*.03&&Math.abs(t.y-o.y)<image.height*.025));
  return unique.map((a,i)=>({label:a.text.replace(/^[\d.\s]+/,'').trim(),baseRect:inferRegion(a,headings,image),method,confidence:method==='text'?'high':'review',anchor:{x:a.x/image.width,y:a.y/image.height},id:`detected-${i}`}));
}

export function expandRect(r,marginPoints,viewport) {
  const mx=marginPoints*viewport.scale/viewport.width,my=marginPoints*viewport.scale/viewport.height;
  const x=clamp(r.x-mx,0,1),y=clamp(r.y-my,0,1);
  return {x,y,w:clamp(r.x+r.w+mx,0,1)-x,h:clamp(r.y+r.h+my,0,1)-y};
}

export function rectToPdf(viewport,r) {
  const a=viewport.convertToPdfPoint(r.x*viewport.width,r.y*viewport.height);
  const b=viewport.convertToPdfPoint((r.x+r.w)*viewport.width,(r.y+r.h)*viewport.height);
  return {x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),w:Math.abs(a[0]-b[0]),h:Math.abs(a[1]-b[1])};
}
