export function records(text) {
  return text.split('~').map(chunk => {
    const row = Object.create(null);
    for (const pair of chunk.split('¬')) {
      const i = pair.indexOf('÷');
      if (i > 0 && !(pair.slice(0,i) in row)) row[pair.slice(0,i)] = pair.slice(i+1);
    }
    return row;
  });
}
const stages = {1:'Scheduled',2:'Live',3:'Finished',4:'Postponed',5:'Cancelled',6:'Extra time',7:'Penalties',8:'Finished',9:'Walkover',10:'After extra time',11:'After penalties',36:'Interrupted',37:'Abandoned',54:'Awarded',12:'First half',13:'Second half',38:'Half-time',42:'Awaiting updates',43:'Delayed'};
function goals(value) { return /^\d+$/.test(value || '') ? Number(value) : null; }
export function fixtures(text) {
  let league='', seen=false;
  const matches=[];
  for(const r of records(text)){
    if(r.ZA) league=r.ZA;
    if(!r.AA) continue;
    seen=true;
    if(!r.AE||!r.AF) continue;
    const status=['4','5','9','36','37','42','43','54'].includes(r.AC)?'other':({'1':'upcoming','2':'live','3':'finished'}[r.AB]||'other');
    matches.push({id:r.AA,home:r.AE,away:r.AF,breakHome:goals(r.BC),breakAway:goals(r.BD),homeId:r.PX,awayId:r.PY,hg:goals(r.AG),ag:goals(r.AH),start:Number(r.AD),league,status,stage:stages[r.AC]||status});
  }
  if(!seen) throw Error('Unrecognized fixture list');
  return matches;
}
export function previous(text){
  const games=new Map();
  for(const r of records(text)){
    if(!r.KP||!r.UQ||!r.UO||!Number(r.KC)||goals(r.KU)===null||goals(r.KT)===null) continue;
    games.set(r.KP,{id:r.KP,start:Number(r.KC),home:r.UQ,away:r.UO,hg:goals(r.KU),ag:goals(r.KT)});
  }
  return [...games.values()].sort((a,b)=>b.start-a.start);
}

export function matchStats(text){
 const names={'Expected goals (xG)':'xg','Total shots':'shots','Shots on target':'onTarget','Red cards':'reds','Ball possession':'possession'};
 const result={};let period='';
 for(const r of records(text)){
  if(r.SE)period=r.SE;
  const key=names[r.SG];
  if(period!=='Match'||!key)continue;
  const values=[r.SH,r.SI].map(v=>/^\d+(\.\d+)?%?$/.test(v||'')?Number(v.replace('%','')):null);
  if(values.every(v=>v!==null))result[key]=values;
 }
 return result;
}
