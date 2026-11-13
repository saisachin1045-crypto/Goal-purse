const el=id=>document.getElementById(id);
const escapeText=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=ms=>new Date(ms).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Kolkata'})+' IST';
let rows=[], active=null, feedTime=0, stale=false, busy=false, generation=0;
let displayedState="";
const historyCache=new Map(), scenarios=new Map();
const labels={all:'All',live:'Live',upcoming:'Upcoming',finished:'Finished',other:'Other'};
let scope='all',listKey='';
function visibleRows(){
 const term=el('search').value.trim().toLowerCase(), league=el('league').value, phase=el('phase').value;
 return rows.filter(m=>(scope==='all'||scope===m.status)&&(!league||league===m.league)&&(!phase||(m.status==='live'&&m.stage===phase))&&[m.home,m.away,m.league].join(' ').toLowerCase().includes(term));
}
function updateCounts(){
 const leagueSelect=el('league'),current=leagueSelect.value;
 const leagues=[...new Set(rows.map(m=>m.league).filter(Boolean).concat(current||[]))].sort();
 const options='<option value="">All competitions</option>'+leagues.map(l=>'<option value="'+escapeText(l)+'">'+escapeText(l)+'</option>').join('');
 if(leagueSelect.dataset.key!==options){leagueSelect.innerHTML=options;leagueSelect.value=current;leagueSelect.dataset.key=options}
}
function updateFilters(total){
 for(const button of el('statuses').children)button.setAttribute('aria-pressed',String(button.value===scope));
 const n=Number(Boolean(el('league').value))+Number(Boolean(el('phase').value));
 el('filterCount').textContent=n?'· '+n:'';
 el('reset').hidden=!n&&scope==='all'&&!el('search').value;
 el('resultCount').textContent=total+' '+(total===1?'fixture':'fixtures');
}
function clockLabel(m, now){
 const stages={'Half-time':'HT','Extra time':'ET','Penalties':'PEN'};
 if(stages[m.stage])return stages[m.stage];
 const second=m.stage==='Second half';
 if((!second&&m.stage!=='First half')||!Number.isFinite(m.start)||m.start<=0)return m.stage||'Live';
 const elapsed=Math.max(second?2700:0,Math.floor(now/1000)-m.start-(second?900:0));
 const limit=second?5400:2700;
 if(elapsed>=limit)return '≈ '+(second?'90':'45')+'′+';
 return '≈ '+Math.floor(elapsed/60)+':'+String(elapsed%60).padStart(2,'0');
}
function clockChip(m){
 if(m.status!=='live')return '';
 return '<i class="matchclock" data-clock="'+escapeText(m.id)+'" title="Estimated match time from kickoff and reported half">'+escapeText(clockLabel(m,stale?feedTime:Date.now()))+'</i>';
}
function tickClocks(){
 const byId=new Map(rows.map(m=>[m.id,m]));
 for(const chip of document.querySelectorAll('[data-clock]')){
   const match=byId.get(chip.dataset.clock);
   if(match)chip.textContent=clockLabel(match,stale?feedTime:Date.now());
 }
}
function list(){
 const visible=visibleRows(),key=JSON.stringify([active,visible]);
 updateFilters(visible.length);
 if(key===listKey)return;
 listKey=key;
 const container=el('list'), scroll=container.scrollTop;
 const fragment=document.createDocumentFragment();
 for(const m of visible){
  const b=document.createElement('button');b.className='fixture'+(m.id===active?' selected':'');
  b.dataset.id=m.id;
  const stage=m.status==='upcoming'?time(m.start*1000):m.stage;
  b.innerHTML=clockChip(m)+'<small>'+escapeText(stage)+' · '+escapeText(m.league)+'</small>'+[[m.home,m.hg],[m.away,m.ag]].map(([n,g])=>'<span>'+escapeText(n)+'<b>'+escapeText(g)+'</b></span>').join('');
  b.onclick=()=>{location.hash="match/"+encodeURIComponent(m.id)};fragment.append(b);
 }
 container.replaceChildren(fragment);container.scrollTop=scroll;
 if(!visible.length)container.textContent='No fixtures match these filters.';
}
function routeId(){return /^#match\/([a-z0-9_-]+)$/i.exec(location.hash)?.[1]}
function applyFilters(){list()}
function route(){
 const id=routeId();
 document.body.classList.toggle('watching',Boolean(id));
 if(id){void select(id);el('backList').focus({preventScroll:true});window.scrollTo(0,0)}
 else {const previous=active;active=null;++generation;list();
   if(previous)document.querySelector('.fixture[data-id="'+CSS.escape(previous)+'"]')?.focus()}
}
window.addEventListener('hashchange',route);
async function refresh(){
 if(busy)return;busy=true;el('refresh').disabled=true;
 try{
  const r=await fetch('/api/fixtures',{cache:'no-store'});if(!r.ok)throw Error();
  const x=await r.json(); const order={live:0,upcoming:1,finished:2,other:3};
  rows=x.data.map(m=>({...m,status:m.status??'live'})).sort((a,b)=>order[a.status]-order[b.status]||a.start-b.start);
  updateCounts();feedTime=x.at;stale=!!x.stale;
  el('feed').textContent=(stale?'Saved Flashscore snapshot':'Flashscore')+' · '+rows.length+' fixtures · '+rows.filter(m=>m.status==='live').length+' live';
  el('stamp').textContent=(stale?'Refresh failed. Last successful fetch: ':'Updated ')+time(feedTime)+' · 3s refresh';
  const id=routeId();if(!id){list();return}
  const selected=rows.find(m=>m.id===id);
  const entry=historyCache.get(selected?.id);
  if(!selected || JSON.stringify(selected)!==displayedState || !entry || Date.now()-entry.loaded>1800000) {
    void select(id);
  } else {
    list();
    const field=el('minute');
    if(field && selected.status==='live' && document.activeElement!==field && !scenarios.has(active+selected.stage)){
      field.value=estimateMinute(selected);
      field.dispatchEvent(new Event('forecast-tick'));
    }
  }
 }catch{
  stale=true;el('feed').textContent='Flashscore refresh unavailable';
  el('stamp').textContent=feedTime?'Showing last successful fetch: '+time(feedTime):'Try refreshing again shortly.';
  if(!rows.length)el('board').textContent='No verified score available.';
 }finally{busy=false;el('refresh').disabled=false}
}
function matchExtras(m){
 const line=(label,value)=>'<div class="statline"><span>'+label+'</span><b>'+value+'</b></div>';
 const score=(h,a)=>h==null||a==null?'—':h+' – '+a;
 const second=['Second half','Finished'].includes(m.stage)&&m.breakHome!=null&&m.breakAway!=null&&m.hg!=null&&m.ag!=null&&m.hg>=m.breakHome&&m.ag>=m.breakAway;
 el('summary').innerHTML=line('Half-time',score(m.breakHome,m.breakAway))+line('Second half',second?score(m.hg-m.breakHome,m.ag-m.breakAway):'—')+line(m.status==='finished'?'Final score':'Score',score(m.hg,m.ag));
 const fixtures=rows.filter(x=>x.id!==m.id&&x.league===m.league&&x.status==='upcoming').sort((a,b)=>a.start-b.start).slice(0,3);
 el('related').innerHTML=fixtures.map(x=>'<div class="statline"><a href="#match/'+encodeURIComponent(x.id)+'">'+escapeText(x.home)+' · '+escapeText(x.away)+'<small>'+escapeText(time(x.start*1000))+'</small></a></div>').join('')||'No upcoming fixtures in this feed.';
}
function historyPanels(m,data){
 const past=data.filter(g=>g.start<m.start&&g.id!==m.id).sort((a,b)=>b.start-a.start);
 el('form').innerHTML=[[m.homeId,m.home],[m.awayId,m.away]].map(([id,name])=>{
  const games=past.filter(g=>g.home===id||g.away===id).slice(0,5);
  const chips=games.map(g=>{const diff=(g.hg-g.ag)*(g.home===id?1:-1);const label=diff>0?'Win':diff<0?'Loss':'Draw';return '<span aria-label="'+label+'" title="'+label+'" class="formchip '+label.toLowerCase()+'">'+label[0]+'</span>'}).join('');
  return '<div class="formgroup"><b>'+escapeText(name)+'</b>'+(chips||'No results available')+'</div>';
 }).join('');
 const meetings=past.filter(g=>(g.home===m.homeId&&g.away===m.awayId)||(g.home===m.awayId&&g.away===m.homeId)).slice(0,5);
 el('meetings').innerHTML=meetings.length?'<small>Scores shown with '+escapeText(m.home)+' first</small>'+meetings.map(g=>'<div class="statline"><span>'+new Date(g.start*1000).toLocaleDateString('en-GB')+'</span><b>'+(g.home===m.homeId?g.hg+' – '+g.ag:g.ag+' – '+g.hg)+'</b></div>').join(''):'No previous meetings in the feed.';
}
const recordsByMatch=new Map();
async function showAudit(m,version){
 const panel=el('auditPanel');
 let record=recordsByMatch.get(m.id);
 if(!record||m.status==='live'||(!record.final&&m.stage==='Finished')){
  panel.textContent='Checking forecast record…';
  try{const r=await fetch('/api/audit/'+encodeURIComponent(m.id),{method:'POST'});if(!r.ok)throw Error();
   record=await r.json();if(record)recordsByMatch.set(m.id,record)
  }catch{if(version===generation)panel.textContent='Archive unavailable. Forecasts can still run.';return null}
 }
 if(version!==generation)return record;
 if(!record){
  if(m.status==='finished'){
   const final=m.hg!=null&&m.ag!=null?escapeText(m.hg)+' – '+escapeText(m.ag):'Unavailable';
   panel.innerHTML='<b>Final result available</b><div class="statline"><span>Original prediction</span><strong>Not recorded</strong></div><div class="statline"><span>Final score</span><strong>'+final+'</strong></div><small>No forecast was saved before this match finished. An original-prediction comparison is unavailable.</small>';
  }else panel.textContent='No eligible forecast saved yet. Tracking requires available team history and a supported match stage.';
  return null;
 }
 const current=record.final||(m.hg!=null&&m.ag!=null?[m.hg,m.ag]:null);
 const state=record.final?(record.prediction.join()===record.final.join()?'Exact score hit':'Exact score missed'):m.status==='other'||m.status==='finished'?'Ungraded':current&&(current[0]>record.prediction[0]||current[1]>record.prediction[1])?'Original score surpassed · awaiting final':'Pending full time';
 panel.innerHTML='<b>'+state+'</b><div class="statline">Original prediction<strong>'+record.prediction.join(' – ')+'</strong></div><div class="statline">'+(record.final?'Final score':'Latest score')+'<strong>'+(current?current.join(' – '):'—')+'</strong></div><small>Saved '+escapeText(time(record.at))+' · '+escapeText(record.stage)+' · '+record.minute+'′</small><small>'+record.count+' similar settled matches · '+(record.count>=10?'adjusted rates':'baseline rates')+'</small>';
 const review=record.currentReview??record.review;
 if(review?.n){
  const direction=review.bias.map(v=>Math.abs(v).toFixed(2)+(v>=0?' under':' over'));
  panel.insertAdjacentHTML('beforeend','<details><summary>Model review · '+review.n+' finished matches</summary><small>'+review.misses+' exact-score misses. Average goals versus baseline: home '+direction[0]+', away '+direction[1]+'. '+(review.applied?'Validated rate multipliers: '+review.factors.map(v=>v.toFixed(2)).join(' / '):'Baseline retained.')+'</small></details>');
 }
 if(record.lowScoreV1){
  const verdict=record.final?(record.lowScoreV1.join()===record.final.join()?' · hit':' · missed'):'';
  panel.insertAdjacentHTML('beforeend','<div class="statline"><span>Trial pre-match prediction</span><strong>'+record.lowScoreV1.join(' – ')+verdict+'</strong></div>');
 }
 if(record.comparableV1){
  const {score,games}=record.comparableV1;
  const verdict=record.final?(score.join()===record.final.join()?' · hit':' · missed'):'';
  panel.insertAdjacentHTML('beforeend','<div class="statline"><span>Comparable-match forecast · '+games+' games</span><strong>'+score.join(' – ')+verdict+'</strong></div>');
 }
 if(record.final){
  const total=record.final[0]+record.final[1];
  const ht=record.breakScore??[m.breakHome,m.breakAway];
  const valid=ht.every((v,i)=>Number.isInteger(v)&&v>=0&&v<=record.final[i]);
  const first=valid?ht[0]+ht[1]:null;
  const actual=[first,valid?total-first:null,total];
  const checks=record.checks||[];
  if(!checks.length)panel.insertAdjacentHTML('beforeend','<small>No period or live checkpoints were recorded for this match.</small>');
  for(const c of checks){
   const rows=c.stage==='Scheduled'?['First half','Second half','Full match'].map((label,i)=>[label,c.periods[i],actual[i]]):[['Goals after checkpoint',c.remaining,total-c.startScore[0]-c.startScore[1]]];
   const lines=rows.map(([label,pred,real])=>'<div class="statline"><span>'+label+'</span><strong>'+(pred??'—')+' / '+(real??'—')+'</strong></div>').join('');
   panel.insertAdjacentHTML('beforeend','<details><summary>'+escapeText(c.stage)+(c.stage==='Scheduled'?' forecast':' · '+c.minute+'′')+'</summary><small>Predicted / actual goals</small>'+lines+'</details>');
  }
 }
 return record;
}
const statsCache=new Map();
async function refreshStats(m,version){
 try{
  const r=await fetch('/api/stats/'+encodeURIComponent(m.id),{cache:'no-store'});if(!r.ok)throw Error();
  const stats=await r.json();statsCache.set(m.id,stats);
  if(version!==generation)return;
  const labels={xg:'Shot xG',shots:'Shots',onTarget:'On target',reds:'Red cards',possession:'Possession %'};
  el('liveStats').innerHTML=Object.entries(labels).map(([k,label])=>'<div class="statline"><span>'+label+'</span><b>'+(stats.data[k]?stats.data[k].join(' / '):'Unavailable')+'</b></div>').join('')+'<small>Home / away · '+escapeText(time(stats.at))+'</small>';
  el('minute')?.dispatchEvent(new Event('forecast-tick'));
 }catch{statsCache.delete(m.id);if(version===generation){el('liveStats').textContent='Live statistics unavailable.';el('minute')?.dispatchEvent(new Event('forecast-tick'))}}
}
setInterval(()=>{const m=rows.find(m=>m.id===active);if(m&&!document.hidden)void refreshStats(m,generation)},15000);
async function select(id){
 active=id;const version=++generation;list();const m=rows.find(x=>x.id===id);
 displayedState=JSON.stringify(m);
 for(const panel of ["form","meetings","summary","related","auditPanel","liveStats"])el(panel).textContent=m?"Loading…":"—";
 if(!m){el('board').textContent=!feedTime?'Loading match…':'Fixture no longer in the feed.';el('model').textContent='Waiting for a fixture.';return}
 function team(name,side){
  const initials=name.split(/\s+/).map(word=>Array.from(word)[0]).slice(0,3).join('').toUpperCase();
  return '<div class="club '+side+'"><span class="crest" aria-hidden="true">'+escapeText(initials)+'</span><small>'+side+'</small><b>'+escapeText(name)+'</b></div>';
 }
 el('board').innerHTML='<div class="competition">'+escapeText(m.league)+'</div><div class="board">'+team(m.home,'home')+'<div class="centre"><span class="score">'+(m.status==='upcoming'?'VS':escapeText(m.hg)+' – '+escapeText(m.ag))+'</span><span class="stage">'+escapeText(m.stage)+'</span>'+clockChip(m)+'</div>'+team(m.away,'away')+'</div><div class="matchmeta"><span>'+escapeText(time(m.start*1000))+'</span><a target="_blank" rel="noopener" href="https://www.flashscore.com/match/'+encodeURIComponent(m.id)+'/">Flashscore ↗</a></div>';
 matchExtras(m);
 void refreshStats(m,version);
 const auditRequest=showAudit(m,version);
 const settled=m.status==='finished'||m.status==='other';
 if(settled){
   el('model').textContent=m.status==='finished'?(m.stage==='Finished'&&m.breakHome!=null&&m.breakAway!=null&&m.hg!=null&&m.ag!=null&&m.hg>=m.breakHome&&m.ag>=m.breakAway?'First half: '+m.breakHome+'–'+m.breakAway+' · Second half: '+(m.hg-m.breakHome)+'–'+(m.ag-m.breakAway)+' · Full time: '+m.hg+'–'+m.ag+' ('+(m.hg+m.ag)+' total goals).':'This match has finished. The scoreboard shows the reported result.'):'Forecast unavailable for this match status.';
 }else el('model').textContent='Loading form…';
 try{let entry=historyCache.get(id);
  if(!entry||Date.now()-entry.loaded>1800000){const r=await fetch('/api/history/'+encodeURIComponent(id));if(!r.ok)throw Error();entry={...await r.json(),loaded:Date.now()};historyCache.set(id,entry)}
  const auditRecord=await auditRequest;
  if(version===generation){historyPanels(m,entry.data);if(!settled)forecast(m,entry,auditRecord)}
 }catch{if(version===generation){el('form').textContent=el('meetings').textContent='History unavailable.';if(!settled)el('model').textContent='Historical results unavailable.'}}
}
function estimateMinute(m){
 if(m.status==='upcoming')return 0;
 if(m.stage==='Half-time')return 45;
 const second=m.stage==='Second half';
 const elapsed=Math.floor((feedTime/1000-m.start)/60)-(second?15:0);
 return Math.max(second?45:0,Math.min(second?90:45,elapsed));
}
function forecast(m,entry,auditRecord){
 const prematch=m.status==='upcoming';
 if(prematch)m={...m,hg:0,ag:0};
 const past=entry.data.filter(g=>g.start<m.start&&g.id!==m.id);
 function sample(id,which){return past.filter(g=>which?g[which]===id:g.home===id||g.away===id).slice(0,10)}
 const h=sample(m.homeId),a=sample(m.awayId),hv=sample(m.homeId,'home'),av=sample(m.awayId,'away');
 const meetings=past.filter(g=>(g.home===m.homeId&&g.away===m.awayId)||(g.away===m.homeId&&g.home===m.awayId)).slice(0,5);
 if(!h.length||!a.length||m.hg===null||m.ag===null){el('model').textContent='Insufficient score or team history for a forecast.';return}
 if(!prematch&&!['Half-time','First half','Second half'].includes(m.stage)){el('model').textContent='Regulation-time forecast unavailable for this stage.';return}
 const analysis=rateAnalysis(m,entry.data);
 if(!analysis){el('model').textContent='Insufficient completed history for both teams.';return}
 const rates=analysis.rates;
 const inputs=auditRecord?.currentInputs??auditRecord;
 const baseRates=blendLeague(rates,inputs?.league).map((v,i)=>v*(inputs?.factors?.[i]??1));
 const key=m.id+m.stage;const half=m.stage==='Half-time',first=m.stage==='First half';
 const low=prematch||first?0:45,high=prematch?0:first||half?45:90;
 const minute=scenarios.get(key)??estimateMinute(m);
 el('model').innerHTML='<div id="prediction"></div><div id="estimates" class="cards"></div><div class="clock"><label>'+ (prematch?'Pre-match minute ':half?'Half-time minute ':'Forecast minute ')+'<input id="minute" type="number" min="'+low+'" max="'+high+'" value="'+minute+'" '+(half||prematch?'disabled':'')+'></label> <button id="autoMinute" type="button" '+(half||prematch?'hidden':'')+'>Use estimate</button></div><p class="muted footnote" id="clockNote"></p><p class="muted footnote">Form · '+h.length+' '+escapeText(m.home)+', '+a.length+' for '+escapeText(m.away)+' · '+meetings.length+' H2H.</p>';
 function calculate(){
  const n=el('minute').valueAsNumber;
  el('clockNote').textContent=prematch?'Pre-match forecast based on the full 90 minutes.':half?'Half-time confirmed by Flashscore.':scenarios.has(key)?'Using your minute.':'≈ Clock estimated from kickoff. Adjust if needed.';
  if(!Number.isInteger(n)||n<low||n>high){
    el('prediction').textContent='Enter a minute from '+low+' to '+high+'.';el('estimates').replaceChildren();return;
  }
  if(n===90){
    el('prediction').textContent='Match still in play at the end of regulation. Added time is unknown, so the final-score forecast is paused.';
    el('estimates').replaceChildren();return;
  }
  const live=liveRates(baseRates,statsCache.get(m.id),m,n);
  const review=auditRecord?.currentReview??(auditRecord?.stage===m.stage?auditRecord.review:null);
  const [hr,ar]=live.rates.map((v,i)=>v*(review?.factors[i]??1));
  const timing=halfShare(rows,m);
  const split=splitForecast(m,n,hr,ar,timing.share);
  const result=scoreForecast(m.hg,m.ag,hr,ar,90*(1-split.left)),[best,...alternatives]=result.scores;
  const percent=p=>(p*100).toFixed(1)+'%';
  recordBrowserForecast(m.id,n,best);
  const scenario=scoreScenario(split,best);
  el('prediction').innerHTML='<div class="pick"><div><b>Likely final score</b><small>'+percent(best.probability)+' exact-score chance · '+scenario[2]+' total goals</small></div><strong>'+best.home+' – '+best.away+'</strong></div>'+alternatives.map(x=>'<div class="alt"><span>Other score &nbsp; <b>'+x.home+' – '+x.away+'</b></span><span>'+percent(x.probability)+'</span></div>').join('');
  el('prediction').insertAdjacentHTML('beforeend','<h3>Match outcome</h3><div class="odds">'+Object.entries(result.outcomes).map(([label,v])=>'<div><small>'+({home:'Home win',draw:'Draw',away:'Away win'}[label])+'</small><strong>'+percent(v)+'</strong></div>').join('')+'</div>');
  const matrixRows=result.matrix.map((row,i)=>'<tr><th>'+ (m.hg+i)+(i===4?'+':'')+'</th>'+row.map(p=>'<td>'+percent(p)+'</td>').join('')+'</tr>').join('');
  el('prediction').insertAdjacentHTML('beforeend','<details><summary>Score probability matrix</summary><small>Home goals down · Away goals across · + includes all higher scores</small><table class="matrix"><thead><tr><th>H / A</th>'+[0,1,2,3,4].map(k=>'<th>'+(m.ag+k)+(k===4?'+':'')+'</th>').join('')+'</tr></thead><tbody>'+matrixRows+'</tbody></table></details>');
  const [firstPeriod,secondPeriod]=split.periods;
  if(!firstPeriod.unknown&&!secondPeriod.unknown){
   const labels=['0','1','2','3+'];
   const cells=firstPeriod.buckets.map((p,i)=>'<tr><th>'+labels[i]+'</th>'+secondPeriod.buckets.map(q=>'<td>'+percent(p*q)+'</td>').join('')+'</tr>').join('');
   el('prediction').insertAdjacentHTML('beforeend','<details><summary>Goals by half · joint probabilities</summary><small>First-half goals down · second-half goals across. Includes goals already scored. Assumes independent remaining goals in each half.</small><table class="matrix"><thead><tr><th>1H / 2H</th>'+labels.map(label=>'<th>'+label+'</th>').join('')+'</tr></thead><tbody>'+cells+'</tbody></table></details>');
  }
  const values=[['80% model range · final total goals',result.goalRange.join(' – ')],['Average additional goals',result.remaining.toFixed(2)],['At least one more goal',percent(result.another)],['3+ goals by full time',percent(result.over)]];
  el('estimates').innerHTML=values.map(([k,v])=>'<div class="card"><small>'+k+'</small><strong>'+v+'</strong></div>').join('');
  el('estimates').insertAdjacentHTML('beforeend','<p class="footnote muted" style="grid-column:1/-1">Model average: '+(m.hg+m.ag)+' already scored + '+result.remaining.toFixed(2)+' additional = '+(m.hg+m.ag+result.remaining).toFixed(2)+' goals by full time.</p>');
  const comparisons=[['Recent form',analysis.form],['Opponent-adjusted',analysis.opponent.rates],['Final scoring rates',[hr,ar]]];
  el('estimates').insertAdjacentHTML('beforeend','<p class="footnote muted" style="grid-column:1/-1">'+(live.used?'Experimental live xG adjustment applied (maximum 25%). Accuracy not yet validated.':'Historical scoring rates · fresh live xG adjustment unavailable for this state.')+'</p>');
  const periods=split.periods.map((p,i)=>{
    if(p.unknown)return '<article class="period"><small>'+p.label+'</small><p>Half-time split unavailable.</p></article>';
    const buckets=p.buckets.map((v,k)=>'<div class="probrow"><span>'+['0','1','2','3+'][k]+'</span><meter min="0" max="1" value="'+v+'"></meter><span>'+percent(v)+'</span></div>').join('');
    const confirmed=i===0&&(m.stage==='Half-time'||m.stage==='Second half');
    const caption=confirmed?'Recorded first half':i===2?'In the '+best.home+'–'+best.away+' forecast':'In this score scenario';
    return '<article class="period"><small>'+p.label+'</small><div class="goalnum">'+scenario[i]+' <em>'+(scenario[i]===1?'goal':'goals')+'</em></div><b>'+caption+'</b><p>Average across outcomes: '+p.mean.toFixed(2)+'</p><div class="distribution"><small>Goal-count chances</small>'+buckets+'</div></article>';

  }).join('');
  el('estimates').insertAdjacentHTML('afterbegin','<div class="halfpanel"><h3>Goals by half</h3><p class="footnote">One breakdown of the predicted score. The probabilities below include all possible scores.</p><div class="periods">'+periods+'</div><details><summary>Model inputs</summary><p>Goals per 90 minutes · home / away</p>'+comparisons.map(([label,pair])=>'<div class="statline"><span>'+label+'</span><b>'+pair.map(v=>v.toFixed(2)).join(' / ')+'</b></div>').join('')+'<small>Opponent model: '+analysis.opponent.games+' earlier results across '+analysis.opponent.teams+' teams. Blend: 65% form, 35% opponent model.</small><p>'+ (auditRecord?.league?'OpenLigaDB league baseline · '+auditRecord.league.games+' completed matches · 10% weight. ':'')+'Full-game scoring rates: '+escapeText(m.home)+' '+hr.toFixed(2)+' · '+escapeText(m.away)+' '+ar.toFixed(2)+'. First-half share: '+percent(timing.share)+' based on '+timing.games+' earlier completed fixtures with break scores, blended with a 50/50 baseline equivalent to 20 goals. Second-half share: '+percent(1-timing.share)+'.</p></details></div>');

 }
 const field=el('minute');
 field.oninput=()=>{if(field.value!==''&&field.validity.valid)scenarios.set(key,field.valueAsNumber);calculate()};
 field.addEventListener('forecast-tick',calculate);
 el('autoMinute').onclick=()=>{scenarios.delete(key);field.value=estimateMinute(m);calculate()};
 calculate();
}
el('refresh').onclick=refresh;for(const [value,label] of Object.entries(labels)){
 const button=document.createElement('button');button.value=value;button.textContent=label;
 button.onclick=()=>{scope=value;if(value!=='live'&&value!=='all')el('phase').value='';applyFilters()};
 el('statuses').append(button);
}
el('league').onchange=applyFilters;
el('phase').onchange=()=>{if(el('phase').value)scope='live';applyFilters()};
el('reset').onclick=()=>{scope='all';for(const id of ['search','league','phase'])el(id).value='';applyFilters()};
updateFilters(0);
el('search').oninput=applyFilters;route();refresh();setInterval(()=>{if(!document.hidden)refresh()},3000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-feedTime>=3000)refresh()});

setInterval(()=>{if(!document.hidden)tickClocks()},1000);
