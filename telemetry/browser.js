let lastForecastTrace;
const pendingForecastTraces = new Set();
async function recordBrowserForecast(input, best) {
  const output = {home: best.home, away: best.away, exactScoreProbability: best.probability};
  const signature = JSON.stringify([input, output]);
  if (lastForecastTrace === signature || pendingForecastTraces.has(signature)) return;
  pendingForecastTraces.add(signature);
  try {
    const response = await fetch('/api/telemetry/forecast', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({input, output})
    });
    const receipt = await response.json();
    if (!response.ok || !receipt.exported || !receipt.traceId)
      throw Error(receipt.error || 'Trace export not confirmed (HTTP ' + response.status + ')');
    lastForecastTrace = signature;
    console.info('GoalPulse OTLP export accepted', {traceId:receipt.traceId, evaluations:receipt.evaluations,
      note:'Collector acknowledgment does not prove Neatlogs detectors executed'});
  } catch (error) {
    console.warn('Browser forecast trace failed', error.message);
  } finally {
    pendingForecastTraces.delete(signature);
  }
}
