/** Ambient request id for the duration of one server request.
 *
 *  `facadeHandler` already mints a canonical id per request and puts it on
 *  audit rows and the `request-id` response header. What it never did was tell
 *  CORE about it: every outbound SDK call arrived with no correlation header,
 *  so core minted its own id and the two halves of the stack logged the same
 *  failure under two unrelated keys. During the 2026-09-04 outage that meant a
 *  Karute 500 could not be tied to the core request that produced it.
 *
 *  AsyncLocalStorage rather than a threaded parameter: `getSynqedClient()` is
 *  called from actions, loaders and routes many layers below the handler, and
 *  threading an id through all of them would touch far more code than the
 *  problem is worth. All Karute routes run on the Node runtime (no `edge`
 *  exports), so ALS is available.
 *
 *  Reading it is always optional — a caller outside a request (a cron, a
 *  script, a test) simply gets `null` and sends no header. */

import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage<{ requestId: string }>()

/** Run `fn` with `requestId` as the ambient id for everything it awaits. */
export function withRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn)
}

/** The current request's id, or null outside a request. */
export function getRequestId(): string | null {
  return storage.getStore()?.requestId ?? null
}
