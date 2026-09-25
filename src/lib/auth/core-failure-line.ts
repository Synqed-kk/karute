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
