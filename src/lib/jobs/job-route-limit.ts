// ⚖ THE WORKER'S FUNCTION LIMIT, in ms — the job route's own
// `export const maxDuration = 300` (src/app/api/jobs/process/route.ts, the one
// route that runs the worker). The route keeps its own literal, unchanged; this
// is the ONE number the meter's lease budget derives from (src/lib/ai/transcribe.ts,
// LEASE_WORKER_FUNCTION_LIMIT_MS → LEASE_TAKEOVER_RESERVE_MS → LEASE_WORKER_WAIT_MS),
// pinned to the route's export by a test (transcription-spend-wall.test.ts, w4),
// and fed a different limit by another (w4b), so a budget typed as a bare number
// can never pass by coincidence. No imports.
export const JOB_ROUTE_FUNCTION_LIMIT_MS = 300_000
