// 自動録音 per-store toggle — server side (recording-integrity PR A4, spec
// §8.1 / §8.8 / §10.3). Pins, in the order the spec argues them:
//
//   NORMALIZE — `recording_autostart_store_ids` maps explicit `undefined → []`
//   (the ruled default-OFF; the same audit finding coaching_enabled carries:
//   without the mapping the A7 arm gate reads undefined forever and the toggle
//   can never take effect). Junk sanitizes TOWARD OFF, never toward recording
//   more. A real list passes through untouched.
//
//   WRITE PATH — the store id must belong to the business (a receipt-grade
//   governance row may not name a foreign store) · the new list is computed
//   SERVER-side from a fresh read, add and remove · the write carries ONLY the
//   toggle key (§8.1 discipline a — the blob has no optimistic lock, so a
//   whole-blob write would clobber a concurrent admin's unrelated key) · the
//   §10.3 audit row fires on write SUCCESS ONLY, exactly once, with exactly
//   the ruled detail · a failed write leaves NO row (a receipt for a flip that
//   did not happen is worse than none) · a LOST row rolls the flip back (the
//   row is the only record of who/when/which way — stress-audit F3).
//
//   GATE — the web door refuses without `settings.manage`, before any read.
import type { OrgSettings } from '@/actions/org-settings'

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))

// House convention (org-settings.ts's own header note): the SDK is ESM-only,
// so every jest graph reaching that module mocks the '@/lib/synqed/client'
// seam rather than importing the real client.
const getSynqedClient = jest.fn(async () => ({}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: () => getSynqedClient(),
  newSynqedClient: jest.fn(() => ({})),
}))

// The receipt is DURABLE (stress-audit F3): the seam is auditDurable, whose
// outcome the choke point acts on — so the spy resolves an outcome, and the
// failure cases below drive it.
const auditSpy = jest.fn()
jest.mock('@/lib/audit', () => ({
  ...(jest.requireActual('@/lib/audit') as object),
  auditDurable: (...a: unknown[]) => auditSpy(...a),
}))

const mockCapabilities = jest.fn(async () => new Set(['settings.manage']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, getMyCapabilities: () => mockCapabilities() }
})
jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn(async () => 'business-1') }))
jest.mock('@/lib/audit-web', () => ({ resolveWebActorId: jest.fn(async () => 'staff-1') }))

import { orgSettingsWithClient } from '@/actions/org-settings'
import { setRecordingAutostartWithClient } from '@/lib/settings/recording-autostart'

// ── fake core client ────────────────────────────────────────────────────────
type Blob = Record<string, unknown>
function fakeClient(settings: Blob, storeIds = ['store-1', 'store-2']) {
  const state = { settings }
  const upsert = jest.fn(async (payload: { settings: Blob }) => {
    state.settings = payload.settings
    return {}
  })
  return {
    state,
    upsert,
    client: {
      stores: { list: jest.fn(async () => ({ stores: storeIds.map((id) => ({ id, name: id })) })) },
      orgSettings: {
        get: jest.fn(async () => ({ business_id: 'business-1', name: 'テスト', settings: state.settings })),
        upsert,
      },
    },
  }
}
const read = (c: ReturnType<typeof fakeClient>) =>
  orgSettingsWithClient(c.client as never) as Promise<OrgSettings>

const ACTOR = { staffId: 'staff-1', businessId: 'business-1', source: 'web' as const }

beforeEach(() => {
  jest.clearAllMocks()
  // Default: the row lands. The failure cases below override it per-case.
  auditSpy.mockResolvedValue({ ok: true, rowId: 'audit-1' })
})

// ── normalize ───────────────────────────────────────────────────────────────
describe('normalizeOrgSettings — recording_autostart_store_ids (spec §8.1)', () => {
  it('absent key → [] (the ruled default-OFF, explicitly mapped)', async () => {
    const s = await read(fakeClient({}))
    expect(s.recording_autostart_store_ids).toEqual([])
  })

  it('a real list passes through', async () => {
    const s = await read(fakeClient({ recording_autostart_store_ids: ['store-1', 'store-2'] }))
    expect(s.recording_autostart_store_ids).toEqual(['store-1', 'store-2'])
  })

  it('junk sanitizes toward OFF: non-strings, empties, dupes and over-long ids drop', async () => {
    const s = await read(
      fakeClient({
        recording_autostart_store_ids: [
          'store-1',
          'store-1', // dupe
          '', // empty
          42, // not a string
          null,
          { id: 'store-9' },
          'x'.repeat(201), // over the length cap
          'store-2',
        ],
      }),
    )
    expect(s.recording_autostart_store_ids).toEqual(['store-1', 'store-2'])
  })

  it('a non-array value reads as OFF, never as truthy', async () => {
    const s = await read(fakeClient({ recording_autostart_store_ids: 'store-1' }))
    expect(s.recording_autostart_store_ids).toEqual([])
  })

  it('the entry cap bounds a corrupted blob', async () => {
    const s = await read(
      fakeClient({ recording_autostart_store_ids: Array.from({ length: 500 }, (_, i) => `s-${i}`) }),
    )
    expect(s.recording_autostart_store_ids!.length).toBeLessThanOrEqual(200)
  })
})

// ── the write path ──────────────────────────────────────────────────────────
describe('setRecordingAutostartWithClient — the one audited settings write', () => {
  it('refuses a store id this business does not own — no write, no row', async () => {
    const c = fakeClient({})
    const r = await setRecordingAutostartWithClient(c.client as never, ACTOR, 'store-OTHER', true)
    expect(r).toEqual({ ok: false, error: 'unknown_store' })
    expect(c.upsert).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('refuses an unattributable caller before reading anything', async () => {
    const c = fakeClient({})
    const r = await setRecordingAutostartWithClient(
      c.client as never,
      { ...ACTOR, staffId: null },
      'store-1',
      true,
    )
    expect(r).toEqual({ ok: false, error: 'forbidden' })
    expect(c.client.stores.list).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('ON: adds the store to the list computed from a FRESH server-side read', async () => {
    const c = fakeClient({ recording_autostart_store_ids: ['store-2'] })
    const r = await setRecordingAutostartWithClient(c.client as never, ACTOR, 'store-1', true)
    expect(r).toEqual({ ok: true, storeIds: ['store-2', 'store-1'] })
    expect(c.state.settings.recording_autostart_store_ids).toEqual(['store-2', 'store-1'])
  })

  it('ON twice is idempotent — no duplicate id', async () => {
    const c = fakeClient({ recording_autostart_store_ids: ['store-1'] })
    const r = await setRecordingAutostartWithClient(c.client as never, ACTOR, 'store-1', true)
    expect(r).toEqual({ ok: true, storeIds: ['store-1'] })
  })

  it('OFF: removes only that store, leaving the others enabled', async () => {
    const c = fakeClient({ recording_autostart_store_ids: ['store-1', 'store-2'] })
    const r = await setRecordingAutostartWithClient(c.client as never, ACTOR, 'store-1', false)
    expect(r).toEqual({ ok: true, storeIds: ['store-2'] })
  })

  it('writes ONLY the toggle key — every other blob key survives untouched', async () => {
    // The blob writer is a read-modify-write with a shallow spread and NO
    // optimistic lock: sending anything beyond the one key would carry this
    // browser's stale copy of it over a concurrent admin's edit (Greptile #383).
    const c = fakeClient({ salon_name: 'テスト', auto_stop_minutes: 45, coaching_enabled: true })
    await setRecordingAutostartWithClient(c.client as never, ACTOR, 'store-1', true)

    const written = c.upsert.mock.calls[0][0].settings as Blob
    expect(written.auto_stop_minutes).toBe(45)
    expect(written.coaching_enabled).toBe(true)
    // Exactly ONE key differs from what was there before.
    const before = { salon_name: 'テスト', auto_stop_minutes: 45, coaching_enabled: true } as Blob
    const changed = Object.keys(written).filter(
      (k) => JSON.stringify(written[k]) !== JSON.stringify(before[k]),
    )
    expect(changed).toEqual(['recording_autostart_store_ids'])
  })

  it('emits exactly ONE §10.3 row on success, with exactly the ruled detail', async () => {
    const c = fakeClient({})
    await setRecordingAutostartWithClient(
      c.client as never,
      { ...ACTOR, requestId: 'req-1' },
      'store-1',
      true,
    )
    expect(auditSpy).toHaveBeenCalledTimes(1)
    const [e] = auditSpy.mock.calls[0]
    expect(e).toMatchObject({
      category: 'settings',
      action: 'settings.recording_autostart_toggle',
      actorId: 'staff-1',
      actorType: 'staff',
      businessId: 'business-1',
      targetType: 'store',
      targetId: 'store-1',
      requestId: 'req-1',
      source: 'web',
    })
    // §10.3 exactly — and §10.4: ids and flags only, no store NAME, no prose.
    expect(e.detail).toEqual({ store_id: 'store-1', enabled: true, actor_staff_id: 'staff-1' })
  })

  it('the OFF flip is audited too — enabled: false, not a silent removal', async () => {
    const c = fakeClient({ recording_autostart_store_ids: ['store-1'] })
    await setRecordingAutostartWithClient(c.client as never, ACTOR, 'store-1', false)
    expect(auditSpy.mock.calls[0][0].detail.enabled).toBe(false)
  })

  it('a FAILED write leaves no row — no receipt for a flip that did not happen', async () => {
    const c = fakeClient({})
    c.client.orgSettings.upsert.mockRejectedValueOnce(new Error('core down'))
    const r = await setRecordingAutostartWithClient(c.client as never, ACTOR, 'store-1', true)
    expect(r).toEqual({ ok: false, error: 'failed' })
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('a LOST receipt rolls the flip back and refuses — state never outlives its only attribution', async () => {
    // The blob stores the id list and nothing else: no actor, no direction.
    // If the row does not land, nothing records who flipped this — so the
    // setting must not stand (stress-audit F3).
    const c = fakeClient({ recording_autostart_store_ids: ['store-2'] })
    auditSpy.mockResolvedValueOnce({ ok: false, rowId: undefined })

    const r = await setRecordingAutostartWithClient(c.client as never, ACTOR, 'store-1', true)

    expect(r).toEqual({ ok: false, error: 'receipt_write_failed' })
    // The compensating write carries the PRIOR list — and only the one key.
    const compensating = c.upsert.mock.calls[1][0].settings as Blob
    expect(compensating.recording_autostart_store_ids).toEqual(['store-2'])
    expect(c.state.settings.recording_autostart_store_ids).toEqual(['store-2'])
  })

  it('receipt lost AND rollback lost → uncertain, never a silent success', async () => {
    const c = fakeClient({ recording_autostart_store_ids: ['store-2'] })
    auditSpy.mockResolvedValueOnce({ ok: false, rowId: undefined })
    c.upsert
      .mockImplementationOnce(async (p: { settings: Blob }) => {
        c.state.settings = p.settings
        return {}
      })
      .mockRejectedValueOnce(new Error('core down'))

    const r = await setRecordingAutostartWithClient(c.client as never, ACTOR, 'store-1', true)

    expect(r).toEqual({ ok: false, error: 'receipt_write_failed_setting_uncertain' })
  })

  it('a failed READ leaves no row and no write', async () => {
    const c = fakeClient({})
    c.client.orgSettings.get.mockRejectedValueOnce(new Error('core down'))
    const r = await setRecordingAutostartWithClient(c.client as never, ACTOR, 'store-1', true)
    expect(r).toEqual({ ok: false, error: 'failed' })
    expect(c.upsert).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })
})

// ── the web door's gate ─────────────────────────────────────────────────────
describe('setRecordingAutostart (web action) — settings.manage gate', () => {
  it('refuses without settings.manage, before any client is resolved', async () => {
    mockCapabilities.mockResolvedValueOnce(new Set(['customers.view']))
    const { setRecordingAutostart } = await import('@/actions/recording-autostart')
    await expect(setRecordingAutostart('store-1', true)).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(auditSpy).not.toHaveBeenCalled()
  })
})
