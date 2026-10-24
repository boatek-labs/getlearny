const CACHE_NAME='getlearny-shell-v12';
const SHELL_ASSETS=[
 '/',
 '/index.html',
 '/styles.css?v=20261024-session-nav2',
 '/focus.css?v=20261019-3',
 '/revision.css?v=20261019-4',
 '/app.js?v=20261024-session-nav2',
 '/focus.js?v=20261019-3',
 '/revision.js?v=20261019-4',
 '/manifest.json',
 '/assets/getlearny-mark.svg'
];

self.addEventListener('install',event=>{
 self.skipWaiting();
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>Promise.all(SHELL_ASSETS.map(asset=>cache.add(asset).catch(()=>null)))));
});

self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('getlearny-shell-')&&key!==CACHE_NAME).map(key=>caches.delete(key))))
 ]));
});

self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 // Never cache API, account, AI, document or other user data responses.
 if(url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;

 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(response=>{
   if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put('/index.html',copy));}
   return response;
  }).catch(async()=>{
   return (await caches.match('/index.html'))||(await caches.match('/'))||new Response('GetLearny is unavailable offline. Connect once to load the app shell.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }));
  return;
 }

 if(['style','script','image','font'].includes(request.destination)){
  event.respondWith(caches.match(request).then(cached=>{
   const refresh=fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));}
    return response;
   }).catch(()=>cached);
   return cached||refresh;
  }));
 }
});

self.addEventListener('message',event=>{
 if(event.data?.type==='SHOW_NOTIFICATION'){
  const data=event.data.payload||{};
  event.waitUntil(self.registration.showNotification(data.title||'GetLearny',{
   body:data.body||'Your study time is here.',
   icon:'/assets/getlearny-mark.svg',
   badge:'/assets/getlearny-mark.svg',
   tag:data.tag||'getlearny-reminder',
   data:{url:data.url||'/'},
   vibrate:[120,70,120]
  }));
 }
});

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=event.notification.data?.url||'/';
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
  for(const client of list){
   if('focus'in client){client.navigate(url);return client.focus();}
  }
  return self.clients.openWindow(url);
 }));
});

self.addEventListener('push',event=>{
 let data={title:'GetLearny',body:'Your next study session is waiting.',url:'/'};
 try{data={...data,...event.data.json()}}catch{}
 event.waitUntil(self.registration.showNotification(data.title,{
  body:data.body,
  icon:'/assets/getlearny-mark.svg',
  badge:'/assets/getlearny-mark.svg',
  data:{url:data.url||'/'},
  tag:data.tag||'getlearny-push'
 }));
});
