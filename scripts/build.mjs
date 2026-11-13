import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const assets=Object.fromEntries([['/','live.html'],['/live.js','live.js'],['/forecast.js','forecast.js'],['/manual','manual.html'],['/manual.js','manual.js']].map(([url,file])=>[url,(file==='live.js'?read('telemetry/browser.js')+'\n':'')+read('content/'+file)]));
fs.mkdirSync('dist/server',{recursive:true});fs.mkdirSync('dist/.openai',{recursive:true});
fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
fs.writeFileSync('dist/server/index.js','const assets='+JSON.stringify(assets)+';\nconst backup='+read('content/backup.json')+';\n'+read('worker/feed.mjs')+'\n'+read('content/forecast.js')+'\n'+read('worker/audit.mjs')+'\n'+read('telemetry/server.mjs')+'\n'+read('worker/router.mjs'));
