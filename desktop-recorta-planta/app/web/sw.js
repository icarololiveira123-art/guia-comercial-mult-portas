const CACHE='recorta-planta-v1';
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/style.css','/app.mjs','/detector.mjs','/pdf-output.mjs','/text-input.mjs','/icon.svg'])));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('recorta-planta-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const r=event.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==self.location.origin||(!u.pathname.startsWith('/vendor/')&&!['/','/index.html','/style.css','/app.mjs','/detector.mjs','/pdf-output.mjs','/text-input.mjs','/icon.svg','/icon-192.png','/icon-512.png'].includes(u.pathname)))return;
  event.respondWith(fetch(r).then(response=>{if(response.ok&&!response.redirected){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(r,copy)));}return response;}).catch(()=>caches.match(r).then(cached=>cached||Response.error())));
});
