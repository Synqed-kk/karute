// Set a karute's session outcome (成約/不成約/後で決める) after the fact (packet 07
// §Build 3). WithClient variant of setKaruteOutcome; the customerId is DERIVED
// server-side from the karute record (never client-supplied) — a cross-tenant
// karute id → not_found before any upsert. Naturally-idempotent upsert → no
// Idempotency-Key; no version token → no If-Match. Capability: records.write
// (the web action enforces login only — a recorded WIDENING per §Build 3).

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { readKaruteRaw } from '@/lib/app-api/karute-facade'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import {
  setKaruteOutcomeWithClient,
  REVISIT_NOT_ELIGIBLE,
  REVISIT_CHECK_UNAVAILABLE,
} from '@/lib/karute/outcome'

export const runtime = 'nodejs'

type Params = { id: string }

// Same status/reason vocabulary as outcome-types.ts. Strict — a spoofed
// customerId (or any extra key) is rejected; the path id is authoritative.
const OutcomeSchema = z
  .object({
    status: z.enum(['success', 'no_deal', 'pending', 'revisit']),
    reason: z
      .enum(['budget', 'considering', 'mismatch', 'follow_up', 'other'])
      .nullable()
      .optional(),
    isFirstVisit: z.boolean().optional(),
  })
  .strict()

export const POST = facadeHandler<Params>('karute.outcome.set', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'karute id is required')

  const synqed = newSynqedClient(ctx.identity.businessId)

  // Prove karuteRecordId → business BEFORE the upsert; derive customerId from the
  // record (never trust the client). Cross-tenant → not_found.
  const record = await readKaruteRaw(synqed, id)
  const customerId = (record.customer_id as string | null) ?? null
  if (!customerId) throw new AppApiError('not_found', 'karute has no linked customer')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = OutcomeSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  // decided_by parity — the resolved self staff id (nullable, not fail-closed).
  const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
  const result = await setKaruteOutcomeWithClient(synqed, {
    karuteRecordId: id,
    customerId,
    status: parsed.data.status,
    reason: parsed.data.reason ?? null,
    isFirstVisit: parsed.data.isFirstVisit,
    decidedBy: staffId,
  })
  // Ineligible 'revisit' is a bad request, not an upstream fault (the chokepoint
  // allows it when this record's stored outcome is already revisit).
  if (result.error === REVISIT_NOT_ELIGIBLE) {
    throw new AppApiError('validation', 'revisit requires a returning customer')
  }
  // Pre-persist (this route IS the label write): an unverifiable check is OUR
  // fault, so it gets a retryable shape — never a 400 blaming the client.
  if (result.error === REVISIT_CHECK_UNAVAILABLE) {
    throw new AppApiError('upstream_unavailable', 'could not verify revisit eligibility')
  }
  if (result.error) throw new AppApiError('upstream_unavailable', 'outcome write failed')
  // Wave W3: customer_id rides the hook's karute.outcome_set emit for the
  // viewer's name join (Wave V karute-target canon — additive color only).
  ctx.auditDetail = { customer_id: customerId }
  return ok(ctx, { ok: true })
})

export const OPTIONS = POST
