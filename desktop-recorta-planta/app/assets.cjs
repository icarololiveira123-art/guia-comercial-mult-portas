'use strict';
const path=require('node:path');
const fs=require('node:fs/promises');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.wasm':'application/wasm','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.pdf':'application/pdf'};
const CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; font-src 'self' blob: data:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'";

function resolveAsset(url,root){
  let u,decoded;
  try{u=new URL(url);decoded=decodeURIComponent(u.pathname);}catch{return {status:400};}
  if(u.protocol!=='recorta:'||u.hostname!=='app'||u.username||u.password||u.port)return {status:403};
  if(decoded.includes('\0')||decoded.includes('\\'))return {status:403};
  if(decoded==='/'||decoded==='')decoded='/index.html';
  const absolute=path.resolve(root,'.'+decoded),relative=path.relative(root,absolute);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return {status:403};
  return {status:200,path:absolute,type:MIME[path.extname(absolute).toLowerCase()]||'application/octet-stream'};
}

async function serveAsset(request,root){
  if(!['GET','HEAD'].includes(request.method))return new Response('Método não permitido',{status:405});
  const asset=resolveAsset(request.url,root);
  if(asset.status!==200)return new Response('Recurso indisponível',{status:asset.status});
  try{
    const body=await fs.readFile(asset.path);
    return new Response(request.method==='HEAD'?null:body,{status:200,headers:{'Content-Type':asset.type,'Content-Length':String(body.length),'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'}});
  }catch{return new Response('Arquivo não encontrado',{status:404});}
}
module.exports={resolveAsset,serveAsset,CSP};
