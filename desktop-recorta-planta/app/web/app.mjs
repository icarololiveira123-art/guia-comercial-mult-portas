import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
import {clamp,prepareInk,detectPlans,expandRect,rectToPdf} from './detector.mjs';
import {createCroppedPdf,createRasterizedPdf} from './pdf-output.mjs';
import {pdfTextWords,ocrWords} from './text-input.mjs';
import {LIMITS,checkPageCount,checkTextContent,withinTime} from './processing-limits.mjs';

pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',import.meta.url).href;
const $=id=>document.getElementById(id);
const state={pdf:null,loadingTask:null,renderTasks:new Set(),bytes:null,file:null,page:1,results:[],selected:null,view:null,canvas:null,job:0,busy:false,draw:false,renderId:0,worker:null,workerPromise:null,workerGeneration:0,ocrErrors:0};
const tick=()=>new Promise(resolve=>requestAnimationFrame(resolve));
let toastTimer,installPrompt;

function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5200);}
function error(message,title='Não foi possível abrir o PDF'){$('errorTitle').textContent=title;$('errorMessage').textContent=message;if(!$('errorDialog').open)$('errorDialog').showModal();}
$('closeError').onclick=()=>$('errorDialog').close();
$('errorDialog').addEventListener('click',e=>{if(e.target===$('errorDialog'))$('errorDialog').close();});
const selectFile=()=>{if(!state.busy)$('fileInput').click();};
$('selectFile').onclick=selectFile;$('newFile').onclick=selectFile;
$('fileInput').onchange=e=>{const f=e.target.files[0];if(f)openFile(f);e.target.value='';};
for(const event of ['dragenter','dragover'])$('dropZone').addEventListener(event,e=>{e.preventDefault();$('dropZone').classList.add('dragging');});
for(const event of ['dragleave','drop'])$('dropZone').addEventListener(event,e=>{e.preventDefault();$('dropZone').classList.remove('dragging');});
$('dropZone').addEventListener('drop',e=>{const files=[...e.dataTransfer.files];if(files.length>1)toast('Abra um PDF por vez.');if(files[0])openFile(files[0]);});
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',e=>e.preventDefault());

function busy(value){
  state.busy=value;document.body.classList.toggle('busy',value);$('progressArea').hidden=!value;
  for(const id of ['newFile','drawMode','resetCrop','ocrButton','pageSelect','previousPage','nextPage','downloadAll','margin','zoomButton','exportMode'])$(id).disabled=value;
  $('downloadButton').disabled=value||!currentSelection();
  if(!value&&state.pdf){$('previousPage').disabled=state.page===1;$('nextPage').disabled=state.page===state.pdf.numPages;}
  renderResults();
}
function progress(title,message,fraction){$('progressTitle').textContent=title;$('progressText').textContent=message;$('progressFill').style.width=`${clamp(fraction,0,1)*100}%`;}
function setStatus(text){$('documentStatus').textContent=text;}

async function openFile(file){
  if(state.busy)return;
  if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf'){error('Selecione um arquivo com a extensão .pdf.','Esse arquivo não é um PDF');return;}
  if(file.size>LIMITS.fileBytes){error('Este arquivo tem mais de 100 MB. Divida o PDF em arquivos menores para continuar.','O PDF é muito grande');return;}
  const job=++state.job;
  busy(true);$('workspace').hidden=false;$('welcome').hidden=true;$('newFile').hidden=false;
  $('fileName').textContent=file.name;$('fileName').title=file.name;
  $('fileMeta').textContent=`${(file.size/1024/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB`;
  setStatus('Abrindo PDF');progress('Abrindo arquivo','Preparando a leitura do seu projeto…',.02);
  state.results=[];state.selected=null;state.view=null;state.ocrErrors=0;
  $('selection').hidden=true;$('pdfCanvas').width=1;$('pdfCanvas').height=1;$('cropPreview').width=1;$('cropPreview').height=1;
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(job!==state.job)return;
    const header=new TextDecoder('latin1').decode(bytes.slice(0,1024));
    if(!header.includes('%PDF-'))throw new Error('O arquivo não contém um PDF válido. Tente exportá-lo novamente no programa de origem.');
    if(state.pdf)await state.pdf.loadingTask.destroy();
    if(job!==state.job)return;
    state.pdf=null;
    const task=pdfjs.getDocument({data:bytes.slice(),cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/pdfjs/wasm/',import.meta.url).href,isEvalSupported:false,enableScripting:false,maxImageSize:LIMITS.imagePixels,canvasMaxAreaInBytes:32*1024*1024});
    state.loadingTask=task;
    task.onPassword=()=>{task.destroy();error('Este PDF é protegido por senha. Exporte uma cópia sem senha e abra essa cópia.','PDF protegido por senha');};
    const pdf=await withinTime(task.promise,LIMITS.loadMs,()=>{void task.destroy().catch(()=>{});});
    if(job!==state.job){await pdf.loadingTask.destroy();return;}
    state.loadingTask=null;
    state.pdf=pdf;
    checkPageCount(pdf.numPages);
    state.bytes=bytes;state.file=file;state.page=1;
    $('fileMeta').textContent=`${state.pdf.numPages} ${state.pdf.numPages===1?'página':'páginas'} · ${(file.size/1024/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB`;
    const options=Array.from({length:state.pdf.numPages},(_,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent=`Página ${i+1} de ${state.pdf.numPages}`;return o;});
    $('pageSelect').replaceChildren(...options);
    await showPage(1);
    const scanned=Math.min(state.pdf.numPages,LIMITS.automaticPages);
    await analyzePages(Array.from({length:scanned},(_,i)=>i+1),job);
    if(job===state.job&&scanned<state.pdf.numPages)toast(`Análise automática limitada às primeiras ${scanned} páginas. Nas demais, selecione a página e use Ler imagem ou desenhe o recorte.`);
  }catch(e){
    if(job!==state.job)return;
    console.error('Falha ao abrir PDF:',e);
    if(state.loadingTask){void state.loadingTask.destroy().catch(()=>{});state.loadingTask=null;}
    if(state.pdf){void state.pdf.loadingTask.destroy().catch(()=>{});state.pdf=null;}
    state.bytes=null;state.file=null;
    $('workspace').hidden=true;$('welcome').hidden=false;$('newFile').hidden=true;
    if(!$('errorDialog').open)error(e.name==='PasswordException'?'Este PDF é protegido por senha. Envie uma cópia desbloqueada.':e.name==='TimeoutError'||/PDF válido|até \d+ páginas|texto demais/.test(e.message||'')?e.message:'Não consegui ler este arquivo. Verifique se o PDF abre normalmente e tente uma cópia exportada novamente.');
  }finally{if(job===state.job){busy(false);updateSelection();}}
}

async function renderPage(pageNumber,longSide=1800){
  const pdfDocument=state.pdf,job=state.job;
  const page=await withinTime(pdfDocument.getPage(pageNumber),LIMITS.renderMs),natural=page.getViewport({scale:1});
  if(pdfDocument!==state.pdf||job!==state.job)throw new DOMException('Análise interrompida','AbortError');
  if(!Number.isFinite(natural.width+natural.height)||natural.width<=0||natural.height<=0)throw new Error('A página tem dimensões inválidas.');
  const scale=Math.min(longSide/Math.max(natural.width,natural.height),3);
  const viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const context=canvas.getContext('2d',{willReadFrequently:true});
  const task=page.render({canvasContext:context,viewport,background:'rgb(255,255,255)'});
  state.renderTasks.add(task);
  try{await withinTime(task.promise,LIMITS.renderMs,()=>task.cancel());}
  catch(error){canvas.width=1;canvas.height=1;throw error;}
  finally{state.renderTasks.delete(task);}
  return {page,canvas,viewport};
}
async function getOCRWorker(){
  if(state.worker)return state.worker;
  if(state.workerPromise)return state.workerPromise;
  if(!window.Tesseract)throw new Error('O leitor de imagens ainda não carregou. Atualize a página e tente novamente.');
  const generation=state.workerGeneration;
  state.workerPromise=window.Tesseract.createWorker('eng',1,{
    workerPath:new URL('./vendor/ocr/worker.min.js',import.meta.url).href,
    corePath:new URL('./vendor/ocr/core',import.meta.url).href,
    langPath:new URL('./vendor/ocr/lang',import.meta.url).href,
    cacheMethod:'none',workerBlobURL:false,
    logger:m=>{if(state.busy&&m.status==='recognizing text')$('progressText').textContent=`Lendo os títulos da imagem… ${Math.round(m.progress*100)}%`;}
  }).then(async worker=>{
    if(generation!==state.workerGeneration){await worker.terminate();throw new DOMException('Análise interrompida','AbortError');}
    await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
    if(generation!==state.workerGeneration){await worker.terminate();throw new DOMException('Análise interrompida','AbortError');}
    state.worker=worker;state.workerPromise=null;return worker;
  }).catch(e=>{if(generation===state.workerGeneration)state.workerPromise=null;throw e;});
  return withinTime(state.workerPromise,LIMITS.ocrMs,()=>{if(generation===state.workerGeneration){state.workerGeneration++;state.workerPromise=null;}});
}

async function recognizePage(pageNumber,lowRender,job){
  const worker=await getOCRWorker();
  if(job!==state.job)throw new DOMException('Análise interrompida','AbortError');
  const high=await renderPage(pageNumber,navigator.deviceMemory&&navigator.deviceMemory<4?3200:4400);
  try{
    if(job!==state.job)throw new DOMException('Análise interrompida','AbortError');
    const {data}=await withinTime(worker.recognize(high.canvas,{}, {text:true,blocks:true}),LIMITS.ocrMs,()=>{
      if(state.worker===worker){state.worker=null;state.workerGeneration++;}
      void worker.terminate().catch(()=>{});
    });
    const sx=lowRender.canvas.width/high.canvas.width,sy=lowRender.canvas.height/high.canvas.height;
    return ocrWords(data.blocks).map(w=>({...w,x:w.x*sx,y:w.y*sy,w:w.w*sx,h:w.h*sy}));
  }finally{high.canvas.width=1;high.canvas.height=1;}
}

async function analyzePages(pages,job,forceOCR=false){
  let canceled=false;
  for(let i=0;i<pages.length;i++){
    if(job!==state.job){canceled=true;break;}
    const number=pages[i];setStatus('Procurando plantas');
    progress('Analisando projeto',`Página ${number} de ${state.pdf.numPages} · procurando a planta baixa`,(i+.2)/pages.length);
    const rendered=await renderPage(number);
    if(job!==state.job){rendered.canvas.width=1;break;}
    const content=await withinTime(rendered.page.getTextContent(),LIMITS.renderMs);
    checkTextContent(content);
    const words=pdfTextWords(pdfjs,content,rendered.viewport);
    const context=rendered.canvas.getContext('2d',{willReadFrequently:true});
    const ink=prepareInk(context.getImageData(0,0,rendered.canvas.width,rendered.canvas.height));
    let plans=detectPlans(words,ink,'text');
    const characters=words.reduce((n,w)=>n+w.text.length,0);
    if(forceOCR||(!plans.length&&characters<600)){
      progress('Lendo PDF escaneado',`Página ${number} · preparando a leitura da imagem. A primeira leitura pode demorar um pouco.`,(i+.45)/pages.length);
      try{
        const recognized=await recognizePage(number,rendered,job);
        if(job!==state.job){rendered.canvas.width=1;canceled=true;break;}
        const ocrPlans=detectPlans(recognized,ink,'ocr');
        if(ocrPlans.length)plans=ocrPlans;
      }catch(e){if(job===state.job){console.error('Leitura de imagem:',e);state.ocrErrors++;}}
    }
    if(job!==state.job){rendered.canvas.width=1;canceled=true;break;}
    state.results=state.results.filter(r=>r.pageNumber!==number||r.method==='manual');
    for(let j=0;j<plans.length;j++)state.results.push({...plans[j],id:`p${number}-${j}`,pageNumber:number,rect:{...plans[j].baseRect},margin:0});
    rendered.canvas.width=1;rendered.canvas.height=1;renderResults();await tick();
  }
  if(job!==state.job)return;
  if(state.results.length){state.selected=state.results[0].id;await showPage(state.results[0].pageNumber);}
  else if(state.pdf)await showPage(state.page);
  if(!canceled){
    const n=state.results.filter(r=>r.method!=='manual').length;
    setStatus(n?`${n} ${n===1?'planta encontrada':'plantas encontradas'}`:'Marque a área da planta');
    if(!n)toast(state.ocrErrors?'A leitura da imagem não foi concluída. Você pode desenhar o recorte manualmente.':'Não encontrei um título de planta baixa. Use “Desenhar nova área” para marcar a planta.');
    else if(forceOCR)toast('Leitura da imagem concluída. Confira o recorte sugerido.');
  }
  renderResults();updateSelection();
}

$('cancelScan').onclick=async()=>{
  ++state.job;
  ++state.workerGeneration;
  ++state.renderId;
  for(const task of state.renderTasks)task.cancel();
  state.renderTasks.clear();
  if(state.loadingTask){const task=state.loadingTask;state.loadingTask=null;void task.destroy().catch(()=>{});}
  state.workerPromise=null;
  if(state.worker){const w=state.worker;state.worker=null;state.workerPromise=null;await w.terminate().catch(()=>{});}
  busy(false);setStatus('Análise interrompida');
  if(state.results.length){state.selected=state.results[0].id;await showPage(state.results[0].pageNumber);}else if(state.pdf)await showPage(state.page);
  else{$('workspace').hidden=true;$('welcome').hidden=false;$('newFile').hidden=true;}
  toast('Análise interrompida. Os recortes já encontrados estão disponíveis.');
};

function currentSelection(){return state.results.find(r=>r.id===state.selected&&r.pageNumber===state.page);}
function ensureManual(pageNumber){
  let r=state.results.find(r=>r.pageNumber===pageNumber&&r.method==='manual');
  if(!r){r={id:`manual-${pageNumber}`,label:'Recorte manual',pageNumber,method:'manual',margin:0,baseRect:{x:.12,y:.09,w:.76,h:.82},rect:{x:.12,y:.09,w:.76,h:.82}};state.results.push(r);}
  return r;
}
function renderResults(){
  const automatic=state.results.filter(r=>r.method!=='manual');
  $('resultCount').textContent=automatic.length;
  $('results').replaceChildren(...state.results.map(r=>{
    const b=document.createElement('button');b.className=`result-item ${r.id===state.selected?'active':''}`;b.disabled=state.busy;
    b.setAttribute('aria-pressed',String(r.id===state.selected));
    const radio=document.createElement('span');radio.className='result-radio';
    const info=document.createElement('span');info.className='result-info';
    const name=document.createElement('strong');name.textContent=r.label;name.title=r.label;
    const small=document.createElement('small');small.textContent=`Página ${r.pageNumber} · ${r.method==='ocr'?'leitura de imagem':r.method==='manual'?'seleção manual':'texto identificado'}`;
    info.append(name,small);b.append(radio,info);
    b.onclick=async()=>{state.selected=r.id;$('margin').value=r.margin||0;await showPage(r.pageNumber);renderResults();};return b;
  }));
  $('noResults').hidden=state.busy||automatic.some(r=>r.pageNumber===state.page);
  $('downloadAll').hidden=state.results.length<2;
  $('downloadAll').textContent=`Baixar todos os recortes (${state.results.length})`;
}

async function showPage(number){
  if(!state.pdf)return;
  const renderId=++state.renderId;
  state.page=clamp(Number(number),1,state.pdf.numPages);$('pageSelect').value=state.page;
  let rendered;
  try{rendered=await renderPage(state.page,2400);}
  catch(e){if(e.name!=='AbortError'&&e.name!=='RenderingCancelledException')error(e.name==='TimeoutError'?e.message:'Não foi possível mostrar esta página. Tente uma cópia simplificada do PDF.','Página indisponível');return;}
  if(renderId!==state.renderId){rendered.canvas.width=1;return;}
  const main=$('pdfCanvas');main.width=rendered.canvas.width;main.height=rendered.canvas.height;
  main.getContext('2d').drawImage(rendered.canvas,0,0);rendered.canvas.width=1;
  state.view=rendered.viewport;state.canvas=main;
  if(!currentSelection()){
    const result=state.results.find(r=>r.pageNumber===state.page);
    if(result)state.selected=result.id;
    else if(!state.busy)state.selected=ensureManual(state.page).id;
  }
  fitPage();updateSelection();renderResults();
  $('previousPage').disabled=state.busy||state.page===1;$('nextPage').disabled=state.busy||state.page===state.pdf.numPages;
}
function fitPage(){
  if(!state.view)return;
  const frame=$('canvasFrame'),area=$('viewerScroll');
  if(area.classList.contains('zoomed')){
    const r=effectiveRect()||{x:0,y:0,w:1,h:1};
    const cropRatio=state.view.width*r.w/(state.view.height*r.h);
    const cropWidth=Math.min(area.clientWidth-50,(area.clientHeight-60)*cropRatio);
    frame.style.width=`${Math.max(300,cropWidth/r.w)}px`;
    requestAnimationFrame(()=>{area.scrollLeft=Math.max(0,frame.offsetLeft+r.x*frame.clientWidth-(area.clientWidth-r.w*frame.clientWidth)/2);area.scrollTop=Math.max(0,frame.offsetTop+r.y*frame.clientHeight-(area.clientHeight-r.h*frame.clientHeight)/2);});
  }
  else{const padding=window.innerWidth<=700?40:64;frame.style.width=`${Math.min(area.clientWidth-padding,(area.clientHeight-padding)*state.view.width/state.view.height)}px`;}
  frame.style.aspectRatio=`${state.view.width} / ${state.view.height}`;
}
new ResizeObserver(fitPage).observe($('viewerScroll'));
$('zoomButton').onclick=()=>{$('viewerScroll').classList.toggle('zoomed');$('zoomButton').querySelector('span').textContent=$('viewerScroll').classList.contains('zoomed')?'Ver prancha inteira':'Focar planta';fitPage();};
$('previousPage').onclick=()=>showPage(state.page-1);$('nextPage').onclick=()=>showPage(state.page+1);$('pageSelect').onchange=e=>showPage(e.target.value);

function effectiveRect(result=currentSelection(),viewport=state.view){return result&&viewport?expandRect(result.rect,(result.margin||0)*72/25.4,viewport):null;}
function updateSelection(){
  const s=currentSelection(),r=effectiveRect(s),box=$('selection');box.hidden=!r;
  $('downloadButton').disabled=state.busy||!r;
  if(!r||!state.canvas)return;
  box.style.left=`${r.x*100}%`;box.style.top=`${r.y*100}%`;box.style.width=`${r.w*100}%`;box.style.height=`${r.h*100}%`;
  $('selectionCaption').textContent=s.method==='manual'?'Seu recorte':s.label;
  $('margin').value=s.margin||0;$('marginValue').textContent=`${s.margin||0} mm`;
  const wCm=r.w*state.view.width/state.view.scale/72*2.54,hCm=r.h*state.view.height/state.view.scale/72*2.54;
  $('cropSize').textContent=`${wCm.toLocaleString('pt-BR',{maximumFractionDigits:1})} × ${hCm.toLocaleString('pt-BR',{maximumFractionDigits:1})} cm · página ${s.pageNumber}`;
  const preview=$('cropPreview'),ratio=r.w*state.canvas.width/(r.h*state.canvas.height);
  preview.width=Math.max(1,Math.round(Math.min(430,220*ratio)));preview.height=Math.max(1,Math.round(preview.width/ratio));
  preview.getContext('2d').drawImage(state.canvas,r.x*state.canvas.width,r.y*state.canvas.height,r.w*state.canvas.width,r.h*state.canvas.height,0,0,preview.width,preview.height);
}
$('margin').oninput=e=>{const s=currentSelection();if(s){s.margin=Number(e.target.value);updateSelection();}};
$('resetCrop').onclick=()=>{const s=currentSelection();if(s){s.rect={...s.baseRect};s.margin=0;updateSelection();toast('Recorte restaurado.');}};
$('drawMode').onclick=()=>{
  state.draw=!state.draw;$('drawMode').classList.toggle('active',state.draw);$('selectionLayer').classList.toggle('drawing',state.draw);
  $('drawMode').lastChild.textContent=state.draw?' Clique e arraste sobre a planta':'Desenhar nova área';
  if(state.draw)toast('Clique e arraste sobre a página para desenhar uma nova seleção.');
};

let drag=null;
const point=e=>{const b=$('selectionLayer').getBoundingClientRect();return {x:clamp((e.clientX-b.left)/b.width,0,1),y:clamp((e.clientY-b.top)/b.height,0,1)};};
$('selectionLayer').addEventListener('pointerdown',e=>{
  if(state.busy||!state.pdf||!state.view||e.button!==0)return;
  const handle=e.target.closest('[data-handle]')?.dataset.handle;
  const inSelection=e.target.closest('#selection');
  if(!state.draw&&!inSelection)return;
  e.preventDefault();
  const p=point(e);let selection=currentSelection();
  if(state.draw){selection=ensureManual(state.page);state.selected=selection.id;selection.margin=0;selection.rect={x:p.x,y:p.y,w:.005,h:.005};renderResults();}
  if(!selection)return;
  if(selection.margin){selection.rect={...effectiveRect(selection)};selection.margin=0;}
  drag={start:p,rect:{...selection.rect},mode:state.draw?'draw':handle||'move',id:e.pointerId};
  $('selectionLayer').setPointerCapture(e.pointerId);updateSelection();
});
$('selectionLayer').addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;e.preventDefault();
  const s=currentSelection();if(!s)return;
  const p=point(e),dx=p.x-drag.start.x,dy=p.y-drag.start.y,a=drag.rect;
  if(drag.mode==='draw')s.rect={x:Math.min(p.x,drag.start.x),y:Math.min(p.y,drag.start.y),w:Math.max(.005,Math.abs(p.x-drag.start.x)),h:Math.max(.005,Math.abs(p.y-drag.start.y))};
  else if(drag.mode==='move')s.rect={...a,x:clamp(a.x+dx,0,1-a.w),y:clamp(a.y+dy,0,1-a.h)};
  else{
    let x=a.x,y=a.y,x2=a.x+a.w,y2=a.y+a.h;
    if(drag.mode.includes('w'))x=clamp(a.x+dx,0,x2-.01);
    if(drag.mode.includes('e'))x2=clamp(a.x+a.w+dx,x+.01,1);
    if(drag.mode.includes('n'))y=clamp(a.y+dy,0,y2-.01);
    if(drag.mode.includes('s'))y2=clamp(a.y+a.h+dy,y+.01,1);
    s.rect={x,y,w:x2-x,h:y2-y};
  }
  updateSelection();
});
function endDrag(e){if(!drag||e.pointerId!==drag.id)return;drag=null;if(state.draw){state.draw=false;$('drawMode').classList.remove('active');$('selectionLayer').classList.remove('drawing');$('drawMode').lastChild.textContent='Desenhar nova área';}updateSelection();}
$('selectionLayer').addEventListener('pointerup',endDrag);$('selectionLayer').addEventListener('pointercancel',endDrag);
$('selection').addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||state.busy)return;e.preventDefault();
  const s=currentSelection();if(!s)return;
  const d=.0025,dx=e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0,dy=e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0;
  if(e.shiftKey){s.rect.w=clamp(s.rect.w+dx,.01,1-s.rect.x);s.rect.h=clamp(s.rect.h+dy,.01,1-s.rect.y);}
  else{s.rect.x=clamp(s.rect.x+dx,0,1-s.rect.w);s.rect.y=clamp(s.rect.y+dy,0,1-s.rect.h);}
  updateSelection();
});
$('ocrButton').onclick=async()=>{
  if(state.busy||!state.pdf)return;
  const job=++state.job;busy(true);
  try{await analyzePages([state.page],job,true);}catch(e){error('Não consegui concluir a leitura. Você pode desenhar e baixar o recorte manualmente.','Leitura de imagem indisponível');}
  finally{if(job===state.job){busy(false);updateSelection();}}
};

async function download(all=false){
  if(state.busy||!state.bytes)return;
  const selected=all?state.results:[currentSelection()];if(!selected[0])return;
  const button=$(all?'downloadAll':'downloadButton'),job=state.job;
  const sanitized=$('exportMode').value==='sanitized';
  busy(true);button.disabled=true;
  progress('Preparando PDF',sanitized?'Criando imagens somente das áreas selecionadas…':'Preservando linhas e texto, com ações desativadas…',.1);
  try{
    const selections=[];
    for(const s of selected){const page=await state.pdf.getPage(s.pageNumber);const viewport=page.getViewport({scale:1});selections.push({pageNumber:s.pageNumber,viewport,rect:effectiveRect(s,viewport)});}
    const bytes=sanitized?await createRasterizedPdf(window.PDFLib,selections,renderSelection):await createCroppedPdf(window.PDFLib,state.bytes,selections);
    if(job!==state.job)return;
    const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;const base=state.file.name.replace(/\.pdf$/i,'').replace(/[^\p{L}\p{N} _.-]/gu,'').slice(0,90)||'projeto';
    a.download=`${base}_${all?'plantas':'planta_p'+state.page}${sanitized?'_sanitizada':''}.pdf`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast(`${all?'Recortes prontos':'Planta pronta'}. Confira o download no navegador.`);
  }catch(e){if(job!==state.job)return;console.error('Exportação:',e);error(/encrypt/i.test(e.message)?'O PDF está protegido. Abra uma cópia sem senha para exportar o recorte.':e.name==='TimeoutError'||/Exporte até/.test(e.message)?e.message:'Não consegui gerar o PDF. Confira a seleção e tente novamente.','Não foi possível baixar o recorte');}
  finally{if(job===state.job)busy(false);}
}

async function renderSelection(selection){
  const pdfDocument=state.pdf,job=state.job;
  const page=await withinTime(pdfDocument.getPage(selection.pageNumber),LIMITS.renderMs);
  if(pdfDocument!==state.pdf||job!==state.job)throw new DOMException('Análise interrompida','AbortError');
  const box=rectToPdf(selection.viewport,selection.rect);
  const scale=Math.min(150/72,LIMITS.exportLongSide/Math.max(box.w,box.h));
  const viewport=page.getViewport({scale});
  const x=selection.rect.x*viewport.width,y=selection.rect.y*viewport.height;
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.ceil(selection.rect.w*viewport.width));
  canvas.height=Math.max(1,Math.ceil(selection.rect.h*viewport.height));
  try{
    const task=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[1,0,0,1,-x,-y],background:'rgb(255,255,255)'});
    state.renderTasks.add(task);
    try{await withinTime(task.promise,LIMITS.renderMs,()=>task.cancel());}finally{state.renderTasks.delete(task);}
    if(pdfDocument!==state.pdf||job!==state.job)throw new DOMException('Análise interrompida','AbortError');
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Não foi possível gerar a imagem.')),'image/png'));
    return {pngBytes:new Uint8Array(await blob.arrayBuffer()),width:viewport.width*selection.rect.w/scale,height:viewport.height*selection.rect.h/scale};
  }finally{canvas.width=1;canvas.height=1;}
}

$('exportMode').onchange=()=>{
  $('exportSecurityHint').textContent=$('exportMode').value==='sanitized'?'Sanitizado: salva só a área visível como imagem, até 150 dpi. Remove conteúdo externo e elementos ativos; linhas e textos deixam de ser vetoriais.':'Vetorial: mantém linhas e texto. Ações são desativadas, mas informações fora do recorte continuam no arquivo. Para removê-las, escolha Sanitizado.';
};
$('downloadButton').onclick=()=>download(false);$('downloadAll').onclick=()=>download(true);

async function createDemo(){
  if(!window.PDFLib)throw new Error('Aguarde um instante e tente novamente.');
  const {PDFDocument,StandardFonts,rgb}=window.PDFLib,doc=await PDFDocument.create();
  const page=doc.addPage([1200,820]),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const gray=rgb(.28,.34,.29),light=rgb(.75,.79,.72);
  const text=(s,x,y,size=10,heavy=false)=>page.drawText(s,{x,y,size,font:heavy?bold:font,color:gray});
  const line=(x,y,x2,y2,width=1)=>page.drawLine({start:{x,y},end:{x:x2,y:y2},thickness:width,color:gray});
  page.drawRectangle({x:26,y:26,width:1148,height:768,borderColor:light,borderWidth:.7});
  text('PROJETO DE EXEMPLO',60,749,12,true);text('Documento ficticio para conhecer o aplicativo',60,729,8);
  page.drawRectangle({x:119,y:171,width:321,height:497,borderWidth:3,borderColor:gray});
  line(119,490,440,490,3);line(280,490,280,668,3);line(119,349,440,349,3);line(299,171,299,349,3);line(299,263,440,263,3);
  text('QUARTO',167,577,12);text('12,5 m2',171,558,9);text('COZINHA',322,577,12);text('11,8 m2',331,558,9);text('SALA / JANTAR',222,420,12);text('24,6 m2',245,401,9);text('GARAGEM',166,260,12);text('21,3 m2',176,241,9);text('BANHO',345,301,11);text('LAVANDERIA',329,214,10);
  for(const y of [181,344,485,666]){line(98,y,107,y,.6);}line(103,181,103,666,.6);text('18,00',66,408,9);line(120,688,440,688,.6);line(120,683,120,693,.6);line(440,683,440,693,.6);text('10,00',262,698,9);
  text('PLANTA BAIXA',118,117,15,true);line(118,107,281,107,.8);text('Escala 1:100',118,90,9);
  page.drawRectangle({x:590,y:171,width:270,height:497,borderWidth:1,borderColor:gray});
  for(let x=599;x<858;x+=10)line(x,174,x,663,.5);text('PLANTA DE COBERTURA',590,117,15,true);text('Escala 1:100',590,90,9);
  page.drawRectangle({x:945,y:75,width:190,height:155,borderColor:light,borderWidth:1});text('EXEMPLO',964,200,12,true);text('RECORTA PLANTA',964,179,10);text('Nenhum dado real',964,151,9);text('Arquivo de demonstracao',964,133,8);
  return new File([await doc.save()], 'projeto_exemplo.pdf',{type:'application/pdf'});
}
$('demoButton').onclick=async()=>{try{$('demoButton').disabled=true;await openFile(await createDemo());}catch(e){error(e.message,'Não consegui carregar o exemplo');}finally{$('demoButton').disabled=false;}};

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installButton').hidden=false;});
$('installButton').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('installButton').hidden=true;}};
if(location.protocol!=='recorta:' && 'serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));

