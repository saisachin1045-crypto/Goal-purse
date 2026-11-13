# GoalPulse

[Open the live football dashboard](https://goalpulse-football-lab.saisachin1045.chatgpt.site)

Build with `node scripts/build.mjs` and check with `node scripts/validate-artifact.mjs`. The server needs a worker runtime, a `BUCKET` object storage binding and the `FLASHSCORE_FSIGN` feed credential. The live archive resides on Sites.

## Neatlogs telemetry

Browser forecasts now POST to the same-origin `/api/telemetry/forecast` route. The worker exports OTLP protobuf to `NEATLOGS_ENDPOINT/v1/traces` with the private `NEATLOGS_API_KEY` header `x-api-key`. Configure `NEATLOGS_PROJECT` as the service name. Do not put the API key in browser JavaScript or public environment variables.

The route returns `exported`, `traceId`, `collectorAccepted`, `detectorsVerified:false`, and per-forecast `evaluations`. A successful response means the collector accepted the export; it does **not** establish that Neatlogs detectors or server-side evals have run. A failing local guardrail is explicitly tagged `neatlogs.guardrail.passed=false`; inspect its status in Neatlogs after ingestion.

Run `node scripts/test-telemetry.mjs`, `node scripts/build.mjs`, and `node scripts/validate-artifact.mjs` before publishing the generated `dist` directory to the existing Site. The test uses a mocked collector and deliberately invalid probability (1.2); it does not transmit a real trace.

After publishing, open a fixture and inspect the browser console for `GoalPulse OTLP export accepted`. Confirm that the same trace ID appears in Neatlogs, with three spans (workflow, score consistency, probability validity). To test a failing evaluation against real Neatlogs, send a controlled QA fixture with probability 1.2 from an authorized same-origin context. Do not claim a detector ran until the Neatlogs UI shows the detector/eval result for that trace.
