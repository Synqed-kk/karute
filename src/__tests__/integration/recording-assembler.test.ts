/**
 * THE ASSEMBLER (src/lib/recording/assembler.ts) — the take whose device never
 * came back. What only this file can prove:
 *   1. the PREFIX rule: bytes are the contiguous run from seq 0 and nothing
 *      after a gap, concatenated in seq order;
 *   2. the AGE gate: a take younger than 48 h is left for its own device;
 *   3. the two idempotent halves — an object already at the key is adopted
 *      ONLY when it weighs exactly what the prefix weighs, and a device that
 *      beat us to its own key is skipped in silence;
 *   4. the ONE audit row, with the exact detail keys design D5 names, and NO
 *      row on any path that wrote nothing;
 *   5. every folder is opened with ITS OWN tenant's core client;
 *   6. ⚖ nothing is ever deleted.
 *
 * NO NETWORK: storage is an in-memory bucket behind the same
 * createServiceClient seam finalize-take's own suite doubles, and core is a
 * per-business fake.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const auditFn = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditFn(e) }))
// The SDK is ESM-only and jest cannot load it unmocked — the same stand-in
// every suite in this family uses. Nothing here ever builds a real client:
// runAssembler takes its core clients from deps.
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))

type Entry = {
  name: string
  id: string | null
  created_at: string | null
  metadata: { size?: number } | null
}
type ListAnswer = { data: Entry[] | null; error: { message: string } | null }

/** prefix -> everything under it, in name order. The fake serves it by
 *  OFFSET, exactly as storage does, so a `limit: 1` peek and a paged walk of
 *  the same prefix can both be modelled without a call-order trick. */
const contents = new Map<string, Entry[]>()
/** Prefixes whose CONTINUATION page fails — i.e. the walk was cut part-way
 *  through, which is the only listing failure that matters (the first page
 *  failing just answers nothing at all). */
const cutListings = new Set<string>()
/** Every list call, so a test can say what a folder COST as well as what it
 *  answered. */
const listCalls: { prefix: string; limit?: number; offset?: number }[] = []
const bodies = new Map<string, Buffer>()
const infos = new Map<string, { size?: number } | null>()
const uploads: { key: string; body: Buffer; opts: { contentType?: string; upsert?: boolean } }[] = []
let uploadAnswer: { error: unknown } = { error: null }
const storageRemove = jest.fn(async () => ({ data: [], error: null }))
const emptyBucket = jest.fn(async () => ({ data: null, error: null }))

const NOT_FOUND = { message: 'Object not found', status: 404, statusCode: '404' }

const list = jest.fn(
  async (prefix: string, opts: { limit?: number; offset?: number }): Promise<ListAnswer> => {
    listCalls.push({ prefix, limit: opts?.limit, offset: opts?.offset })
    const offset = opts?.offset ?? 0
    if (cutListings.has(prefix) && offset > 0) return { data: null, error: { message: 'boom' } }
    const all = contents.get(prefix) ?? []
    return { data: all.slice(offset, offset + (opts?.limit ?? 100)), error: null }
  },
)
const download = jest.fn(async (key: string) => {
  const body = bodies.get(key)
  if (!body) return { data: null, error: NOT_FOUND }
  return { data: new Blob([new Uint8Array(body)]), error: null }
})
type InfoAnswer = {
  data: { size?: number } | null | undefined
  error: { message: string; status?: number; statusCode?: string } | null
}
const info = jest.fn(async (key: string): Promise<InfoAnswer> => {
  if (!infos.has(key)) return { data: null, error: NOT_FOUND }
  return { data: infos.get(key), error: null }
})
const upload = jest.fn(
  async (key: string, body: Buffer, opts: { contentType?: string; upsert?: boolean }) => {
    if (uploadAnswer.error) return { data: null, error: uploadAnswer.error }
    uploads.push({ key, body, opts })
    infos.set(key, { size: body.byteLength })
    return { data: { id: 'x', path: key, fullPath: `recordings/${key}` }, error: null }
  },
)
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: (_bucket: string) => ({ list, download, info, upload, remove: storageRemove }),
      emptyBucket,
    },
  }),
}))

import {
  ASSEMBLE_AFTER_MS,
  MAX_TAKES_PER_RUN,
  SEGMENT_NOMINAL_MS,
  longestPrefix,
  runAssembler,
  type AssemblerDeps,
} from '@/lib/recording/assembler'

const BIZ = 'biz-1'
const BIZ2 = 'biz-2'
const TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const TAKE2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SESSION = '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b'
const SESSION2 = '9d2e1b3c-5f4a-4e67-8b9c-0d1e2f3a4b5c'

const NOW = Date.parse('2026-09-06T18:07:00.000Z')
const OLD = new Date(NOW - ASSEMBLE_AFTER_MS - 60 * 60 * 1000).toISOString()

type Row = {
  id: string
  business_id: string
  audio_storage_path: string | null
  duration_seconds: number | null
  status: string
  /** A born-reserved row carries no store (session-mint.ts sends none), so
   *  null is the production shape — set it only where a test is about the
   *  audit row's store leg. */
  store_id: string | null
}
const rowsByBusiness = new Map<string, Row[]>()
/** Every time anything reached for a core WRITE method. Must stay empty. */
const coreWrites: string[] = []
const listedBy: string[] = []
/** The options the assembler asked core for — the row query's whole class
 *  definition lives in them, so they are pinned rather than assumed. */
const listOpts: unknown[] = []
let listThrows = false
/** Rows per PAGE, when a test is about paging. Default: everything on page 1. */
let rowPageSize = 0

// ⚖ READ-ONLY BY CONSTRUCTION. Core fences recording writes behind a human
// actor and this job has none, so the fake offers `list` and NOTHING else:
// `update` is a getter that throws, which fails on the mere REFERENCE — a
// call, a spread, even a `typeof` probe. A regression that brings the stamp
// back cannot pass this file by accident.
const coreFor = jest.fn((businessId: string) => ({
  recordings: {
    list: async (opts: { status?: string; page?: number }) => {
      listedBy.push(businessId)
      listOpts.push(opts)
      if (listThrows) throw new Error('core down')
      // Core filters by status server-side; the fake does too, so a test can
      // put a PROCESSING row behind the same pointer and see it not come back.
      const all = (rowsByBusiness.get(businessId) ?? []).filter(
        (r) => !opts?.status || r.status === opts.status,
      )
      if (rowPageSize === 0) return { recordings: all, total: all.length, page: 1, page_size: 200 }
      const page = opts?.page ?? 1
      return {
        recordings: all.slice((page - 1) * rowPageSize, page * rowPageSize),
        total: all.length,
        page,
        page_size: rowPageSize,
      }
    },
    get update() {
      coreWrites.push(businessId)
      throw new Error('the assembler must never write to core')
    },
  },
})) as unknown as AssemblerDeps['coreFor']

const deps = (): AssemblerDeps => ({ coreFor, now: () => NOW })

/** A take folder + its leaves, wired into the fake bucket. */
function seed(opts: {
  businessId?: string
  takeId?: string
  seqs: number[]
  ext?: string
  sizes?: number[]
  createdAt?: string
  /** Per-leaf timestamps, when the test is about WHICH leaf decides the age. */
  createdAts?: string[]
  rowId?: string
  rowPointer?: string | null
  duration?: number | null
  storeId?: string | null
  objectSize?: number | null
  status?: string
}) {
  const businessId = opts.businessId ?? BIZ
  const takeId = opts.takeId ?? TAKE
  const ext = opts.ext ?? 'webm'
  const folder = `app_${businessId}_${takeId}`
  const leaves: Entry[] = opts.seqs.map((seq, i) => {
    const size = opts.sizes?.[i] ?? 10 + seq
    const name = `${String(seq).padStart(6, '0')}.${ext}`
    bodies.set(`seg/${folder}/${name}`, Buffer.alloc(size, seq + 1))
    return {
      name,
      id: `obj-${folder}-${seq}`,
      created_at: opts.createdAts?.[i] ?? opts.createdAt ?? OLD,
      metadata: { size },
    }
  })
  addFolder(folder)
  contents.set(`seg/${folder}`, leaves)
  const key = `app_${businessId}_${takeId}.${ext}`
  if (opts.objectSize != null) infos.set(key, { size: opts.objectSize })
  const pointer = opts.rowPointer === undefined ? key : opts.rowPointer
  const rowId = opts.rowId ?? (opts.takeId === TAKE2 ? SESSION2 : SESSION)
  if (pointer !== null) {
    const rows = rowsByBusiness.get(businessId) ?? []
    rows.push({
      id: rowId,
      business_id: businessId,
      audio_storage_path: pointer,
      duration_seconds: opts.duration ?? null,
      status: opts.status ?? 'UPLOADING',
      store_id: opts.storeId ?? null,
    })
    rowsByBusiness.set(businessId, rows)
  }
  return { folder, key, leaves, rowId }
}

const rootFolders: Entry[] = []
function addFolder(name: string) {
  rootFolders.push({ name, id: null, created_at: null, metadata: null })
  contents.set('seg', [...rootFolders])
}

beforeEach(() => {
  jest.clearAllMocks()
  contents.clear()
  cutListings.clear()
  listCalls.length = 0
  bodies.clear()
  infos.clear()
  uploads.length = 0
  rootFolders.length = 0
  rowsByBusiness.clear()
  coreWrites.length = 0
  listedBy.length = 0
  listOpts.length = 0
  rowPageSize = 0
  uploadAnswer = { error: null }
  listThrows = false
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

// ⚖ THE TWO INVARIANTS of this whole job, asserted after every case rather
// than in the one test that happens to be about each: it only ever ADDS, and
// it only ever adds TO STORAGE. The duration is written by the save door,
// which has the actor core requires; this job never touches a core row.
afterEach(() => {
  expect(storageRemove).not.toHaveBeenCalled()
  expect(emptyBucket).not.toHaveBeenCalled()
  expect(coreWrites).toEqual([])
})

describe('longestPrefix — the contiguous run from zero, and the first hole', () => {
  it.each([
    // Nothing at all is not a HOLE — there is no take here to have one.
    ['empty', [], [], null],
    ['just zero', [0], [0], null],
    ['contiguous', [0, 1, 2], [0, 1, 2], null],
    ['a gap at 2', [0, 1, 3, 4], [0, 1], 2],
    ['no zero at all', [1, 2], [], 0],
    ['unsorted input', [2, 0, 1], [0, 1, 2], null],
    ['unsorted with a gap', [4, 1, 0], [0, 1], 2],
  ])('%s', (_label, seqs, prefix, firstGap) => {
    expect(longestPrefix(seqs as number[])).toEqual({ prefix, firstGap })
  })
})

describe('the walk', () => {
  it('opens each tenant’s folder with ITS OWN business client', async () => {
    seed({ businessId: BIZ, takeId: TAKE, seqs: [0, 1] })
    seed({ businessId: BIZ2, takeId: TAKE2, seqs: [0] })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.candidates).toBe(2)
    expect(summary.assembled).toBe(2)
    expect(coreFor).toHaveBeenCalledWith(BIZ)
    expect(coreFor).toHaveBeenCalledWith(BIZ2)
    // Every core read went to the client of the folder's OWN tenant — a single
    // shared client would have listed biz-1 twice and biz-2 never.
    expect(listedBy.sort()).toEqual([BIZ, BIZ2])
    // …and each rescue is audited under the tenant whose folder it came out of.
    expect(auditFn.mock.calls.map((c) => c[0].businessId).sort()).toEqual([BIZ, BIZ2])
  })

  it('skips a junk folder in silence and still does the real one', async () => {
    rootFolders.push({ name: 'not-a-take', id: null, created_at: null, metadata: null })
    seed({ seqs: [0] })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.candidates).toBe(1)
    expect(summary.assembled).toBe(1)
  })

  it('a failed listing page reports walkComplete false — and the folders already walked are still processed', async () => {
    seed({ seqs: [0] })
    // Page 1 came back with the folder; the CONTINUATION page fails, so the
    // rest of the tree was never seen. What WAS listed is still real work.
    cutListings.add('seg')
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.walkComplete).toBe(false)
    expect(summary.assembled).toBe(1)
  })

  // ⚖ THE GUARD BETWEEN A TRUNCATED LISTING AND A WRONG OBJECT. A half-listed
  // folder rebuilt from would seal a SHORT object under the take's immutable
  // key — and the next night meets it, skips, and nothing can ever replace it.
  it('a folder whose own listing was cut is an error, never a rebuild from half a folder', async () => {
    const { folder } = seed({ seqs: [0, 1, 2] })
    cutListings.add(`seg/${folder}`)
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.error).toBe(1)
    expect(uploads).toHaveLength(0)
    expect(auditFn).not.toHaveBeenCalled()
  })

  // ⚖ R1: most folders in seg/ belong to takes that finished long ago, and
  // they must not cost a full listing every night — that is what let the clock
  // cut the walk in the same place forever.
  it('a finished take costs ONE one-leaf listing and ONE probe — no full listing, no core call', async () => {
    const { folder } = seed({ seqs: [0, 1, 2], objectSize: 33 })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.objectExists).toBe(1)
    const folderCalls = listCalls.filter((c) => c.prefix === `seg/${folder}`)
    expect(folderCalls).toEqual([{ prefix: `seg/${folder}`, limit: 1, offset: 0 }])
    expect(listedBy).toEqual([])
    expect(uploads).toHaveLength(0)
  })

  // ⚖ R1(b) THE ROTATION. Nothing carries a cursor between runs, so a walk
  // that always began at index 0 would stop in the same place every night and
  // never reach the tail — silently, because the route still answers 200.
  it('a night cut by the clock starts somewhere else the next night, and wraps', async () => {
    const takes = ['0f8c6c9a-3f2d-4a71-9b5e-000000000001', '0f8c6c9a-3f2d-4a71-9b5e-000000000002', '0f8c6c9a-3f2d-4a71-9b5e-000000000003']
    takes.forEach((takeId, i) => seed({ takeId, seqs: [0], objectSize: 10, rowId: `${SESSION.slice(0, 23)}${i}${SESSION.slice(24)}` }))
    // Day N and day N+1 land on different indexes of the same three folders…
    const dayOf = (now: number) => Math.floor(now / 86_400_000) % 3
    const first: string[] = []
    for (const now of [NOW, NOW + 86_400_000, NOW + 2 * 86_400_000]) {
      listCalls.length = 0
      await runAssembler({ coreFor, now: () => now }, { budgetMs: 60_000 })
      first.push(listCalls.find((c) => c.prefix !== 'seg')!.prefix)
      expect(listCalls.find((c) => c.prefix !== 'seg')!.prefix).toBe(
        `seg/app_${BIZ}_${takes[dayOf(now)]}`,
      )
    }
    // …and over three days every folder has been reached first once: the wrap
    // is what makes "a bucket too large for one night" cover in several.
    expect(new Set(first).size).toBe(3)
  })

  it('the rotation WRAPS rather than running off the end', async () => {
    seed({ takeId: '0f8c6c9a-3f2d-4a71-9b5e-00000000000a', seqs: [0] })
    seed({ takeId: '0f8c6c9a-3f2d-4a71-9b5e-00000000000b', seqs: [0], rowId: SESSION2 })
    // Whatever day it is, both folders are visited exactly once.
    for (const now of [NOW, NOW + 86_400_000]) {
      listCalls.length = 0
      const summary = await runAssembler({ coreFor, now: () => now }, { budgetMs: 60_000 })
      expect(summary.candidates).toBe(2)
      expect(new Set(listCalls.filter((c) => c.prefix !== 'seg').map((c) => c.prefix)).size).toBe(2)
    }
  })
})

describe('the age gate — the newest segment is the last sign of the device', () => {
  it('47 h old is YOUNG: the device may still come back for it', async () => {
    seed({ seqs: [0], createdAt: new Date(NOW - 47 * 60 * 60 * 1000).toISOString() })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.young).toBe(1)
    expect(uploads).toHaveLength(0)
  })

  it('49 h old is a candidate', async () => {
    seed({ seqs: [0], createdAt: new Date(NOW - 49 * 60 * 60 * 1000).toISOString() })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.assembled).toBe(1)
  })

  // ⚖ THE RULE, and the one the fixtures used to hide by stamping every leaf
  // with the same timestamp: it is the LAST slice that says when the device
  // was last heard from. Reading the first would seal a take that was still
  // recording minutes ago — the self-inflicted strand D1 exists to avoid.
  it('an old FIRST segment does not age a take whose LAST segment is minutes old', async () => {
    seed({
      seqs: [0, 1],
      createdAts: [
        new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(NOW - 60 * 60 * 1000).toISOString(),
      ],
    })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.young).toBe(1)
    expect(uploads).toHaveLength(0)
  })

  it.each([
    ['one second younger than the threshold', 1000, 'young'],
    ['one second older', -1000, 'candidate'],
  ])('%s', async (_label, offset, verdict) => {
    seed({ seqs: [0], createdAt: new Date(NOW - ASSEMBLE_AFTER_MS + offset).toISOString() })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    if (verdict === 'young') {
      expect(summary.skipped.young).toBe(1)
      expect(uploads).toHaveLength(0)
    } else {
      expect(summary.assembled).toBe(1)
    }
  })

  it('an unparseable created_at reads as YOUNG, never as "old enough"', async () => {
    seed({ seqs: [0], createdAt: 'not-a-date' })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.young).toBe(1)
    expect(uploads).toHaveLength(0)
  })
})

describe('the object probe', () => {
  it('a storage that will not answer is an ERROR — never "the key is free"', async () => {
    const { key } = seed({ seqs: [0] })
    info.mockImplementationOnce(async (k: string) => {
      if (k === key) return { data: null, error: { message: 'gateway', status: 500 } }
      return { data: null, error: NOT_FOUND }
    })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.error).toBe(1)
    expect(uploads).toHaveLength(0)
    expect(auditFn).not.toHaveBeenCalled()
  })

  // ⚖ the amendment's disjoint meaning: the audio is already on the server —
  // rescued on an earlier night, or finalized by the device itself. This is
  // ALSO what makes the job idempotent: exactly one audit row per rescued
  // take, because the second night meets the object and stops here.
  it('object already at the key → skipped.objectExists, no upload, no audit, and core is never even read', async () => {
    seed({ seqs: [0, 1], objectSize: 21 })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.objectExists).toBe(1)
    expect(summary.assembled).toBe(0)
    expect(uploads).toHaveLength(0)
    expect(auditFn).not.toHaveBeenCalled()
    // Answered before the core read: a healthy tenant's finished takes cost
    // one storage probe a night, not a core page.
    expect(listedBy).toEqual([])
  })

  it('a row somebody already settled is left alone', async () => {
    seed({ seqs: [0, 1], duration: 300 })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.settled).toBe(1)
    expect(uploads).toHaveLength(0)
    expect(auditFn).not.toHaveBeenCalled()
  })
})

describe('the assembly', () => {
  it('a contiguous take: the object is the concat in SEQ ORDER, upsert false, one audit row', async () => {
    const { key } = seed({ seqs: [0, 1, 2, 3, 4], sizes: [1, 2, 3, 4, 5] })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.assembled).toBe(1)
    expect(summary.partial).toBe(1)
    expect(uploads).toHaveLength(1)
    expect(uploads[0].key).toBe(key)
    expect(uploads[0].opts).toEqual({ contentType: 'audio/webm', upsert: false })
    // Byte for byte, in seq order: each leaf is filled with (seq + 1).
    expect(uploads[0].body).toEqual(
      Buffer.concat([0, 1, 2, 3, 4].map((seq) => Buffer.alloc(seq + 1, seq + 1))),
    )
    expect(auditFn).toHaveBeenCalledTimes(1)
    expect(auditFn.mock.calls[0][0]).toEqual({
      category: 'recording',
      action: 'recording.capture_resumed',
      actorId: null,
      actorType: 'system',
      businessId: BIZ,
      targetType: 'recording',
      targetId: SESSION,
      severity: 'notice',
      source: 'system',
      detail: {
        recording_session_id: SESSION,
        take_id: TAKE,
        ext: 'webm',
        segments_present: 5,
        prefix_length: 5,
        first_gap_seq: null,
        declared_last_seq: null,
        partial: true,
        bytes: 15,
        estimated_duration_seconds: 25,
        trigger: 'cron',
      },
    })
  })

  it('a gap: only the prefix is written, and the row SAYS where the hole is', async () => {
    seed({ seqs: [0, 1, 3], sizes: [4, 6, 100] })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.assembled).toBe(1)
    expect(uploads[0].body.byteLength).toBe(10)
    expect(auditFn.mock.calls[0][0].detail).toMatchObject({
      segments_present: 3,
      prefix_length: 2,
      first_gap_seq: 2,
      partial: true,
      bytes: 10,
      estimated_duration_seconds: 10,
    })
  })

  it('a leaf that will not come down is an error — never a short object under the take’s key', async () => {
    const { folder } = seed({ seqs: [0, 1, 2] })
    bodies.delete(`seg/${folder}/000001.webm`)
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.error).toBe(1)
    expect(uploads).toHaveLength(0)
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('a folder with no seq 0 is not a take we can rebuild', async () => {
    seed({ seqs: [1, 2] })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.noSeq0).toBe(1)
    expect(uploads).toHaveLength(0)
  })

  it.each([
    ['a plain 409', { status: 409, message: 'Duplicate' }],
    ['a 400 with the code in the body', { status: 400, statusCode: '409', message: 'Duplicate' }],
    ['the message alone', { message: 'The resource already exists' }],
  ])('the device beat us to its own key (%s) → nothing written, nothing audited', async (_l, error) => {
    seed({ seqs: [0, 1] })
    uploadAnswer = { error }
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.deviceReturned).toBe(1)
    expect(summary.assembled).toBe(0)
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('any other upload failure is an error — one warn line carrying NO key and NO storage message', async () => {
    seed({ seqs: [0] })
    uploadAnswer = { error: { status: 500, statusCode: '500', message: `Route PUT:/object/recordings/app_${BIZ}_${TAKE}.webm failed` } }
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.error).toBe(1)
    expect(auditFn).not.toHaveBeenCalled()
    const warned = (console.warn as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n')
    expect(warned).toContain('assembler_error')
    expect(warned).not.toContain('.webm')
    expect(warned).not.toContain('Route PUT')
  })

  // ⚖ the amendment. Core fences PUT /v1/recordings/:id behind a human actor
  // and a cron has none, so this job settles the take on STORAGE and files the
  // row — the duration is the save door's, with the staffer's own bearer.
  it('never writes to core: the audio lands, the row is filed, and no core write is even reached for', async () => {
    seed({ seqs: [0, 1] })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.assembled).toBe(1)
    expect(uploads).toHaveLength(1)
    expect(auditFn).toHaveBeenCalledTimes(1)
    // The fake's `update` throws on the mere reference (see its getter), so an
    // empty list here is the proof — and the afterEach asserts it every case.
    expect(coreWrites).toEqual([])
    // …and the row it audits is the one it read, never one it wrote.
    expect(auditFn.mock.calls[0][0].detail.recording_session_id).toBe(SESSION)
  })
})

describe('the row', () => {
  it('no row in the window → noRow, and nothing is invented', async () => {
    seed({ seqs: [0], rowPointer: null })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.noRow).toBe(1)
    expect(uploads).toHaveLength(0)
    expect(auditFn).not.toHaveBeenCalled()
  })

  it('a row pointing at a DIFFERENT take is not this take’s row', async () => {
    seed({ seqs: [0], rowPointer: `app_${BIZ}_${TAKE2}.webm` })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.noRow).toBe(1)
    expect(uploads).toHaveLength(0)
  })

  it('a core that will not answer is an error, never an assembly', async () => {
    seed({ seqs: [0] })
    listThrows = true
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.error).toBe(1)
    expect(uploads).toHaveLength(0)
  })

  it('leaves that disagree about the container are never guessed at', async () => {
    const folder = `app_${BIZ}_${TAKE}`
    addFolder(folder)
    contents.set(`seg/${folder}`, [
      { name: '000000.webm', id: 'a', created_at: OLD, metadata: { size: 4 } },
      { name: '000001.mp4', id: 'b', created_at: OLD, metadata: { size: 4 } },
    ])
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.extMismatch).toBe(1)
    expect(uploads).toHaveLength(0)
  })
})

describe('the row query is the class', () => {
  // ⚖ D1's predicate lives in these options, and nothing pinned them: the fake
  // used to hand back every seeded row whatever was asked, so dropping the
  // status leg, the window or core's page cap all survived untouched.
  it('asks core for exactly the class: UPLOADING, the ±6 h window around the OLDEST leaf, core’s max page', async () => {
    seed({ seqs: [0, 1] })
    await runAssembler(deps(), { budgetMs: 60_000 })
    expect(listOpts[0]).toEqual({
      status: 'UPLOADING',
      from: new Date(Date.parse(OLD) - 6 * 60 * 60 * 1000).toISOString(),
      to: new Date(Date.parse(OLD) + 6 * 60 * 60 * 1000).toISOString(),
      page: 1,
      page_size: 200,
    })
  })

  it('a row on the SECOND page is still found — the take is not silently skipped', async () => {
    // A busy tenant can have more than one page of UPLOADING rows in a 12-hour
    // window; a paging break would read as noRow, silently, every night.
    seed({ seqs: [0, 1] })
    for (let i = 0; i < 3; i++) {
      rowsByBusiness.get(BIZ)!.unshift({
        id: `${SESSION2.slice(0, 23)}${i}${SESSION2.slice(24)}`,
        business_id: BIZ,
        audio_storage_path: `app_${BIZ}_0f8c6c9a-3f2d-4a71-9b5e-00000000000${i}.webm`,
        duration_seconds: null,
        status: 'UPLOADING',
        store_id: null,
      })
    }
    rowPageSize = 2
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.assembled).toBe(1)
    expect(listOpts.length).toBeGreaterThan(1)
  })

  it('a row the query would never return (its status moved on) is not this take’s row', async () => {
    seed({ seqs: [0, 1], status: 'PROCESSING' })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.noRow).toBe(1)
    expect(uploads).toHaveLength(0)
  })
})

describe('the audit row’s store', () => {
  // The 監査ログ viewer FILTERS by store — a row keyed on an empty one is
  // invisible to every store-scoped search (playback-url.ts's own fix round).
  it('carries the row’s store when it has one', async () => {
    seed({ seqs: [0], storeId: 'store-a' })
    await runAssembler(deps(), { budgetMs: 60_000 })
    expect(auditFn.mock.calls[0][0].storeId).toBe('store-a')
  })

  it('is absent when the row has none — the shape every row carries today', async () => {
    seed({ seqs: [0] })
    await runAssembler(deps(), { budgetMs: 60_000 })
    expect(auditFn.mock.calls[0][0].storeId).toBeUndefined()
  })
})

describe('the bounds', () => {
  it('no budget at all: the candidates are still counted, and nothing is touched', async () => {
    seed({ seqs: [0] })
    const summary = await runAssembler(deps(), { budgetMs: 0 })
    expect(summary.budgetExhausted).toBe(true)
    expect(summary.candidates).toBe(1)
    expect(summary.assembled).toBe(0)
    expect(uploads).toHaveLength(0)
    // A budget stop is not a blind run: the walk SAW every folder.
    expect(summary.walkComplete).toBe(true)
  })

  it(`stops at MAX_TAKES_PER_RUN (${MAX_TAKES_PER_RUN}) and says tomorrow continues`, async () => {
    for (let i = 0; i <= MAX_TAKES_PER_RUN; i++) {
      const takeId = `0f8c6c9a-3f2d-4a71-9b5e-${String(i).padStart(12, '0')}`
      seed({ takeId, seqs: [0] })
      // Each take needs its own row id, or the fake's rows collide.
      const rows = rowsByBusiness.get(BIZ)!
      rows[rows.length - 1].id = `${SESSION.slice(0, 24)}${String(i).padStart(12, '0')}`
    }
    const summary = await runAssembler(deps(), { budgetMs: 600_000 })
    expect(summary.candidates).toBe(MAX_TAKES_PER_RUN + 1)
    expect(summary.assembled).toBe(MAX_TAKES_PER_RUN)
    expect(summary.budgetExhausted).toBe(true)
  })
})

describe('every container the grammar knows', () => {
  // The key is composed as `audio/${ext}` — true for every member of the
  // closed MIME map today, and the day one is added whose extension is not its
  // subtype ('audio/mpeg' → 'mp3'), every take in that container would land in
  // skipped.extMismatch silently, every night, forever.
  it.each(['webm', 'mp4', 'ogg', 'wav'])('rebuilds a .%s take', async (ext) => {
    seed({ seqs: [0, 1], ext })
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.assembled).toBe(1)
    expect(uploads[0].key).toBe(`app_${BIZ}_${TAKE}.${ext}`)
    expect(uploads[0].opts.contentType).toBe(`audio/${ext}`)
  })
})

describe('the estimate’s own constant', () => {
  it('SEGMENT_NOMINAL_MS is the recorder’s TAKE_FLUSH_MS, read off its source', () => {
    // The recorder module cannot be imported here (it reaches for MediaRecorder
    // and the DOM at module scope), so the constant is read out of the file
    // text — the same pin, without dragging a browser into a node suite.
    const src = readFileSync(join(process.cwd(), 'src/lib/global-recorder.ts'), 'utf8')
    const match = /const TAKE_FLUSH_MS = ([\d_]+)/.exec(src)
    expect(match).not.toBeNull()
    expect(Number(match![1].replace(/_/g, ''))).toBe(SEGMENT_NOMINAL_MS)
  })
})
