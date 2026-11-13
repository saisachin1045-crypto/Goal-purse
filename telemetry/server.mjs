// Encode the OTLP ExportTraceServiceRequest fields used by the collector.
const utf8 = new TextEncoder();
function protobufBytes(field, bytes) {
  const length = [];
  let size = bytes.length;
  while (size >= 128) {
    length.push((size & 127) | 128);
    size >>>= 7;
  }
  return [field * 8 + 2, ...length, size, ...bytes];
}
function traceText(field, value) {
  return protobufBytes(field, utf8.encode(String(value)));
}
function traceAttribute(name, value) {
  return [...traceText(1, name), ...protobufBytes(2, traceText(1, value))];
}
function traceTimestamp(field, millis) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(millis) * 1000000n, true);
  return [field * 8 + 1, ...bytes];
}
async function exportForecastTrace(env, trace) {
  if (!env?.NEATLOGS_API_KEY) return;
  const traceId = crypto.getRandomValues(new Uint8Array(16));
  const rootId = crypto.getRandomValues(new Uint8Array(8));
  const at = Date.now();
  function span(name, id, parent, attributes) {
    return protobufBytes(2, [
      ...protobufBytes(1, traceId), ...protobufBytes(2, id),
      ...(parent ? protobufBytes(4, parent) : []), ...traceText(5, name),
      ...traceTimestamp(7, at), ...traceTimestamp(8, at),
      ...Object.entries(attributes).flatMap(([k,v]) => protobufBytes(9, traceAttribute(k,v)))
    ]);
  }
  try {
    const spans = span(trace.name, rootId, null, {});
    for (const item of trace.children) {
      spans.push(...span(item.name, crypto.getRandomValues(new Uint8Array(8)), rootId, {...item.input, ...item.output}));
    }
    const resource = protobufBytes(1, traceAttribute('service.name', env.NEATLOGS_PROJECT));
    const body = Uint8Array.from(protobufBytes(1, [...protobufBytes(1, resource), ...protobufBytes(2, spans)]));
    const response = await fetch(env.NEATLOGS_ENDPOINT + '/v1/traces', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: {'x-api-key': env.NEATLOGS_API_KEY, 'Content-Type': 'application/x-protobuf'}, body
    });
    if (!response.ok) {
      const reason = (await response.text()).match(/(?:error code: ?\d+|blocked|forbidden|denied|invalid api key)/i);
      throw Error('HTTP ' + response.status + (reason ? ' ' + reason[0] : ''));
    }
    const receipt = new Uint8Array(await response.arrayBuffer());
    if (receipt.length) throw Error('Nonempty OTLP response; check partial success');
    console.info('Neatlogs trace accepted', Array.from(traceId, x => x.toString(16).padStart(2, '0')).join(''));
  } catch (error) {
    console.warn('Neatlogs export failed', error.message);
  }
}

function browserTraceConfig(env) {
  const key = env?.NEATLOGS_BROWSER_WRITE_KEY;
  if (!key?.startsWith('nlw_')) return '';
  const config = {key, endpoint: env.NEATLOGS_ENDPOINT, project: env.NEATLOGS_PROJECT};
  return 'window.goalPulseTraceConfig=' + JSON.stringify(config) + ';\n';
}
