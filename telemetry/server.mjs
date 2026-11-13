// Minimal OTLP protobuf trace exporter for the worker runtime. No client-side credentials.
const utf8 = new TextEncoder();
function pbVarint(value) {
  const out = [];
  while (value >= 128) {out.push((value & 127) | 128); value = Math.floor(value / 128);}
  out.push(value); return out;
}
function pbBytes(field, bytes) {return [field * 8 + 2, ...pbVarint(bytes.length), ...bytes];}
function pbText(field, value) {return pbBytes(field, utf8.encode(String(value)));}
function pbAttribute(name, value) {
  const inner = typeof value === 'boolean' ? [24, value ? 1 : 0] :
    typeof value === 'number' && Number.isFinite(value) ? (() => {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, value, true); return [33, ...b];
    })() : pbText(1, typeof value === 'string' ? value : JSON.stringify(value));
  return [...pbText(1, name), ...pbBytes(2, inner)];
}
function pbTimestamp(field, millis) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(millis) * 1000000n, true);
  return [field * 8 + 1, ...bytes];
}
function hex(bytes) {return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');}
function evaluateForecast(input, output) {
  const current = input?.currentScore;
  const scoreConsistency = Array.isArray(current) && current.length === 2 &&
    current.every(x => Number.isInteger(x) && x >= 0) &&
    Number.isInteger(output?.home) && Number.isInteger(output?.away) &&
    output.home >= current[0] && output.away >= current[1];
  const probabilityValidity = typeof output?.exactScoreProbability === 'number' &&
    Number.isFinite(output.exactScoreProbability) &&
    output.exactScoreProbability >= 0 && output.exactScoreProbability <= 1;
  return {scoreConsistency, probabilityValidity};
}
async function exportForecastTrace(env, trace) {
  if (!env?.NEATLOGS_API_KEY || !env?.NEATLOGS_ENDPOINT)
    return {exported:false,error:'Neatlogs server configuration missing'};
  const traceId = crypto.getRandomValues(new Uint8Array(16));
  const rootId = crypto.getRandomValues(new Uint8Array(8));
  const at = Date.now();
  const attributes = (values) => Object.entries(values).flatMap(([k,v])=>pbBytes(9,pbAttribute(k,v)));
  function span(name,id,parent,values) {
    return pbBytes(2, [
      ...pbBytes(1,traceId), ...pbBytes(2,id),
      ...(parent ? pbBytes(4,parent) : []), ...pbText(5,name),
      ...pbTimestamp(7,at),...pbTimestamp(8,Date.now()),
      ...attributes(values),...pbBytes(15,[24,1]) // OTLP Status.code = OK (field 3)
    ]);
  }
  let spans = span(trace.name,rootId,null,{
    'neatlogs.span.kind':'workflow','neatlogs.input_value':JSON.stringify(trace.input ?? {}),
    'neatlogs.output_value':JSON.stringify(trace.output ?? {}),
    'service.version':'goalpulse-telemetry-v2'
  });
  for (const item of trace.children || []) {
    const kind = item.kind || 'workflow';
    const values = {
      'neatlogs.span.kind':kind,
      'neatlogs.input_value':JSON.stringify(item.input ?? {}),
      'neatlogs.output_value':JSON.stringify(item.output ?? {})
    };
    if (typeof item.passed === 'boolean') {
      values['neatlogs.guardrail.passed'] = item.passed;
      values['goalpulse.evaluation.passed'] = item.passed;
    }
    spans.push(...span(item.name,crypto.getRandomValues(new Uint8Array(8)),rootId,values));
  }
  const resource = pbBytes(1,pbAttribute('service.name',env.NEATLOGS_PROJECT || 'goalpulse'));
  const scopeSpans = pbBytes(2,spans);
  const body = Uint8Array.from(pbBytes(1,[...pbBytes(1,resource),...scopeSpans]));
  try {
    const endpoint = new URL(env.NEATLOGS_ENDPOINT);
    if (endpoint.protocol !== 'https:') return {exported:false,error:'Neatlogs endpoint must use HTTPS'};
    endpoint.pathname = endpoint.pathname.replace(/\/$/,'')+'/v1/traces';
    const response = await fetch(endpoint.toString(),{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'x-api-key':env.NEATLOGS_API_KEY,'Content-Type':'application/x-protobuf'},
      body
    });
    if (!response.ok) {
      console.warn('Neatlogs OTLP rejected HTTP',response.status);
      return {exported:false,error:'Neatlogs OTLP HTTP '+response.status};
    }
    const receipt = new Uint8Array(await response.arrayBuffer());
    // Standard empty OTLP success response. A nonempty response may contain partial_success.
    if (receipt.length) return {exported:false,error:'Neatlogs OTLP response requires partial-success inspection'};
    const traceIdText=hex(traceId);
    console.info('Neatlogs OTLP accepted',traceIdText);
    return {exported:true,traceId:traceIdText,collectorAccepted:true,detectorsVerified:false};
  } catch (error) {
    console.warn('Neatlogs OTLP export failed',error.message);
    return {exported:false,error:'Neatlogs export failed: '+error.message};
  }
}
function browserTraceConfig() {return '';}
