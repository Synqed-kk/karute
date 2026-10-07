// THE one territory file that reaches core (DESIGN-PRACTICE-DOOR.md §2, §7).
// Explicit-tenant factory only; the tenant check runs BEFORE the client is built,
// so a login-path bug fails loud and never lists another business. The SDK client
// never leaves this file: callers get bound READ methods, plus the one org-settings
// writer (A2, Liam 9/24) — a write-only handle with `upsert` and nothing else.

import { newSynqedClient } from '@/lib/synqed/client'
import { doorFor, practiceTenant } from './switch'

export class PracticeTenantMismatch extends Error {
  readonly businessId: string
  constructor(businessId: string) {
    super(`practice switch refused business ${businessId}`)
    this.name = 'PracticeTenantMismatch'
    this.businessId = businessId
  }
}

export type CoreClient = ReturnType<typeof newSynqedClient>
export type CoreReads = ReturnType<typeof readsOf>

export function clientFor(admitted: { businessId: string }): CoreReads {
  const tenant = practiceTenant()
  if (tenant === null) throw new Error('practice door called with the switch unset')
  if (!doorFor(admitted.businessId)) throw new PracticeTenantMismatch(admitted.businessId) // R50 — the ONE tenant match
  return readsOf(newSynqedClient(tenant))
}

/** ⚖ A2 (Liam 9/24, R-A2-7) — the ONE org-settings writer, for door.ts's one guarded call. The same two
 *  throws as clientFor, BEFORE the client is built; the handle is write-only: `orgSettings.upsert` and
 *  nothing else (no get, no list, no other resource). */
export function orgSettingsWriterFor(admitted: { businessId: string }): { orgSettings: Pick<CoreClient['orgSettings'], 'upsert'> } {
  const tenant = practiceTenant()
  if (tenant === null) throw new Error('practice door called with the switch unset')
  if (!doorFor(admitted.businessId)) throw new PracticeTenantMismatch(admitted.businessId) // R50 — the ONE tenant match
  const client = newSynqedClient(tenant)
  return { orgSettings: { upsert: client.orgSettings.upsert.bind(client.orgSettings) } }
}

export function readsOf(client: CoreClient) {
  return {
    storesList: () => client.stores.list(),
    staffList: (o?: Parameters<CoreClient['staff']['list']>[0]) => client.staff.list(o),
    staffStoresList: () => client.staffStores.list(),
    answerSheet: (id: string) => client.permissions.answerSheet(id),
    menusList: (o?: Parameters<CoreClient['menus']['list']>[0]) => client.menus.list(o),
    customersList: (o?: Parameters<CoreClient['customers']['list']>[0]) => client.customers.list(o),
    customerVisits: (id: string) => client.customers.listVisits(id),
    appointmentsList: (o?: Parameters<CoreClient['appointments']['list']>[0]) => client.appointments.list(o),
    orgSettingsGet: () => client.orgSettings.get(),
    resourcesList: (o?: Parameters<CoreClient['resources']['list']>[0]) => client.resources.list(o),
    // ⚖ §v11 V11-1 — the store's own weekly_hours (営業時間 · 定休日), one store per call.
    storePolicyGet: (storeId: string) => client.storePolicies.get(storeId),
    // ⚖ PKT-S29-B1 — the store's own 臨時休業 rows, one store per call. `range` is
    // the caller's (door-writes.ts derives "today forward" from the clock).
    storePolicyListClosedDays: (storeId: string, range?: Parameters<CoreClient['storePolicies']['listClosedDays']>[1]) =>
      client.storePolicies.listClosedDays(storeId, range),
    // ⚖ PKT-S29-B1 R2(c) — the ONE org-level grant the store-days door needs: does
    // this staff id hold a live HQ_ADMIN grant? A read (no body), so it lives here
    // beside the other bound reads rather than in the write-only handle below.
    businessGrantsCheck: (staffId: string) => client.businessGrants.check(staffId, 'HQ_ADMIN'),
    // ⚖ PKT-S29-B1 P-B1-8 — the store_policy.edit audit row a live proof reads
    // back (owner-only per the SDK's own doc comment; the practice actor's sheet
    // is never assumed to carry that right — a caller without it gets core's own
    // refusal, exactly like any other core call this door makes).
    auditList: (o?: Parameters<CoreClient['audit']['list']>[0]) => client.audit.list(o),
  }
}

/** ⚖ PKT-S29-B1 R1 — the store-days writer, door-writes.ts's own handle, built
 *  exactly like A2's `orgSettingsWriterFor` above: the same two throws, BEFORE
 *  the client is built; write-only (`set` / `addClosedDay` / `removeClosedDay`
 *  and nothing else — no `get`, no `list`, no `listClosedDays`). The actual
 *  call expressions (`storePolicies.set(`, `.addClosedDay(`, `.removeClosedDay(`)
 *  live only in door-writes.ts and (Reserve S66, the six booking rules, `set`
 *  only) door-reserve-policy.ts, this handle's two callers — this file hands
 *  over bound methods, it never invokes them. */
export function storeDaysWriterFor(admitted: { businessId: string }): { storePolicies: Pick<CoreClient['storePolicies'], 'set' | 'addClosedDay' | 'removeClosedDay'> } {
  const tenant = practiceTenant()
  if (tenant === null) throw new Error('practice door called with the switch unset')
  if (!doorFor(admitted.businessId)) throw new PracticeTenantMismatch(admitted.businessId) // R50 — the ONE tenant match
  const { storePolicies } = newSynqedClient(tenant)
  return {
    storePolicies: {
      set: storePolicies.set.bind(storePolicies),
      addClosedDay: storePolicies.addClosedDay.bind(storePolicies),
      removeClosedDay: storePolicies.removeClosedDay.bind(storePolicies),
    },
  }
}

/** ⚖ PKT-S29-B1 R6 fold (lead, audit branch) — a write-only handle for the ONE
 *  audit event the door records after a successful closure removal (core's SDK
 *  `removeClosedDay` takes no audit payload and hard-deletes the row). Same two
 *  throws, write-only: `log` and nothing else. Never used for the read half
 *  (`auditList` above serves that; a writer and a reader are two different
 *  truths on this door, same as every other writer/reader pair here). */
export function auditWriterFor(admitted: { businessId: string }): { audit: Pick<CoreClient['audit'], 'log'> } {
  const tenant = practiceTenant()
  if (tenant === null) throw new Error('practice door called with the switch unset')
  if (!doorFor(admitted.businessId)) throw new PracticeTenantMismatch(admitted.businessId) // R50 — the ONE tenant match
  // ⚖ PKT-S30 F6 — the SAME nested shape as storeDaysWriterFor (`{ storePolicies: … }`), so the
  // call site reads `.audit.log(` and CP3 (check-business-data-access.mjs) ties it back to the
  // SDK's `audit.log` write: allowlist row in src/lib/audit-policy.ts, writers row in
  // business-territory.json, bind-scan ALLOW entry for this exact line.
  // The local stays `auditClient`: a bare `audit` is a deny-set name for check-shared-cores.mjs
  // (src/lib/audit's own export), and B0b's CP3 ALLOW names this exact line.
  const auditClient = newSynqedClient(tenant).audit
  return { audit: { log: auditClient.log.bind(auditClient) } }
}
