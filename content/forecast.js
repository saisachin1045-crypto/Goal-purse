// Independent additional goals for each side, conditional on the current score.
function scoreForecast(homeGoals, awayGoals, homeRate, awayRate, minute) {
  const fraction = (90 - minute) / 90;
  const home = homeRate * fraction;
  const away = awayRate * fraction;
  function distribution(rate) {
    const probabilities = [Math.exp(-rate)];
    // For either side, the three largest masses lie within three of the mode.
    const upper = Math.ceil(rate + 10*Math.sqrt(rate+1)) + 3;
    for (let k = 1; k <= upper; k++) probabilities.push(probabilities[k-1] * rate / k);
    return probabilities;
  }
  const scores = [];
  const awayDistribution = distribution(away);
  const homeDistribution=distribution(home);
  function withTail(probabilities) {
    const first = probabilities.slice(0, 4);
    return [...first, Math.max(0, 1 - first.reduce((sum, p) => sum + p, 0))];
  }
  const matrix = withTail(homeDistribution).map(p => withTail(awayDistribution).map(q => p * q));
  homeDistribution.forEach((p, i) => awayDistribution.forEach((q, j) => {
    if (p*q > 0) scores.push({home:homeGoals+i, away:awayGoals+j, probability:p*q});
  }));
  scores.sort((x,y) => y.probability-x.probability);
  const total = home + away;
  let probability = Math.exp(-total), under = 0;
  for (let k=0;k<=2-homeGoals-awayGoals;k++) {
    under+=probability;
    probability*=total/(k+1);
  }
  const outcomes={home:0,draw:0,away:0};
  for(const s of scores)outcomes[s.home>s.away?"home":s.home<s.away?"away":"draw"]+=s.probability;
  const goalMass = distribution(total);
  let lower = 0, upper = 0, cumulative = 0;
  for (let i = 0; i < goalMass.length; i++) {
    cumulative += goalMass[i];
    if (cumulative < 0.1) lower = i + 1;
    if (cumulative >= 0.9) { upper = i; break; }
  }
  const known = homeGoals + awayGoals;
  const goalRange = [known + lower, known + upper];
  return {goalRange,matrix,outcomes,scores:scores.slice(0,3), remaining:total, another:1-Math.exp(-total), over:Math.max(0,1-under)};
}

// Estimate the first-half share from earlier regulation results with a known break score.
function halfShare(fixtures,match){
 let goals=0,first=0,games=0;
 for(const game of fixtures){
  if(game.stage!=='Finished'||game.start+7200>=match.start||game.hg==null||game.ag==null||
     game.breakHome==null||game.breakAway==null||game.breakHome>game.hg||game.breakAway>game.ag)continue;
  goals+=game.hg+game.ag;first+=game.breakHome+game.breakAway;games++;
 }
 return {share:(first+10)/(goals+20),games};
}
function periodOutlook(label,h,a,x,y){
 if(h==null||a==null)return {label,unknown:true};
 const lambda=x+y, known=h+a;
 const p0=Math.exp(-lambda);
 const probs=[p0,p0*lambda,p0*lambda*lambda/2];
 const buckets=[0,0,0,0];
 for(let i=0;i<3;i++)if(i+known<3)buckets[i+known]=probs[i];
 buckets[3]=Math.max(0,1-buckets.slice(0,3).reduce((a,b)=>a+b,0));
 return {label,known,mean:known+lambda,buckets};
}
function splitForecast(m,minute,homeRate,awayRate,share){
 const early=m.status==='upcoming'||m.stage==='First half'||m.stage==='Half-time';
 const h1=early?m.hg:m.breakHome,a1=early?m.ag:m.breakAway;
 const splitKnown=h1!=null&&a1!=null&&h1<=m.hg&&a1<=m.ag;
 const left1=share*Math.max(0,45-minute)/45;
 const left2=(1-share)*(90-Math.max(45,minute))/45;
 return {left:left1+left2,firstFraction:left1+left2>0?left1/(left1+left2):0,periods:[
 periodOutlook('1st half',splitKnown?h1:null,splitKnown?a1:null,homeRate*left1,awayRate*left1),
 periodOutlook('2nd half',splitKnown?m.hg-h1:null,splitKnown?m.ag-a1:null,homeRate*left2,awayRate*left2),
 periodOutlook('Full match',m.hg,m.ag,homeRate*(left1+left2),awayRate*(left1+left2))]};
}

// Conditional on the chosen final score, the additional goals split between halves
// as a binomial count because both scoring rates use the same period shares.
function scoreScenario(split,best){
 const [first,second,full]=split.periods;
 const total=best.home+best.away;
 if(first.unknown||second.unknown)return [null,null,total];
 const extra=total-full.known;
 const firstExtra=Math.min(extra,Math.floor((extra+1)*split.firstFraction));
 return [first.known+firstExtra,second.known+extra-firstExtra,total];
}

// Fit scoring and conceding multipliers jointly so the same score against a
// stronger defence carries more evidence. Pseudo-counts anchor sparse teams.
function opponentModel(match,games){
 const teams=new Map(),observations=[];
 function side(id){
  if(!teams.has(id))teams.set(id,{attack:1,defence:1});
  return teams.get(id);
 }
 let weight=0,homeGoals=0,awayGoals=0;
 for(const g of games){
  const w=Math.pow(.5,(match.start-g.start)/(86400*120));
  if(w<.01)continue;
  observations.push({home:side(g.home),away:side(g.away),w,h:g.hg,a:g.ag});
  weight+=w;homeGoals+=w*g.hg;awayGoals+=w*g.ag;
 }
 const homeBase=(homeGoals+8)/(weight+6),awayBase=(awayGoals+8)/(weight+6);
 for(let step=0;step<8;step++){
  const attack=step%2===0;
  for(const t of teams.values()){t.goals=6;t.exposure=6}
  for(const {home,away,w,h,a} of observations){
   if(attack){
    home.goals+=w*h;home.exposure+=w*homeBase*away.defence;
    away.goals+=w*a;away.exposure+=w*awayBase*home.defence;
   }else{
    home.goals+=w*a;home.exposure+=w*awayBase*away.attack;
    away.goals+=w*h;away.exposure+=w*homeBase*home.attack;
   }
  }
  for(const t of teams.values())t[attack?'attack':'defence']=t.goals/t.exposure;
 }
 const home=side(match.homeId),away=side(match.awayId);
 return {rates:[homeBase*home.attack*away.defence,awayBase*away.attack*home.defence],games:observations.length,teams:teams.size};
}
// Strength features from historical results only. More recent games carry greater weight.
function rateAnalysis(m,history){
 const prior=history.filter(g=>g.start+3*3600<m.start&&g.id!==m.id).sort((a,b)=>b.start-a.start);
 const sides=[m.homeId,m.awayId];
 const samples=sides.map(id=>prior.filter(g=>g.home===id||g.away===id).slice(0,10));
 if(samples.some(g=>!g.length))return null;
 const meetings=prior.filter(g=>sides.includes(g.home)&&sides.includes(g.away)).slice(0,5);
 function average(games,id,against=false){
  let total=0,weight=0;
  games.forEach((g,i)=>{const w=Math.pow(.90,i);weight+=w;total+=w*((g.home===id)!==against?g.hg:g.ag)});
  return total/weight;
 }
 const form=sides.map((id,i)=>{
  const opp=sides[1-i],recent=samples[i],opponents=samples[1-i];
  const base=(average(recent,id)+average(opponents,opp,true))/2;
  const venue=recent.filter(g=>(i?g.away:g.home)===id),other=opponents.filter(g=>(i?g.home:g.away)===opp);
  const local=venue.length&&other.length?(average(venue,id)+average(other,opp,true))/2:base;
  return .60*base+.25*local+.15*(meetings.length?average(meetings,id):base);
 });
 const opponent=opponentModel(m,prior);
 const rates=form.map((v,i)=>.65*v+.35*opponent.rates[i]);
 return {rates,form,opponent};
}
function matchRates(m,history){return rateAnalysis(m,history)?.rates??null}
function featureVector(rates,n,h,a){return [rates[0]/2,rates[1]/2,n/45,(h-a)/2,(h+a)/3]}
function learnedAdjustment(vector,examples){
 const nearest=examples.map(x=>({x,d:x.vector.reduce((v,k,i)=>v+(k-vector[i])**2,0)})).filter(p=>p.d<=2).sort((a,b)=>a.d-b.d).slice(0,30);
 const factors=[1,1];
 if(nearest.length>=10)for(let i=0;i<2;i++){
  let actual=8,expected=8;
  for(const {x,d} of nearest){const w=1/(1+d);actual+=w*(x.final[i]-x.startScore[i]);expected+=w*x.baseLeft[i]}
  factors[i]=Math.max(.8,Math.min(1.2,actual/expected));
 }
 return {count:nearest.length,factors};
}

function blendLeague(rates,league){return league?rates.map((rate,i)=>.9*rate+.1*league.rates[i]):rates}

// A conservative experimental blend of observed shot-quality pace and history.
// Red cards are exposed as context until their effect can be fitted to data.
function liveRates(rates,stats,m,minute){
 if(!stats||stats.stale||Date.now()-stats.at>45000||stats.id!==m.id||
    stats.score[0]!==m.hg||stats.score[1]!==m.ag||stats.stage!==m.stage||
    !['First half','Second half'].includes(m.stage)||minute<15||minute>=90||
    !stats.data.xg)return {rates,used:false};
 const weight=Math.min(.25,minute/300);
 const adjusted=rates.map((rate,i)=>{
  const pace=stats.data.xg[i]*90/minute;
  return Math.max(rate*.75,Math.min(rate*1.25,rate*(1-weight)+pace*weight));
 });
 return {rates:adjusted,used:true};
}
