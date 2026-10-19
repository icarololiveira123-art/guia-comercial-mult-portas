export const LIMITS=Object.freeze({fileBytes:100*1024*1024,pages:300,automaticPages:30,textItems:20000,exportPages:100,imagePixels:32*1024*1024,renderMs:45000,loadMs:45000,ocrMs:90000,exportLongSide:4400});

export function checkPageCount(count){
  if(!Number.isSafeInteger(count)||count<1||count>LIMITS.pages)throw new Error(`Abra um PDF com até ${LIMITS.pages} páginas. Divida documentos maiores antes de continuar.`);
}

export function checkTextContent(content){
  if(!Array.isArray(content?.items)||content.items.length>LIMITS.textItems)throw new Error('Esta página contém texto demais para uma análise segura. Exporte uma cópia simplificada ou selecione outra página.');
}

export async function withinTime(promise,milliseconds,onTimeout=()=>{},message='O processamento demorou demais. Tente um PDF mais simples.'){
  let timer;
  try{
    return await Promise.race([promise,new Promise((_resolve,reject)=>{
      timer=setTimeout(()=>{
        const error=new Error(message);error.name='TimeoutError';
        try{onTimeout();}catch{}
        reject(error);
      },milliseconds);
    })]);
  }finally{clearTimeout(timer);}
}
