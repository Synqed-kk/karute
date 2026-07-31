// Facade: per-entry edit history (edit-layer W2 history-sheet packet). Read-
// only companion to entries/[entryId]'s PATCH — delegates to the SAME twin
// (listEntryEditHistoryWithClient, src/actions/karute.ts) the web action uses.
//
// Gate: 'customers.view' (same class gate as the detail screen read —
// screens/karute/[id]/route.ts:51).
//
// TENANCY: readKaruteRaw proves the karute id FIRST — cross-tenant/missing →
// 404, genuine upstream failure → 502 (sibling entries/[entryId] pattern),
// BEFORE the history read runs.
//
// audit: 'karute.entryEdits.list' IS a live view row in FACADE_AUDIT_MAP
// (karute.entry_edits_view, Wave V). This header used to argue the opposite
// ("each entry_edit row IS the audit event") — the council REVERSED that
// (contract §3.1): the DTO returns contentBefore/contentAfter, verbatim
// before/after clinical text, and canon §1 split the tables precisely so
// content ≠ event spine. Content-defined rule ⇒ view. The emit is the
// generic success hook's; this route only enriches it with the customer id
// for the viewer's name join (packet 30 §4 idiom, ids only).
//
// revocation: GET, zero write side effects — unlike 'audit.list'/
// 'stores.list' this route's read hides no write, so it does NOT belong in
// REVOCATION_SENSITIVE_ENDPOINTS (src/lib/auth/revocation.ts).

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { readKaruteRaw } from '@/lib/app-api/karute-facade'
import { listEntryEditHistoryWithClient } from '@/actions/karute'

export const runtime = 'nodejs'

type Params = { id: string }

const EntryEditRowSchema = z.object({
  id: z.string(),
  entryIdOld: z.string().nullable(),
  entryIdNew: z.string().nullable(),
  // Nullable — legacy-null enum precedent on this table family.
  action: z.string().nullable(),
  actorName: z.string().nullable(),
  contentBefore: z.string().nullable(),
  contentAfter: z.string().nullable(),
  createdAt: z.string(),
})
const EntryEditHistoryDTO = z.object({ edits: z.array(EntryEditRowSchema), truncated: z.boolean() })

export const GET = facadeHandler<Params>('karute.entryEdits.list', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'karute id is required')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  // Proof-read BEFORE the history read — a cross-tenant/missing id 404s here
  // via classifyGetError (readKaruteRaw), never reaching the twin.
  const raw = await readKaruteRaw(synqed, id)

  const result = await listEntryEditHistoryWithClient(synqed, businessId, id)
  // Viewer name join (same karute-row idiom as karute.save/entry_edit):
  // customer_id rides in detail so the 監査ログ row shows the customer's
  // name, not a raw karute UUID. Free — the proof-read already holds it.
  ctx.auditDetail = { customer_id: (raw.customer_id as string | null) ?? null }
  return ok(ctx, EntryEditHistoryDTO.parse(result))
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
