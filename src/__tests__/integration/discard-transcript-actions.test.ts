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
/** Consent BY CUSTOMER ID — the whole point of deriving the customer from the
 *  session row is that these two can disagree, so the fake has to be able to
 *  answer differently for two people. */
let consentByCustomer: Record<string, { policy_version: string } | null> = {}
/** The session row. `customer_id` is the record-time binding the consent gate
 *  reads; a client-named customer must never be able to steer it. */
let recordingRow: { duration_seconds: number | null; customer_id: string | null } | null = null
/** Set to make recordingDiscards.list IGNORE the session filter — a core-side
 *  regression the fake would otherwise hide from the fence. */
let listIgnoresSessionFilter = false
const upsertSeen: { id: string; options: unknown }[] = []

const fakeClient = {
  recordingDiscards: {
    list: async (q: Record<string, unknown>) => {
      const events = ledger.filter(
        (r) =>
          (!q.source || r.source === q.source) &&
          (listIgnoresSessionFilter ||
            !q.recording_session_id ||
            r.recording_session_id === q.recording_session_id),
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
    getConsent: async (id: string) => ({ consent: consentByCustomer[id] ?? null }),
  },
  orgSettings: { get: async () => ({ settings: {} }) },
}
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => fakeClient,
  getSynqedClient: async () => fakeClient,
}))

const capabilities = { current: new Set<string>(['records.write', 'staff.manage']) }
/** The IDENTITY, separately steerable from the capability set. `null` is what
 *  getCurrentUserStaffId returns for an auth blip, a rotated JWT and a failed
 *  staff-list read alike — it is not a denial, and the gate must not read it as
 *  one. */
const identity = { current: 'staff-A' as string | null }
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => identity.current),
  staffListByBusinessOrThrow: jest.fn(async () => []),
}))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return {
    ...actual,
    // Mirrors the real one: an unresolved identity yields an EMPTY set
    // (require-permission.ts:31-33), which is byte-identical to a real denial.
    // A fake that kept handing back the full set while the identity was null
    // would hide the very ambiguity D-1 is about.
    getMyCapabilities: jest.fn(async () =>
      identity.current ? capabilities.current : new Set<string>(),
    ),
    requireCapability: jest.fn(async (cap: string) => {
      if (!capabilities.current.has(cap)) throw new Error('forbidden')
    }),
  }
})
// MOCK SURFACE ONLY (PHONEWIRE-2C): the shared body now calls the
// tenant-explicit twin, because the facade door has no cookie to read a
// business id from. Same stand-in, same identity mapping — every assertion,
// fixture and expectation in this file is byte-identical to the pre-refactor
// suite, which is what makes it the equivalence proof.
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: jest.fn(async (id: string) => id),
  resolveSynqedStaffIdForBusiness: jest.fn(async (id: string) => id),
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
import { getMyCapabilities } from '@/lib/auth/require-permission'

const mockGetMyCapabilities = getMyCapabilities as jest.Mock

const SESSION = 'sess-1'
const OWN_PATH = 'app_business-1_11111111-2222-3333-4444-555555555555.webm'
const FOREIGN_PATH = 'app_business-9_11111111-2222-3333-4444-555555555555.webm'

/** `over` is deliberately loose: several cases below hand the action a
 *  `customerId` it no longer declares, to prove a client-named customer is
 *  IGNORED rather than merely unused. */
const staged = (over: Record<string, unknown> = {}) =>
  transcribeAndPersistDiscard({
    recordingSessionId: SESSION,
    audioPath: OWN_PATH,
    durationSeconds: 62,
    locale: 'ja',
    ...over,
  } as Parameters<typeof transcribeAndPersistDiscard>[0])

const review = (over: Record<string, unknown> = {}) =>
  persistDiscardTranscript({
    recordingSessionId: SESSION,
    transcript: 'すでに文字起こし済みの内容',
    durationSeconds: 62,
    ...over,
  } as Parameters<typeof persistDiscardTranscript>[0])

beforeEach(() => {
  jest.clearAllMocks()
  ledger.length = 0
  segmentSets.length = 0
  upsertSeen.length = 0
  removed.length = 0
  removeThrows = false
  listIgnoresSessionFilter = false
  // The session is bound to cust-1 at record time, and cust-1 consented.
  recordingRow = { duration_seconds: null, customer_id: 'cust-1' }
  consentByCustomer = { 'cust-1': { policy_version: RECORDING_CONSENT_POLICY_VERSION } }
  capabilities.current = new Set(['records.write', 'staff.manage'])
  identity.current = 'staff-A'
  ledger.push({ recording_session_id: SESSION, source: 'STAFF', reason: '録り直します' })
})

// ── 1. Consent, fail closed ──────────────────────────────────────────────

describe('the consent gate (⚖ 8/20 ⑤) refuses BEFORE it spends', () => {
  it('a stale consent version: skipped, and ZERO transcription calls', async () => {
    consentByCustomer = { 'cust-1': { policy_version: 'v1-2026-01' } }
    await expect(staged()).resolves.toEqual({ skipped: 'consent' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
    // The staged audio is still swept — a refusal must not leave litter.
    expect(removed).toEqual([OWN_PATH])
  })

  it('no consent row at all: skipped, and ZERO transcription calls', async () => {
    consentByCustomer = {}
    await expect(staged()).resolves.toEqual({ skipped: 'consent' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
  })

  it('a customer-less (walk-in) session: skipped without even asking core', async () => {
    recordingRow = { duration_seconds: null, customer_id: null }
    await expect(staged()).resolves.toEqual({ skipped: 'consent' })
    await expect(review()).resolves.toEqual({ skipped: 'consent' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
  })

  it('the review path is gated the same way — words in hand are still the customer’s', async () => {
    consentByCustomer = {}
    await expect(review()).resolves.toEqual({ skipped: 'consent' })
    expect(segmentSets).toEqual([])
  })

  it('a session row that cannot be READ is not a consent answer — it is a retry', async () => {
    // Fail closed means "no consent", not "we could not ask". The caller keeps
    // its take and comes back; answering `skipped` would delete the audio on a
    // blip.
    recordingRow = null
    await expect(staged()).resolves.toEqual({ error: 'failed' })
    await expect(review()).resolves.toEqual({ error: 'failed' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
  })
})

// ── 1b. The consent customer comes off the SESSION, not the caller ───────

describe('a client-named customer cannot widen consent', () => {
  it('the staged door ignores it: the SESSION’s customer is the one asked', async () => {
    // The session belongs to someone who never consented; the caller names a
    // customer who did. Nothing downstream would contradict a wrong id — it is
    // written nowhere — so this was a free lever, and it must be dead.
    recordingRow = { duration_seconds: null, customer_id: 'cust-refused' }
    consentByCustomer = {
      'cust-1': { policy_version: RECORDING_CONSENT_POLICY_VERSION },
      'cust-refused': null,
    }
    await expect(staged({ customerId: 'cust-1' })).resolves.toEqual({ skipped: 'consent' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
  })

  it('the review door ignores it too', async () => {
    recordingRow = { duration_seconds: null, customer_id: 'cust-refused' }
    consentByCustomer = {
      'cust-1': { policy_version: RECORDING_CONSENT_POLICY_VERSION },
      'cust-refused': null,
    }
    await expect(review({ customerId: 'cust-1' })).resolves.toEqual({ skipped: 'consent' })
    expect(segmentSets).toEqual([])
  })

  it('and the reverse: a wrong client id cannot BLOCK a consenting session either', async () => {
    await expect(staged({ customerId: 'cust-refused' })).resolves.toEqual({ ok: true })
    expect(segmentSets[0][0].text).toBe('こんにちは、本日はありがとうございます')
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

  it('the fence re-checks the session id in CODE, not only in the query', async () => {
    // A core that stopped honouring the session filter would hand back another
    // session's discard row, and the probe would pass for every session in a
    // business that has one reasoned discard. The fake implements the filter
    // faithfully, so only a fake that DELIBERATELY ignores it can prove the
    // re-check exists.
    listIgnoresSessionFilter = true
    ledger.length = 0
    ledger.push({ recording_session_id: 'some-other-session', source: 'STAFF', reason: '別件' })
    await expect(staged()).resolves.toEqual({ error: 'not_discarded' })
    await expect(review()).resolves.toEqual({ error: 'not_discarded' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
  })

  it('a refusal past the tenant fence still sweeps the object the client staged', async () => {
    // The client uploads BEFORE it calls, so every exit past the fence owns the
    // cleanup — otherwise a discarded recording's audio sits in the bucket and
    // the next sweep uploads another one.
    ledger.length = 0
    await expect(staged()).resolves.toEqual({ error: 'not_discarded' })
    expect(removed).toEqual([OWN_PATH])
  })

  it('a transcription that THROWS still sweeps it, and still reports the failure', async () => {
    mockRunTranscription.mockImplementationOnce(async () => {
      throw new Error('deepgram unreachable')
    })
    await expect(staged()).resolves.toEqual({ error: 'failed' })
    expect(removed).toEqual([OWN_PATH])
  })
})

// ── 3b. The capability gate on both write doors ──────────────────────────

describe('records.write is required, and a denial is TERMINAL', () => {
  it('the staged door: forbidden, never a retryable failure', async () => {
    capabilities.current = new Set(['staff.manage'])
    // `forbidden` is what the client settles the take on. Reported as `failed`,
    // a caller who can never succeed re-staged the whole audio on every
    // record-page mount until the take-store TTL pruned it.
    await expect(staged()).resolves.toEqual({ error: 'forbidden' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
    // Nothing was read, and nothing was touched in storage either.
    expect(removed).toEqual([])
  })

  it('the review door: forbidden too', async () => {
    capabilities.current = new Set(['staff.manage'])
    await expect(review()).resolves.toEqual({ error: 'forbidden' })
    expect(segmentSets).toEqual([])
  })

  it('an identity that could not be RESOLVED is a RETRY, not a denial — both doors', async () => {
    // The mirror of the consent probe's own "a row that cannot be READ is not an
    // answer". `getCurrentUserStaffId` returns null for an auth blip, a rotated
    // JWT and a failed staff-list read alike, and the empty capability set that
    // follows is indistinguishable from a real denial. Called `forbidden`, the
    // client deletes the take on the device (retryable() = `failed` only) and the
    // words behind a reasoned discard are gone forever from a salon-wifi hiccup.
    identity.current = null
    await expect(staged()).resolves.toEqual({ error: 'failed' })
    await expect(review()).resolves.toEqual({ error: 'failed' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
    // Still a pre-fence exit: nothing in storage is touched on either answer.
    expect(removed).toEqual([])
  })

  it('capability resolution that THROWS is a retry too — both doors', async () => {
    // The one identity-side failure that propagates instead of degrading:
    // createServiceClient() throwing inside capabilitiesForUser.
    mockGetMyCapabilities.mockRejectedValueOnce(new Error('service client unavailable'))
    await expect(staged()).resolves.toEqual({ error: 'failed' })
    mockGetMyCapabilities.mockRejectedValueOnce(new Error('service client unavailable'))
    await expect(review()).resolves.toEqual({ error: 'failed' })
    expect(mockRunTranscription).not.toHaveBeenCalled()
    expect(segmentSets).toEqual([])
    expect(removed).toEqual([])
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
    consentByCustomer = {}
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
    recordingRow = { duration_seconds: 62, customer_id: 'cust-1' }
    await expect(getDiscardTranscript(SESSION)).resolves.toEqual({
      ok: true,
      // `startTime` rides out with the words (⚖ 8/31): it is what places the
      // panel's 5-minute markers, and this staged take is ONE whole-recording
      // segment, so core's own 0 is the honest answer here.
      segments: [{ text: 'こんにちは、本日はありがとうございます', startTime: 0 }],
      durationSeconds: 62,
    })
  })

  // THE LAYER #798 MOCKED PAST. The component test stubs getDiscardTranscript
  // wholesale, so "under the floor" rendered from a hand-written duration and
  // nothing proved the action carries core's. Mocked at the SDK seam
  // (recordings.get), it is the real path — and the value pinned here is the
  // one the panel branches on: a sub-floor duration must arrive intact, not as
  // the null that made every discard print the generic absence instead.
  it('carries a BELOW-FLOOR duration through from recordings.get, unchanged', async () => {
    recordingRow = { duration_seconds: 9, customer_id: 'cust-1' }
    await expect(getDiscardTranscript(SESSION)).resolves.toEqual({
      ok: true,
      segments: [],
      durationSeconds: 9,
    })
  })

  it('absence is honest, never invented: no segments and no readable session → nulls, not an error', async () => {
    recordingRow = null
    await expect(getDiscardTranscript(SESSION)).resolves.toEqual({
      ok: true,
      segments: [],
      durationSeconds: null,
    })
  })

  it('a segments read that FAILED is a failure, never an empty answer', async () => {
    // The section prints one of the two absence sentences for `segments: []`.
    // Answering that for a 500 or a timeout tells the manager something about
    // the WORDS when the truth is "we could not look" — on the one screen whose
    // job is checking a staffer's claim.
    jest
      .spyOn(fakeClient.recordings, 'listSegments')
      .mockRejectedValueOnce(new Error('core unreachable'))
    await expect(getDiscardTranscript(SESSION)).resolves.toEqual({ ok: false, error: 'failed' })
  })

  it('…but core’s own 404 IS an answer: a swept session row has no words', async () => {
    jest
      .spyOn(fakeClient.recordings, 'listSegments')
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
    recordingRow = null
    await expect(getDiscardTranscript(SESSION)).resolves.toEqual({
      ok: true,
      segments: [],
      durationSeconds: null,
    })
  })
})
