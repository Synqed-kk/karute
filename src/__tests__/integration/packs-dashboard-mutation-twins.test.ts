/**
 * WithClient twins added for design-parity Gap B-1 PR 2 (dashboard
 * mutations): addVisitReconcileDismissalWithClient / addPackAlertDismissal-
 * WithClient / addCustomerContactWithClient. Unlike the read-side twins
 * (packs-withclient-twins.test.ts), these are GRACEFUL — catch internally,
 * return { ok: false } — matching addRedemptionWithClient's convention, NOT
 * removeRedemptionWithClient's THROW convention: the facade dismiss/contact
 * routes are pure RPC passthroughs (return ok(ctx, result)), so the web
 * action's own always-graceful { ok:false } contract (incl. genuine infra
 * failures) must survive the move to an explicit client unchanged.
 */

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(() => ({})),
}))

import {
  addVisitReconcileDismissalWithClient,
  addPackAlertDismissalWithClient,
  addCustomerContactWithClient,
} from '@/lib/packs/store'

// -- server-action wrapper coverage: getSynqedClient() failure (fleet P2) --
// dismissVisitReconcileAction / logCustomerContactAction / dismissPackAlert-
// Action construct the client in the SAME Promise.all as staffId resolution
// (design-parity Gap B-1 PR 2's ActionWithClient split). Unguarded, a
// getSynqedClient() rejection would THROW the whole server action —
// ReconcileStrip/PackAlertsCard await these with no try/catch (stranded
// spinner, no toast). Pins the fix: .catch(() => null) + the SAME graceful
// shape origin/main's cookie-fn-internal try/catch produced for this exact
// failure (verified against git show origin/main:src/actions/packs.ts).
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: jest.fn(async () => 's1') }))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
}))
const getSynqedClient = jest.fn(async () => ({}) as never)
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: () => getSynqedClient(),
}))

import {
  dismissVisitReconcileAction,
  logCustomerContactAction,
  dismissPackAlertAction,
} from '@/actions/packs'

describe('server-action wrappers: getSynqedClient() rejection degrades gracefully, never throws', () => {
  beforeEach(() => {
    getSynqedClient.mockRejectedValue(new Error('session lookup failed'))
  })

  it('dismissVisitReconcileAction → { ok: false }', async () => {
    await expect(
      dismissVisitReconcileAction({ customerId: 'c1', visitDay: '2026-07-20' }),
    ).resolves.toEqual({ ok: false })
  })

  it('logCustomerContactAction → { ok: false, error: "write failed" }', async () => {
    await expect(
      logCustomerContactAction({ customerId: 'c1', channel: 'phone' }),
    ).resolves.toEqual({ ok: false, error: 'write failed' })
  })

  it('dismissPackAlertAction → { ok: false, error: "write failed" }', async () => {
    await expect(dismissPackAlertAction({ customerId: 'c1' })).resolves.toEqual({
      ok: false,
      error: 'write failed',
    })
  })
})

describe('addVisitReconcileDismissalWithClient', () => {
  it('delegates straight through with the mapped field names', async () => {
    const addVisitDismissal = jest.fn(async () => ({ ok: true }))
    const synqed = { packs: { addVisitDismissal } }
    const res = await addVisitReconcileDismissalWithClient(synqed as never, {
      customerId: 'c1',
      appointmentId: 'a1',
      visitDay: '2026-07-20',
      dismissedBy: 's1',
      reason: 'no visit',
    })
    expect(res).toEqual({ ok: true })
    expect(addVisitDismissal).toHaveBeenCalledWith({
      customer_id: 'c1',
      appointment_id: 'a1',
      visit_day: '2026-07-20',
      dismissed_by: 's1',
      reason: 'no visit',
    })
  })

  it('GRACEFUL: a failed write returns { ok: false }, never throws', async () => {
    const synqed = {
      packs: {
        addVisitDismissal: jest.fn(async () => {
          throw new Error('core down')
        }),
      },
    }
    await expect(
      addVisitReconcileDismissalWithClient(synqed as never, {
        customerId: 'c1',
        visitDay: '2026-07-20',
        dismissedBy: 's1',
      }),
    ).resolves.toEqual({ ok: false })
  })
})

describe('addPackAlertDismissalWithClient', () => {
  it('delegates straight through', async () => {
    const addAlertDismissal = jest.fn(async () => ({ ok: true }))
    const synqed = { packs: { addAlertDismissal } }
    const res = await addPackAlertDismissalWithClient(synqed as never, {
      customerId: 'c1',
      dismissedBy: 's1',
      reason: 'contacted',
    })
    expect(res).toEqual({ ok: true })
    expect(addAlertDismissal).toHaveBeenCalledWith({
      customer_id: 'c1',
      dismissed_by: 's1',
      reason: 'contacted',
      expires_at: null,
    })
  })

  it('GRACEFUL: a failed write returns { ok: false }, never throws', async () => {
    const synqed = {
      packs: {
        addAlertDismissal: jest.fn(async () => {
          throw new Error('core down')
        }),
      },
    }
    await expect(
      addPackAlertDismissalWithClient(synqed as never, { customerId: 'c1', dismissedBy: 's1' }),
    ).resolves.toEqual({ ok: false })
  })
})

describe('addCustomerContactWithClient', () => {
  it('delegates straight through', async () => {
    const addContact = jest.fn(async () => ({ ok: true }))
    const synqed = { packs: { addContact } }
    const res = await addCustomerContactWithClient(synqed as never, {
      customerId: 'c1',
      channel: 'line',
      alertKind: 'pack_contact',
      note: 'called',
      contactedBy: 's1',
    })
    expect(res).toEqual({ ok: true })
    expect(addContact).toHaveBeenCalledWith({
      customer_id: 'c1',
      channel: 'line',
      alert_kind: 'pack_contact',
      note: 'called',
      contacted_by: 's1',
    })
  })

  it('GRACEFUL: a failed write returns { ok: false }, never throws', async () => {
    const synqed = {
      packs: {
        addContact: jest.fn(async () => {
          throw new Error('core down')
        }),
      },
    }
    await expect(
      addCustomerContactWithClient(synqed as never, {
        customerId: 'c1',
        channel: 'phone',
        contactedBy: 's1',
      }),
    ).resolves.toEqual({ ok: false })
  })
})
