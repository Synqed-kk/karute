// Facade: 破棄の記録 list — the manager read of core's discard ledger, and the
// phone arm's twin of the web listDiscardReasons() action. Single-source:
// calls the SAME twin that action delegates to (listDiscardReasonsWithClient,
// src/actions/recording-discards.ts) — the P-B pattern the 監査ログ route
// standardizes, so phone and web cannot drift into different lists.
//
// Gate: 'staff.manage', the SAME predicate web enforces (ensureCapability
// against getMyCapabilities() there, against the Bearer-resolved capability
// set here). Deliberately the existing owner/manager line and not a new
// capability — see the action's own header for that ruling.
//
// Read-only → no Idempotency-Key, and not revocation-sensitive: this GET
// hides no write (unlike stores.list / audit.list), like every other pure
// facade read.
//
// audit: 'recordings.discards.list' is a deliberate 'skip' in FACADE_AUDIT_MAP
// — a manager LIST read never logs (web parity: the web action emits nothing),
// and ⚖ 8/17 doc law keeps the reason text out of audit details regardless.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { listDiscardReasonsWithClient } from '@/actions/recording-discards'
import { DiscardReasonsListDTO } from '@/lib/app-api/discard-reasons-dto'

export const runtime = 'nodejs'

export const GET = facadeHandler('recordings.discards.list', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.manage')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  let result
  try {
    result = await listDiscardReasonsWithClient(synqed, businessId)
  } catch (err) {
    // The twin THROWS on a failed read rather than answering an empty ledger,
    // so a transient core failure surfaces as 502 upstream_unavailable — the
    // same honest class recordings/inbox and recordings/discard use, never a
    // 2xx that would read as "nothing was ever discarded".
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'the discard ledger is unavailable')
  }

  // Parsed at the door, the audit-log route's convention: the wire shape is a
  // contract with a baked phone, and a rename inside the shared twin would
  // otherwise reach it silently (see discard-reasons-dto.ts). OUTSIDE the
  // catch on purpose — a shape drift is our own bug, and calling it an
  // upstream outage would send a manager to check the wrong thing.
  return ok(ctx, DiscardReasonsListDTO.parse(result))
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
