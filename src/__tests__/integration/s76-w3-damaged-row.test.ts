/**
 * S76 commit W (W-3) — the S75 red test, landed adjusted: listOwnTakes now answers
 * `damaged` (take-store damagedKind), so the fixtures carry it (rev 2 §6).
 * Was S75 RED — W-3: a take the PHONE marked damaged (`secureError: 'audio_partial'`
 * / `'audio_unreadable'`, written by secure-take's secureBlob) with NO server job
 * still folds in 録音履歴 as a recoverable row with 保存する.
 *
 * Driven through the real inbox store mapping (inbox-store.ts readLocalTakes)
 * and the real fold (inbox.ts deriveInboxRows); mocks follow
 * recordings-inbox-store.test.ts. 保存する is read at the fold level: the card's
 * actionFor (RecordingsInboxCard.tsx) offers `action.save` exactly when
 * `row.state === 'recoverable'`, and on no other state.
 *
 * RED today: reason `tailIncomplete` (or `localAudio`), state `recoverable` →
 * 保存する offered.
 * CONTROL: the same take WITHOUT `secureError` folds as today (recoverable,
 * 保存する) → GREEN.
 */
const listRecordingsInbox = jest.fn()
jest.mock('@/actions/recordings-inbox', () => ({
  listRecordingsInbox: () => listRecordingsInbox(),
}))
const listOwnTakes = jest.fn<Promise<unknown[]>, [exclude?: unknown[]]>(async () => [])
jest.mock('@/lib/karute/take-store', () => ({
  listOwnTakes: (exclude?: unknown[]) => listOwnTakes(exclude),
  BINDING_SECURE_REFUSALS: new Set(['exists', 'reserved_elsewhere', 'not_reserved', 'superseded']),
}))
jest.mock('@/lib/global-recorder', () => ({ globalRecorder: { takeId: null } }))
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: {
    state: 'idle',
    context: null,
    error: null,
    subscribe: () => () => {},
    reset: () => {},
  },
}))

import { getInboxState, loadInbox, resetInbox } from '@/lib/recordings/inbox-store'

const NOW = Date.parse('2026-10-01T04:00:00.000Z')
const TAKE = '0b8d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'
const SESSION = 's1'

const session = {
  recordingSessionId: SESSION,
  customerId: 'cust-1',
  createdAt: new Date(NOW - 30 * 60_000).toISOString(),
  durationSeconds: null,
  karuteRecordId: null,
  jobStatus: null,
  jobProbeFailed: false,
  jobLastError: null,
  serverAudio: null,
}
const take = (over: Record<string, unknown> = {}) => ({
  takeId: TAKE,
  recordingSessionId: SESSION,
  ownerUid: 'staff-A',
  mimeType: 'audio/webm',
  startedAt: NOW - 30 * 60_000,
  updatedAt: NOW - 20 * 60_000,
  lastSeq: 3,
  tailIncomplete: true,
  ...over,
})

/** The row for our take, as the card reads it. */
async function rowFor(t: Record<string, unknown>) {
  listOwnTakes.mockResolvedValue([t])
  listRecordingsInbox.mockResolvedValue([session])
  await loadInbox()
  const rows = getInboxState().rows.filter((r) => r.recordingSessionId === SESSION)
  return rows.map((r) => ({
    reason: (r as { reason?: string }).reason,
    state: r.state,
    offersSave: r.state === 'recoverable',
  }))
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW })
  jest.clearAllMocks()
  resetInbox()
})
afterEach(() => {
  resetInbox()
  jest.useRealTimers()
})

describe('W-3 — a phone-damaged take with no server job, in 録音履歴', () => {
  it("secureError 'audio_partial' → reason audioPartial, NO 保存する", async () => {
    expect(await rowFor(take({ secureError: 'audio_partial', damaged: 'partial' }))).toEqual([
      expect.objectContaining({ reason: 'audioPartial', offersSave: false }),
    ])
  })

  it("secureError 'audio_unreadable' → reason audioUnreadable, NO 保存する", async () => {
    expect(await rowFor(take({ secureError: 'audio_unreadable', damaged: 'unreadable' }))).toEqual([
      expect.objectContaining({ reason: 'audioUnreadable', offersSave: false }),
    ])
  })

  it('CONTROL: the same take WITHOUT secureError folds as today — recoverable, 保存する', async () => {
    expect(await rowFor(take())).toEqual([{ reason: 'tailIncomplete', state: 'recoverable', offersSave: true }])
  })
})
