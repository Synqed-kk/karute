/**
 * A2-2 / A2-4 server halves — persisting and reading the WORDS of a reasoned
 * discard (packet P5-A2, ⚖ 8/20 doctrine ⑤, ⚖ 8/25 ruling A).
 *
 * Five properties, and they are all refusals:
 *
 *   1. CONSENT, FAIL CLOSED. No current consent — or no customer at all — and
 *      NOTHING is transcribed and nothing is kept. The gate has to sit ahead of
 *      the Deepgram call, not after it, so the assertions below count
 *      transcription calls rather than only inspecting the return value: a gate
 *      that refuses AFTER spending is not the gate the doctrine asked for.
 *   2. TENANCY. `audioPath` is a client-supplied storage key and the service
 *      client that reads it has no RLS, so a foreign key must be refused before
 *      any read.
 *   3. THESE ACTIONS ARE NOT A GENERAL WRITE DOOR. Words are persisted only onto
 *      a session a staff member has already discarded WITH a written reason.
 *   4. THE READ IS MANAGER-ONLY, enforced server-side — the same `staff.manage`
 *      lock as the reason list it renders beside.
 *   5. THE WORDS LAND ONCE. `records.write` belongs to the recorder, so the
 *      staffer who discarded the take could otherwise call either action again
 *      and replace the transcript a manager checks their claim against. The
 *      assertions below read the surviving TEXT, not the segment count — an
 *      overwrite leaves exactly one segment set too.
 */
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-core-key'

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))

const RECORDING_CONSENT_POLICY_VERSION = jest.requireActual('@/lib/consent')
  .RECORDING_CONSENT_POLICY_VERSION as string

/** The core fake. Segment state is real (upsertSegments with replace:true has
 *  to actually replace) because idempotency is one of the claims. */
const ledger: { recording_session_id: string; source: string; reason: string | null }[] = []
const segmentSets: { text: string; start_time: number; end_time: number; segment_index: number }[][] =
  []
let consentRow: { policy_version: string } | null = { policy_version: '' }
let recordingRow: { duration_seconds: number | null } | null = null
const upsertSeen: { id: string; options: unknown }[] = []

const fakeClient = {
  recordingDiscards: {
    list: async (q: Record<string, unknown>) => {
      const events = ledger.filter(
        (r) =>
          (!q.source || r.source === q.source) &&
          (!q.recording_session_id || r.recording_session_id === q.recording_session_id),
      )
      return { events, total: events.length, page: 1, page_size: 200 }
    },
  },
  recordings: {
    upsertSegments: async (id: string, segments: never[], options: unknown) => {
      upsertSeen.push({ id, options })
      // replace:true = the set becomes exactly this; anything else appends.
      if ((options as { replace?: boolean })?.replace) segmentSets.length = 0
      segmentSets.push(segments)
      return { segments }
    },
    listSegments: async () => ({ segments: segmentSets.flat() }),
    get: async () => {
      if (!recordingRow) throw new Error('404')
      return recordingRow
    },
  },
  customers: {
    getConsent: async () => ({ consent: consentRow }),
  },
  orgSettings: { get: async () => ({ settings: {} }) },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  getSynqedClient: async () => fakeClient,
}))

const capabilities = { current: new Set<string>(['records.write', 'staff.manage']) }
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-A'),
  staffListByBusinessOrThrow: jest.fn(async () => []),
}))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return {
    ...actual,
    getMyCapabilities: jest.fn(async () => capabilities.current),
    requireCapability: jest.fn(async (cap: string) => {
      if (!capabilities.current.has(cap)) throw new Error('forbidden')
    }),
  }
})
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: jest.fn(async (id: string) => id),
}))

/** THE spend counter. Every consent case below asserts on this, not just on the
 *  returned value — a gate that transcribes first and refuses afterwards would
 *  pass a return-value-only test while burning the money the ⚖ gate exists to
 *  protect. */
const mockRunTranscription = jest.fn(async () => ({ transcript: 'こんにちは、本日はありがとうございます' }))
jest.mock('@/lib/ai/transcribe', () => ({
  runTranscription: (...a: unknown[]) => mockRunTranscription(...(a as [])),
  speakerIdMode: () => 'off',
  loadStaffReferenceForStaff: jest.fn(async () => null),
}))

/** `removeThrows` is the janitor failing: storage cleanup must never decide the
 *  outcome the caller reads, or a dead sweep re-runs a transcription that
 *  already landed. */
const removed: string[] = []
let removeThrows = false
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/${path}` },
          error: null,
        }),
        remove: async (paths: string[]) => {
          if (removeThrows) throw new Error('storage unreachable')
          removed.push(...paths)
          return { error: null }
        },
      }),
    },
  }),
}))

import {
  persistDiscardTranscript,
  transcribeAndPersistDiscard,
} from '@/actions/recording-discard-transcript'
import { getDiscardTranscript } from '@/actions/recording-discards'

const SESSION = 'sess-1'
const OWN_PATH = 'app_business-1_11111111-2222-3333-4444-555555555555.webm'
const FOREIGN_PATH = 'app_business-9_11111111-2222-3333-4444-555555555555.webm'

const staged = (over: Partial<Parameters<typeof transcribeAndPersistDiscard>[0]> = {}) =>
  transcribeAndPersistDiscard({
    recordingSessionId: SESSION,
    audioPath: OWN_PATH,
    customerId: 'cust-1',
    durationSeconds: 62,
    locale: 'ja',
    ...over,
  })

beforeEach(() => {
  jest.clearAllMocks()
  ledger.length = 0
  segmentSets.length = 0
  upsertSeen.length = 0
  removed.length = 0
  removeThrows = false
  recordingRow = null
  consentRow = { policy_version: RECORDING_CONSENT_POLICY_VERSION }
  capabilities.current = new Set(['records.write', 'staff.manage'])
  ledger.push({ recording_session_id: SESSION, source: 'STAFF', reason: '録り直します' })
})

// ── 1. Consent, fail closed ──────────────────────────────────────────────

describe('the consent gate (⚖ 8/20 ⑤) refuses BEFORE it spends', () => {
  it('a stale consent version: skipped, and ZERO transcription calls', async () => {
    consentRow = { policy_version: 'v1-2026-01' }
    await expect(staged()).resolves.toEqual({ skipped: 'consent' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
    // The staged audio is still swept — a refusal must not leave litter.
    expect(removed).toEqual([OWN_PATH])
  })

  it('no consent row at all: skipped, and ZERO transcription calls', async () => {
    consentRow = null
    await expect(staged()).resolves.toEqual({ skipped: 'consent' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
  })

  it('a customer-less (walk-in) take: skipped without even asking core', async () => {
    await expect(staged({ customerId: null })).resolves.toEqual({ skipped: 'consent' })
    await expect(staged({ customerId: '' })).resolves.toEqual({ skipped: 'consent' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
  })

  it('the review path is gated the same way — words in hand are still the customer’s', async () => {
    consentRow = null
    await expect(
      persistDiscardTranscript({
        recordingSessionId: SESSION,
        transcript: 'すでに文字起こし済みの内容',
        durationSeconds: 62,
        customerId: 'cust-1',
      }),
    ).resolves.toEqual({ skipped: 'consent' })
    expect(segmentSets).toEqual([])
  })
})

// ── 2. Tenancy ───────────────────────────────────────────────────────────

describe('the tenant fence on a client-supplied storage key', () => {
  it('refuses a key minted for another business, before any read', async () => {
    await expect(staged({ audioPath: FOREIGN_PATH })).resolves.toEqual({ error: 'forbidden' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(removed).toEqual([])
  })

  it('refuses anything that is not exactly a minted key shape', async () => {
    for (const bad of ['app_business-1_../other.webm', 'rec_123.webm', 'app_business-1_x.webm']) {
      await expect(staged({ audioPath: bad })).resolves.toEqual({ error: 'forbidden' })
    }
    expect(mockRunTranscription).not.toHaveBeenCalled()
  })
})

// ── 3. Only for an already-reasoned discard ──────────────────────────────

describe('words are persisted ONLY onto an already-discarded session', () => {
  it('no STAFF discard row: both actions refuse', async () => {
    ledger.length = 0
    await expect(staged()).resolves.toEqual({ error: 'not_discarded' })
    await expect(
      persistDiscardTranscript({
        recordingSessionId: SESSION,
        transcript: 'x',
        durationSeconds: 1,
        customerId: 'cust-1',
      }),
    ).resolves.toEqual({ error: 'not_discarded' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
  })

  it('a SYSTEM cleanup row is not a staff discard', async () => {
    ledger.length = 0
    ledger.push({ recording_session_id: SESSION, source: 'SYSTEM', reason: null })
    await expect(staged()).resolves.toEqual({ error: 'not_discarded' })
  })
})

// ── 4. The happy path + idempotency ──────────────────────────────────────

describe('what actually lands', () => {
  it('ONE segment carrying the whole text, and the staged audio is dropped after', async () => {
    await expect(staged()).resolves.toEqual({ ok: true })
    expect(segmentSets).toEqual([
      [
        {
          segment_index: 0,
          text: 'こんにちは、本日はありがとうございます',
          start_time: 0,
          end_time: 62,
        },
      ],
    ])
    expect(removed).toEqual([OWN_PATH])
    expect(upsertSeen).toEqual([{ id: SESSION, options: { replace: true } }])
  })

  it('silence is answered honestly — nothing is written for an empty transcript', async () => {
    mockRunTranscription.mockImplementationOnce(async () => ({ transcript: '   ' }))
    await expect(staged()).resolves.toEqual({ skipped: 'empty' })
    expect(segmentSets).toEqual([])
    expect(removed).toEqual([OWN_PATH])
  })

  it('the review path writes the words it was handed, without transcribing anything', async () => {
    await expect(
      persistDiscardTranscript({
        recordingSessionId: SESSION,
        transcript: '  すでに文字起こし済みの内容  ',
        durationSeconds: 62,
        customerId: 'cust-1',
      }),
    ).resolves.toEqual({ ok: true })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets[0][0].text).toBe('すでに文字起こし済みの内容')
  })
})

// ── 5. The words land ONCE ───────────────────────────────────────────────

const LANDED = 'こんにちは、本日はありがとうございます'

describe('a transcript that already landed is never replaced', () => {
  it('a retry of the staged persist keeps the first text, sweeps its own audio, spends nothing', async () => {
    await expect(staged()).resolves.toEqual({ ok: true })
    await expect(staged()).resolves.toEqual({ ok: true })
    expect(segmentSets).toHaveLength(1)
    expect(segmentSets[0][0].text).toBe(LANDED)
    expect(upsertSeen).toHaveLength(1)
    // The retry staged a fresh object of its own — nothing else collects it.
    expect(removed).toEqual([OWN_PATH, OWN_PATH])
    // The probe sits ahead of the transcription, so the retry costs nothing.
    expect(mockRunTranscription).toHaveBeenCalledTimes(1)
  })

  it('the review door cannot overwrite the landed words with a friendlier account', async () => {
    await staged()
    await expect(
      persistDiscardTranscript({
        recordingSessionId: SESSION,
        transcript: 'お客様は特に何もおっしゃっていませんでした',
        durationSeconds: 62,
        customerId: 'cust-1',
      }),
    ).resolves.toEqual({ ok: true })
    expect(segmentSets).toHaveLength(1)
    expect(segmentSets[0][0].text).toBe(LANDED)
    expect(upsertSeen).toHaveLength(1)
  })
})

// ── 6. The sweep never decides the outcome ───────────────────────────────

describe('a failed staged-audio sweep does not fail the persist', () => {
  it('the words landed, so the answer is ok and the caller drops its take', async () => {
    removeThrows = true
    await expect(staged()).resolves.toEqual({ ok: true })
    expect(segmentSets[0][0].text).toBe(LANDED)
  })

  it('a consent refusal stays a settled skip, never a retryable error', async () => {
    consentRow = null
    removeThrows = true
    await expect(staged()).resolves.toEqual({ skipped: 'consent' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
  })
})

// ── 7. The manager read (A2-4) ───────────────────────────────────────────

describe('getDiscardTranscript — the manager-only read', () => {
  it('refuses a caller without staff.manage', async () => {
    capabilities.current = new Set(['records.write'])
    await expect(getDiscardTranscript(SESSION)).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    })
  })

  it('returns the words a manager checks the written reason against', async () => {
    await staged()
    recordingRow = { duration_seconds: 62 }
    await expect(getDiscardTranscript(SESSION)).resolves.toEqual({
      ok: true,
      segments: [{ text: 'こんにちは、本日はありがとうございます' }],
      durationSeconds: 62,
    })
  })

  it('absence is honest, never invented: no segments and no readable session → nulls, not an error', async () => {
    await expect(getDiscardTranscript(SESSION)).resolves.toEqual({
      ok: true,
      segments: [],
      durationSeconds: null,
    })
  })
})
