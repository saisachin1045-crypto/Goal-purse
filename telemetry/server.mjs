async function exportForecastTrace(env, trace) {
  if (!env?.NEATLOGS_BROWSER_WRITE_KEY || !env.NEATLOGS_PROJECT) return;
  try {
    const response = await fetch(env.NEATLOGS_ENDPOINT + '/v1/trace', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: {Authorization: 'Bearer ' + env.NEATLOGS_BROWSER_WRITE_KEY, 'Content-Type': 'application/json'},
      body: JSON.stringify({...trace, project: env.NEATLOGS_PROJECT})
    });
    if (!response.ok) throw Error('HTTP ' + response.status);
    const receipt = await response.json();
    if (!receipt.success || !receipt.trace_id) throw Error('Missing trace receipt');
    console.info('Neatlogs trace accepted', receipt.trace_id);
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
