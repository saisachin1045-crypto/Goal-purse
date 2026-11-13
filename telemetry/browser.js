let lastForecastTrace;
function recordBrowserForecast(fixture, minute, best) {
  const config = window.goalPulseTraceConfig;
  if (!config) return;
  const output = {fixture, minute, home: best.home, away: best.away};
  const signature = JSON.stringify(output);
  if (lastForecastTrace === signature) return;
  lastForecastTrace = signature;
  fetch(config.endpoint + '/v1/trace', {
    method: 'POST', redirect: 'error',
    headers: {Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json'},
    body: JSON.stringify({name: 'GoalPulse browser forecast', project: config.project, output})
  }).catch(() => {});
}
