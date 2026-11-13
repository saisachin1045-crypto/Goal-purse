const auditHeaders={'Cache-Control':'no-store'};
let lastReconcile=0;
async function readObject(bucket,key){
 const object=await bucket.get(key);return object?object.json():null;
}
// Review one original forecast per fixture and compare equivalent match stages.
async function addReviewCase(bucket,r,start){
 const expected=r.referenceLeft??(r.stage==='Scheduled'?r.baseLeft?.map((x,i)=>x*(r.factors?.[i]??1)):null);
 if(!expected||!expected.every(x=>Number.isFinite(x)&&x>=0)||!r.final)return;
 const actual=r.final.map((v,i)=>v-r.startScore[i]);
 const sample={expected,actual,hit:r.prediction.join()===r.final.join(),start,at:r.at,settled:r.settledAt??null};
 const key='review-v1/'+r.stage+'/'+String(9999999999-start).padStart(10,'0')+'/'+r.id;
 await bucket.put(key,'',{customMetadata:{sample:JSON.stringify(sample)}});
}
function assessCases(rows){
 const factors=[1,1],n=rows.length;
 const bias=factors.map((_,i)=>rows.reduce((a,r)=>a+r.actual[i]-r.expected[i],0)/Math.max(1,n));
 const review={n,misses:rows.filter(r=>!r.hit).length,bias,factors,applied:false};
 if(n<15)return review;
 const train=rows.slice(0,10),test=rows.slice(10);
 // Use only training outcomes known before every validation prediction.
 if(!train.every(r=>r.settled&&r.settled<Math.min(...test.map(v=>v.at))))return review;
 const candidate=factors.map((_,i)=>Math.max(.9,Math.min(1.1,(10+train.reduce((a,r)=>a+r.actual[i],0))/(10+train.reduce((a,r)=>a+r.expected[i],0)))));
 function metrics(f){
  let loss=0,error=0,hits=0;
  for(const r of test){
   const mu=r.expected.map((x,i)=>x*f[i]);
   loss+=mu.reduce((a,x,i)=>a+x-r.actual[i]*Math.log(Math.max(x,1e-10)),0);
   error+=Math.abs(mu[0]+mu[1]-r.actual[0]-r.actual[1]);
   hits+=Number(mu.every((x,i)=>Math.floor(x)===r.actual[i]));
  }
  return {loss,error,hits};
 }
 const base=metrics(factors),trial=metrics(candidate);
 review.test={base,trial};
 if(trial.loss<base.loss&&trial.error<base.error&&trial.hits>=base.hits){review.factors=candidate;review.applied=true}
 return review;
}
async function recentReview(bucket,stage){
 const latest=await bucket.list({prefix:'review-v1/'+stage+'/',limit:150,include:['customMetadata']});
 const cases=latest.objects.map(x=>JSON.parse(x.customMetadata.sample)).reverse();
 const test=cases.slice(-5),before=Math.min(...test.map(x=>x.at));
 const prior=cases.slice(0,-5).filter(x=>x.settled&&x.settled<before).slice(-10);
 return assessCases(prior.length===10?[...prior,...test]:cases.slice(-15));
}
async function finishRecord(bucket,record,m){
 if(m.stage!=='Finished'||m.status!=='finished'||m.hg==null||m.ag==null||m.hg<record.startScore[0]||m.ag<record.startScore[1])return;
 const final=[m.hg,m.ag];
 const example={vector:record.vector,final,startScore:record.startScore,baseLeft:record.baseLeft};
 const done={...record,settledAt:Date.now(),final,breakScore:[m.breakHome,m.breakAway]};
 // Stable keys make repeated or concurrent settlement idempotent.
 await bucket.put('done/'+m.id,JSON.stringify(done));
 await bucket.put('samples/'+String(9999999999-m.start).padStart(10,'0')+'/'+m.id,'',{customMetadata:{example:JSON.stringify(example)}});
 await addReviewCase(bucket,done,m.start);
 await bucket.delete('open/'+m.id);
 return done;
}
async function reconcile(bucket,rows){
 const matches=new Map(rows.filter(m=>m.status==='finished'&&m.stage==='Finished').map(m=>[m.id,m]));
 let cursor;
 do{
  const page=await bucket.list({prefix:'open/',cursor,limit:500});
  for(const item of page.objects){const m=matches.get(item.key.slice(5));if(m){const record=await readObject(bucket,item.key);if(record)await finishRecord(bucket,record,m)}}
  cursor=page.truncated?page.cursor:undefined;
 }while(cursor)
}
// Shadow pre-match model. Only the four lowest score cells are reweighted.
function lowScorePick(home,away){
 const rho=-Math.min(.08,.9/Math.max(home,away,.001));
 const correction=[[1-home*away*rho,1+home*rho],[1+away*rho,1-rho]];
 function masses(rate){
  const values=[Math.exp(-rate)];
  for(let n=1;n<=Math.max(2,Math.floor(rate));n++)values.push(values[n-1]*rate/n);
  return values;
 }
 const homes=masses(home),aways=masses(away);
 let best=-1,pick;
 homes.forEach((p,i)=>aways.forEach((q,j)=>{
  const weight=p*q*(correction[i]?.[j]??1);
  if(weight>best){best=weight;pick=[i,j]}
 }));
 return pick;
}
// Smooth observed score frequencies with the team's Poisson score distribution.
function comparableScore(home,away,examples,baseline){
 const observations=examples.filter(x=>x.vector[2]===0&&x.startScore.every(v=>v===0));
 if(observations.length<10)return null;
 const candidates=new Map([[baseline.join(),{score:baseline,count:0}]]);
 for(const {final} of observations){
  const key=final.join();
  const cell=candidates.get(key)??{score:final,count:0};
  cell.count++;
  candidates.set(key,cell);
 }
 function mass(rate,k){
  let p=Math.exp(-rate);
  for(let i=1;i<=k;i++)p*=rate/i;
  return p;
 }
 let best=baseline,highest=-1;
 for(const {score,count} of candidates.values()){
  const weight=30*mass(home,score[0])*mass(away,score[1])+count;
  if(weight>highest){highest=weight;best=score}
 }
 return {score:best,games:observations.length};
}
async function audit(bucket,id){
 if(!bucket)return Response.json({error:'Forecast storage unavailable'},{status:503});
 const done=await readObject(bucket,'done/'+id);
 if(done)return auditedResponse(bucket,done);
 let record=await readObject(bucket,'open/'+id);
 const feed=await readFeed('f_1_0_0_en_1',2000,fixtures);
 const m=feed.data.find(g=>g.id===id);
 if(record&&(!m||!['First half','Half-time','Second half'].includes(m.stage))){
  if(m)record=await finishRecord(bucket,record,m)||record;
  return auditedResponse(bucket,record);
 }
 if(!m||!['Scheduled','First half','Half-time','Second half'].includes(m.stage)||(m.status==='upcoming'&&m.start*1000<=feed.at))return Response.json(null,{headers:auditHeaders});
 const pre=m.status==='upcoming',second=m.stage==='Second half';
 const n=pre?0:m.stage==='Half-time'?45:Math.max(second?45:0,Math.min(second?90:45,Math.floor((feed.at/1000-m.start)/60)-(second?15:0)));
 const h=pre?0:m.hg,a=pre?0:m.ag;
 if(h==null||a==null||n>=90)return Response.json(record,{headers:auditHeaders});
 const key='checks/'+id+'/'+m.stage+'-'+Math.floor(n/5);
 if(record){const prior=await readObject(bucket,key);if(prior)return Response.json({...record,currentReview:prior.review,currentInputs:prior},{headers:auditHeaders})}
 const history=await readFeed('df_hh_1_'+id,1800000,previous);
 const rates=matchRates(m,await archivedForm(bucket,m,history.data));if(!rates)return Response.json(record,{headers:auditHeaders});
 const league=await leagueBaseline(m);
 const blended=blendLeague(rates,league);
 const vector=featureVector(blended,n,h,a);
 const examples=await learningExamples(bucket,vector);
 const learned=learnedAdjustment(vector,examples);
 const share=halfShare(feed.data,m).share,left=splitForecast({...m,hg:h,ag:a},n,...rates,share).left;
 let stats=null;
 if(!pre)try{
  const measured=await readFeed('df_st_1_'+id,15000,matchStats);
  stats={...measured,id,score:[h,a],stage:m.stage};
 }catch{}
 const live=liveRates(blended.map((v,i)=>v*learned.factors[i]),stats,{...m,hg:h,ag:a},n);
 const review=await recentReview(bucket,m.stage);
 const adjusted=live.rates.map((v,i)=>v*review.factors[i]);
 const best=scoreForecast(h,a,...adjusted,90*(1-left)).scores[0];
 const split=splitForecast({...m,hg:h,ag:a},n,...adjusted,share);
 const periods=scoreScenario(split,best);
 const check={review,league,factors:learned.factors,minute:n,stage:m.stage,startScore:[h,a],periods,remaining:best.home+best.away-h-a,at:feed.at};
 await bucket.put(key,JSON.stringify(check),{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{check:JSON.stringify(check)}});
 if(record)return Response.json({...record,currentReview:review,currentInputs:check},{headers:auditHeaders});
 record={id,review,referenceLeft:live.rates.map(v=>v*left),...(pre?{lowScoreV1:lowScorePick(...adjusted),comparableV1:comparableScore(...adjusted,examples,[best.home,best.away])}:{}),liveUsed:live.used,stats,at:feed.at,minute:n,stage:m.stage,startScore:[h,a],prediction:[best.home,best.away],vector,league,baseLeft:blended.map(v=>v*left),...learned};
 const inserted=await bucket.put('open/'+id,JSON.stringify(record),{onlyIf:{etagDoesNotMatch:'*'}});
 if(!inserted)record=await readObject(bucket,'done/'+id)||await readObject(bucket,'open/'+id);
 return Response.json(record,{headers:auditHeaders});
}

async function auditedResponse(bucket,record){
 if(!record.final)return Response.json(record,{headers:auditHeaders});
 const list=await bucket.list({prefix:'checks/'+record.id+'/',include:['customMetadata']});
 const checks=list.objects.map(item=>JSON.parse(item.customMetadata.check)).sort((a,b)=>a.at-b.at);
 return Response.json({...record,checks},{headers:auditHeaders});
}

const seasonCache=new Map();
async function leagueBaseline(m){
 const code={'GERMANY: Bundesliga':'bl1','GERMANY: 2. Bundesliga':'bl2'}[m.league];
 if(!code)return null;
 const date=new Date(m.start*1000),year=date.getUTCFullYear()-(date.getUTCMonth()<6?1:0);
 async function season(y){
  const key=code+'/'+y,hit=seasonCache.get(key);
  if(hit&&Date.now()-hit.at<3600000)return hit.games;
  const response=await fetch('https://api.openligadb.de/getmatchdata/'+key,{signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw Error('Unavailable season');
  const games=await response.json();
  if(!Array.isArray(games))throw Error('Invalid season');
  seasonCache.set(key,{at:Date.now(),games});return games;
 }
 const sets=await Promise.allSettled([season(year),season(year-1)]);
 const prior=sets.flatMap(s=>s.status==='fulfilled'?s.value:[]).filter(g=>g.matchIsFinished&&Date.parse(g.matchDateTimeUTC)+3*3600000<m.start*1000).sort((a,b)=>Date.parse(b.matchDateTimeUTC)-Date.parse(a.matchDateTimeUTC));
 const results=prior.map(g=>(g.matchResults||[]).find(r=>r.resultTypeID===2||r.resultTypeKind==='final')).filter(r=>r&&Number.isInteger(r.pointsTeam1)&&Number.isInteger(r.pointsTeam2)).slice(0,100);
 if(results.length<12)return null;
 return {games:results.length,rates:['pointsTeam1','pointsTeam2'].map(k=>results.reduce((v,r)=>v+r[k],0)/results.length)};
}

// Paginate all saved outcomes, retaining only the closest candidates in memory.
async function learningExamples(bucket,vector){
 let cursor,closest=[];
 do{
  const page=await bucket.list({prefix:'samples/',cursor,limit:500,include:['customMetadata']});
  for(const item of page.objects){
   try{
    const example=JSON.parse(item.customMetadata.example);
    const distance=example.vector.reduce((v,x,i)=>v+(x-vector[i])**2,0);
    if(Number.isFinite(distance)&&distance<=2)closest.push({example,distance});
   }catch{}
  }
  closest.sort((a,b)=>a.distance-b.distance);closest=closest.slice(0,30);
  cursor=page.truncated?page.cursor:undefined;
 }while(cursor)
 return closest.map(p=>p.example);
}
async function indexResult(bucket,m){
 if(m?.stage!=='Finished'||m.status!=='finished'||!m.homeId||!m.awayId||!Number.isFinite(m.start)||![m.hg,m.ag].every(v=>Number.isInteger(v)&&v>=0))return false;
 const game={id:m.id,start:m.start,home:m.homeId,away:m.awayId,hg:m.hg,ag:m.ag};
 const stamp=String(9999999999-m.start).padStart(10,'0');
 await Promise.all([m.homeId,m.awayId].map(id=>bucket.put('team-form/'+id+'/'+stamp+'/'+m.id,'',{customMetadata:{game:JSON.stringify(game)}})));
 return true;
}
async function archivedForm(bucket,m,feedGames){
 if(!bucket||!m)return feedGames;
 const games=new Map(feedGames.map(g=>[g.id,g]));
 await Promise.all([m.homeId,m.awayId].filter(Boolean).map(async id=>{
  const page=await bucket.list({prefix:'team-form/'+id+'/',limit:100,include:['customMetadata']});
  for(const item of page.objects){
   const g=JSON.parse(item.customMetadata.game);
   if(g.id!==m.id&&g.start+10800<m.start)games.set(g.id,g);
  }
 }));
 return [...games.values()].sort((a,b)=>b.start-a.start);
}
async function backfillForm(bucket,after){
 const page=await bucket.list({prefix:'results/',cursor:after||undefined,limit:30});
 const indexed=await Promise.all(page.objects.map(async item=>indexResult(bucket,await readObject(bucket,item.key))));
 return {processed:indexed.length,indexed:indexed.filter(Boolean).length,next:page.truncated?page.cursor:null};
}
async function sweep(bucket,after){
 if(!bucket)throw Error('Storage unavailable');
 const feed=await readFeed('f_1_0_0_en_1',2000,fixtures);
 const rows=feed.data.filter(m=>m.id>after).sort((a,b)=>a.id.localeCompare(b.id,'en',{sensitivity:'variant'}));
 // Use the same ordinal order for selection and continuation.
 rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const batch=rows.slice(0,6);
 const results=await Promise.all(batch.map(async m=>{
  try{
   if(m.status==='finished'){
    await bucket.put('results/'+m.id,JSON.stringify(m));
    await indexResult(bucket,m);
    const record=await readObject(bucket,'open/'+m.id);
    if(record)await finishRecord(bucket,record,m);
    return {id:m.id,status:record?'graded or awaiting regulation result':'result archived'};
   }
   const response=await audit(bucket,m.id),record=await response.json();
   return {id:m.id,status:record?.prediction?'forecast saved':'insufficient data or unsupported stage'};
  }catch{return {id:m.id,status:'retry next run'}}
 }));
 const result={at:Date.now(),total:feed.data.length,results,next:rows.length>batch.length?batch.at(-1).id:null};
 await bucket.put('system/last-sweep',JSON.stringify(result));
 return result;
}
