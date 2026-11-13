const memory=new Map();
async function readFeed(key,ttl,parse,env){
  const prior=memory.get(key);
  if(prior && Date.now()-prior.at<ttl) return prior;
  const response=await fetch('https://global.flashscore.ninja/2/x/feed/'+key,{headers:{'x-fsign':env.FLASHSCORE_FSIGN,'Referer':'https://www.flashscore.com/','Accept':'*/*'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw Error('Flashscore returned HTTP '+response.status);
  const body=await response.text();
  if(body.trimStart().startsWith('<')) throw Error('Unexpected Flashscore response');
  const result={at:Date.now(),data:parse(body)};
  if(memory.size>256) memory.clear();
  memory.set(key,result);
  return result;
}
export default {async fetch(request,env,ctx){
  const path=new URL(request.url).pathname;
  if(path in assets) return new Response(assets[path],{headers:{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'}});
  if(/^\/api\/audit\/[A-Za-z0-9]{6,12}$/.test(path)&&request.method==='POST'){
   try{return await audit(env?.BUCKET,path.split('/').pop())}catch{return Response.json({error:'Forecast archive unavailable'},{status:503})}
  }
  if(/^\/api\/stats\/[A-Za-z0-9]{6,12}$/.test(path)){
   try{
    const id=path.split('/').pop();
    const [feed,stats]=await Promise.all([readFeed('f_1_0_0_en_1',2000,fixtures,env),readFeed('df_st_1_'+id,15000,matchStats,env)]);
    const m=feed.data.find(g=>g.id===id);
    return Response.json({id,at:stats.at,data:stats.data,score:m?[m.hg,m.ag]:[],stage:m?.stage},{headers:{'Cache-Control':'no-store'}});
   }catch{return Response.json({error:'Live statistics unavailable'},{status:503})}
  }
  if(path==='/api/backfill-form'&&request.method==='POST'){
   const result=await backfillForm(env.BUCKET,new URL(request.url).searchParams.get('after'));
   return Response.json(result);
  }
  if(path==='/api/collect'&&request.method==='POST'){
   const after=new URL(request.url).searchParams.get('after')||'';
   if(!/^[a-zA-Z0-9]{0,12}$/.test(after))return Response.json({error:'Invalid cursor'},{status:400});
   try{return Response.json(await sweep(env?.BUCKET,after),{headers:{'Cache-Control':'no-store'}})}
   catch{return Response.json({error:'Collection unavailable'},{status:503})}
  }
  let key,parse,ttl;
  if(path==='/api/live'||path==='/api/fixtures'){ key='f_1_0_0_en_1';parse=fixtures;ttl=2000; }
  else if(/^\/api\/history\/[A-Za-z0-9]{6,12}$/.test(path)){key='df_hh_1_'+path.split('/').pop();parse=previous;ttl=1800000;}
  else return new Response('Page not found',{status:404});
  function project(result){
    if(path!=='/api/live') return result;
    return {...result,data:result.data.filter(m=>(m.status??'live')==='live')};
  }
  try {const fresh=await readFeed(key,ttl,parse,env);
   if(path.startsWith('/api/history/')&&env?.BUCKET){
    const fixturesFeed=await readFeed('f_1_0_0_en_1',2000,fixtures,env);
    const match=fixturesFeed.data.find(m=>m.id===path.split('/').pop());
    return Response.json({...fresh,data:await archivedForm(env.BUCKET,match,fresh.data)},{headers:{'Cache-Control':'no-store'}});
   }
   if(key==='f_1_0_0_en_1'&&env?.BUCKET&&ctx&&Date.now()-lastReconcile>60000){
    lastReconcile=Date.now();ctx.waitUntil(reconcile(env.BUCKET,fresh.data));
   }
   return Response.json(project(fresh),{headers:{'Cache-Control':'no-store'}});}
  catch(e){
    const last=memory.get(key)||backup[key];
    if(last) return Response.json(project({...last,stale:true,error:'Refresh unavailable'}), {headers:{'Cache-Control':'no-store'}});
    return Response.json({error:'Flashscore is unavailable. Try again shortly.'},{status:503});
  }
}};
