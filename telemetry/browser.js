let lastForecastTrace;
const pendingForecastTraces = new Set();
async function recordBrowserForecast(fixture, minute, best) {
  const config = window.goalPulseTraceConfig;
  if (!config) return;
  const output = {fixture, minute, home: best.home, away: best.away};
  const signature = JSON.stringify(output);
  if (lastForecastTrace === signature || pendingForecastTraces.has(signature)) return;
  pendingForecastTraces.add(signature);
  try {
    const response = await fetch(config.endpoint + '/v1/trace', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: {Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'GoalPulse browser forecast', project: config.project, output})
    });
    if (!response.ok) throw Error('HTTP ' + response.status);
    const receipt = await response.json();
    if (!receipt.success || !receipt.trace_id) throw Error('Missing trace receipt');
    lastForecastTrace = signature;
    console.info('Browser forecast trace accepted', receipt.trace_id);
  } catch (error) {
    console.warn('Browser forecast trace failed', error.message);
  } finally {
    pendingForecastTraces.delete(signature);
  }
}
