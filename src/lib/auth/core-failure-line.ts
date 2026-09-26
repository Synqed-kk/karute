import { AppApiError, describeUnknownThrow } from '@/lib/app-api/errors'

/**
 * Round 3 leg 7 (D-S27-1/2): the staff-facing line for a TYPED synqed-core failure at a
 * permission gate or roster read — an outage (`upstream_unavailable`, 502 class) or a
 * client defect (`internal`, 500 class) — so no action ever prints an internal English
 * sentence. Returns null for EVERYTHING else: a plain-Error denial and
 * `membership_inactive` keep the site's own answer byte-for-byte. Never widen this.
 * One bounded, location-neutral log per call (the typed failure may come from any core
 * read inside the site's catch, D-S27-8); the code rides in the log line so the two classes stay
 * separate in the server log (the facade's 502/500 split is untouched).
 */
export async function coreFailureLine(e: unknown, tag: string): Promise<string | null> {
  if (!(e instanceof AppApiError)) return null
  if (e.code !== 'upstream_unavailable' && e.code !== 'internal') return null
  console.error(`${tag} typed synqed-core failure (${e.code}):`, describeUnknownThrow(e))
  // Dynamic next-intl import — repo convention (regenerate-karute.ts, recovery.ts): a
  // top-level one drags next-intl's ESM into every jest graph that touches an action.
  const { getTranslations } = await import('next-intl/server')
  return (await getTranslations('common'))('somethingWentWrong')
}

/**
 * S33 (D-S33-1): a DIRECT SDK call (`synqed.X.Y()`) never throws an AppApiError — a non-2xx
 * is the SDK's own SynqedError (`status` + core's own error text), a network drop a native
 * TypeError ('fetch failed'). This maps exactly those two OUTAGE shapes onto the typed class
 * coreFailureLine already reads, so a write catch can ask it; it produces no text. Everything
 * else comes back as the SAME value: an SDK 4xx is core's own refusal and keeps its bytes, a
 * plain-Error denial and every AppApiError pass through. Never widen this.
 * SynqedError is recognised by the `name` the SDK sets (a value import would pull the ESM-only
 * SDK into every action graph). coreFailureLine logs describeUnknownThrow(e), which never reads
 * `cause`, so the bounded SDK detail rides the message (log-only — no caller prints it) and
 * the original rides `cause`.
 * Reads are defensive (describeUnknownThrow's one try): a throwing name/status getter returns `e` as is.
 */
export function classifyCoreThrow(e: unknown): unknown {
  const d = describeUnknownThrow(e)
  const sdk5xx = d.errName === 'SynqedError' && typeof d.errStatus === 'number' && d.errStatus >= 500
  if (!(e instanceof TypeError) && !sdk5xx) return e
  const kind = d.errStatus === undefined ? d.errName : `${d.errName} ${d.errStatus}`
  return new AppApiError('upstream_unavailable', `synqed-core call failed (${kind}): ${d.errMessage}`, undefined, e)
}
