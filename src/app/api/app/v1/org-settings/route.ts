// org-settings facade write (design-parity packet 12 §S1). One route for
// FIVE settings tabs (organization/theme/ai/recording/packs) — they all
// mutate via the SAME web action (upsertOrgSettings), so one facade PATCH
// mirrors it rather than five near-identical routes.
//
// Authz: standard facade convention (ensureCapability throws → 403), mirroring
// upsertOrgSettings's own gate (src/actions/org-settings.ts:285 —
// `ensureCapability(await getMyCapabilities(), 'settings.manage')`). NOT
// upsertOrgSettings's own soft `{ error }` return for a failed gate — that
// shape is web's in-process RPC convenience, not the facade's authz-boundary
// contract every other route uses (customer PATCH, appointment mutations,
// etc. all throw→403 on a missing capability; this stays consistent with
// them rather than inventing a second authz convention for one route).
//
// Business-result passthrough: writeOrgSettingsBlobWithClient's OWN result
// shape ({ success: true } | { error: string } — upsertOrgSettings's
// contract) rides the 2xx body VERBATIM (RPC-style, same class as the
// appointments mutations' statusCall precedent) — ThemeSection/AISection/etc.
// all branch on `'error' in result` exactly as they do against the web action.
//
// revocation: 'orgSettings.update' is already in REVOCATION_SENSITIVE_ENDPOINTS
// (src/lib/auth/revocation.ts) — a just-terminated staffer's Bearer token
// can't rewrite org settings on the local fast-path.
//
// audit: writeOrgSettingsBlob has no auditWeb() call on the web side (verified
// at source — src/actions/org-settings.ts has no audit-log import), so this
// endpoint is a deliberate FACADE_AUDIT_MAP 'skip' row (src/lib/audit.ts) —
// same parity rule as the appointment.* mutations: a facade audit row here
// would log something web itself never logs.
//
// Idempotency: no Idempotency-Key required. This is a field-level merge write
// (last-write-wins, same class as customer PATCH — updateCustomerWithClient's
// route takes none either), not a create — a retried PATCH can't duplicate
// anything the way a retried booking-create could.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { writeOrgSettingsBlobWithClient } from '@/actions/org-settings'
import { OrgSettingsPatchDTO } from '@/lib/app-api/settings-screen-dto'

export const runtime = 'nodejs'

export const PATCH = facadeHandler('orgSettings.update', async (ctx) => {
  // Mirrors upsertOrgSettings's own gate exactly.
  ensureCapability(ctx.identity.capabilities, 'settings.manage')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }

  const parsed = OrgSettingsPatchDTO.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((i) => i.message).join(', '))
  }

  const synqed = newSynqedClient(ctx.identity.businessId)
  const result = await writeOrgSettingsBlobWithClient(synqed, parsed.data)
  return ok(ctx, result)
})

export const OPTIONS = PATCH // facadeHandler short-circuits OPTIONS before auth.
