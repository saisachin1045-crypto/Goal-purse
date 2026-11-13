import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {TextEncoder} from 'node:util';

const calls=[];
const context={
  crypto:webcrypto,TextEncoder,URL,AbortSignal,Uint8Array,DataView,BigInt,Date,console,
  fetch:async (url,options)=>{
    calls.push({url:String(url),options});
    return {ok:true,status:200,arrayBuffer:async()=>new Uint8Array().buffer};
  }
};
vm.runInNewContext(fs.readFileSync('telemetry/server.mjs','utf8')+
  '\n globalThis.testHooks={evaluateForecast,exportForecastTrace};',context);
const {evaluateForecast,exportForecastTrace}=context.testHooks;
const input={fixture:'04LowRUP',currentScore:[0,0]};
const good={home:2,away:1,exactScoreProbability:.09};
const bad={home:2,away:1,exactScoreProbability:1.2};
assert.equal(evaluateForecast(input,good).scoreConsistency,true);
assert.equal(evaluateForecast(input,good).probabilityValidity,true);
assert.equal(evaluateForecast(input,bad).probabilityValidity,false,
  'A deliberately invalid probability MUST fail the evaluation');
assert.equal(evaluateForecast(input,{...good,home:-1}).scoreConsistency,false);
const result=await exportForecastTrace(
  {NEATLOGS_API_KEY:'test-only',NEATLOGS_ENDPOINT:'https://collector.example',
   NEATLOGS_PROJECT:'goalpulse-test'},
  {name:'GoalPulse browser forecast',input,output:bad,
   children:[{name:'Forecast probability validity',kind:'guardrail',
     passed:false,input:bad.exactScoreProbability,output:bad}]}
);
assert.equal(result.exported,true);
assert.equal(result.detectorsVerified,false);
assert.match(result.traceId,/^[0-9a-f]{32}$/);
assert.equal(calls[0].url,'https://collector.example/v1/traces');
assert.equal(calls[0].options.headers['Content-Type'],'application/x-protobuf');
assert.equal(calls[0].options.headers['x-api-key'],'test-only');
assert.ok(calls[0].options.body.length>100);
console.log('Telemetry self-test passed: valid/invalid evaluation + mocked OTLP export');
