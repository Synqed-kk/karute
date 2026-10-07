/** How long the browser waits on one sync run (POST /api/sync/quickreserve)
 *  before treating it as failed and releasing the store's in-flight claim.
 *  A network deadline, not a business duration: the route's own server limit
 *  is `export const maxDuration = 300` (src/app/api/sync/quickreserve/route.ts),
 *  so 300 s plus a 30 s margin for the network and a cold start; a run the
 *  server could still answer is never cut short.
 *
 *  Used with AbortController + a timer, not AbortSignal.timeout (absent from
 *  jsdom and from WebViews older than Chrome 103; thin/ports/actions.vite.ts). */
export const SYNC_RUN_DEADLINE_MS = 330_000
