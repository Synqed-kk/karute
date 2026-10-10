/**
 * A use-ledger FAKE for suites that guard the redeem paths but do not test the
 * ledger itself (S125 PR-A1). Every request gets a FRESH in-memory store, so
 * one test's intents never gate another's; the real module (recordUse, the
 * classification map, the attempt) runs unchanged on top of it.
 * Use: jest.mock('@/lib/packs/use-ledger', () => jest.requireActual('./helpers/ledger-fake').ledgerModuleFake())
 */
import type { IntentRow, LedgerStore, Where } from '@/lib/packs/use-ledger'

export const FAKE_LEDGER_BUSINESS_ID = '00000000-0000-4000-8000-00000000fa4e'

export function memLedgerStore(): LedgerStore {
  const rows: IntentRow[] = []
  return {
    async insertIgnore(row) {
      if (!rows.some((r) => r.business_id === row.business_id && r.id === row.id)) rows.push({ ...row })
    },
    async getAllById(id) { return rows.filter((r) => r.id === id).map((r) => ({ ...r })) },
    async update(b: string, id: string, w: Where, patch: Partial<IntentRow>) {
      const r = rows.find((x) => x.business_id === b && x.id === id)
      if (!r || r.state !== w.state) return null
      if (w.attempts !== undefined && r.attempts !== w.attempts) return null
      if (w.settledCoreId !== undefined && r.settled_core_id !== w.settledCoreId) return null
      if (w.leaseFreeAt && r.leased_until && !(r.leased_until < w.leaseFreeAt)) return null
      Object.assign(r, patch)
      return { ...r }
    },
    async listForCustomers(b, ids) {
      return rows.filter((r) => r.business_id === b && ids.includes(r.customer_id) && !r.staff_resolution &&
        ['held', 'pending', 'parked', 'refused'].includes(r.state)).map((r) => ({ ...r }))
    },
    async listOpen(b, states, limit) { return rows.filter((r) => r.business_id === b && states.includes(r.state)).slice(0, limit) },
    async listOpenBusinessIds(states) { return [...new Set(rows.filter((r) => states.includes(r.state)).map((r) => r.business_id))] },
    async claimedCoreIds(b, ids) {
      return new Map(rows.filter((r) => r.business_id === b && r.settled_core_id && ids.includes(r.settled_core_id)).map((r) => [r.settled_core_id as string, r.id]))
    },
  }
}

export function ledgerModuleFake() {
  const actual = jest.requireActual('@/lib/packs/use-ledger')
  return {
    ...actual,
    defaultLedgerStore: async () => memLedgerStore(),
    defaultLedgerContext: async () => ({ store: memLedgerStore(), businessId: FAKE_LEDGER_BUSINESS_ID, ownerUserId: null }),
  }
}
