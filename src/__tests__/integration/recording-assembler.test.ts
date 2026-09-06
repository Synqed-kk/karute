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

/** prefix -> the pages that listing answers with, in order. A prefix with one
 *  page shorter than the limit still gets a terminating empty page, because
 *  the real walk advances by what a page RETURNED and only a zero-length page
 *  ends it. */
const listings = new Map<string, ListAnswer[]>()
const listCursor = new Map<string, number>()
const bodies = new Map<string, Buffer>()
const infos = new Map<string, { size?: number } | null>()
const uploads: { key: string; body: Buffer; opts: { contentType?: string; upsert?: boolean } }[] = []
let uploadAnswer: { error: unknown } = { error: null }
const storageRemove = jest.fn(async () => ({ data: [], error: null }))
const emptyBucket = jest.fn(async () => ({ data: null, error: null }))

const NOT_FOUND = { message: 'Object not found', status: 404, statusCode: '404' }

const list = jest.fn(async (prefix: string, _opts: unknown): Promise<ListAnswer> => {
  const pages = listings.get(prefix)
  if (!pages) return { data: [], error: null }
  const at = listCursor.get(prefix) ?? 0
  listCursor.set(prefix, at + 1)
  return pages[at] ?? { data: [], error: null }
})
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

const NOW = Date.parse('2026-09-06T18:07:00.000Z')
const OLD = new Date(NOW - ASSEMBLE_AFTER_MS - 60 * 60 * 1000).toISOString()

type Row = {
  id: string
  business_id: string
  audio_storage_path: string | null
  duration_seconds: number | null
  status: string
}
const rowsByBusiness = new Map<string, Row[]>()
/** Every time anything reached for a core WRITE method. Must stay empty. */
const coreWrites: string[] = []
const listedBy: string[] = []
let listThrows = false

// ⚖ READ-ONLY BY CONSTRUCTION. Core fences recording writes behind a human
// actor and this job has none, so the fake offers `list` and NOTHING else:
// `update` is a getter that throws, which fails on the mere REFERENCE — a
// call, a spread, even a `typeof` probe. A regression that brings the stamp
// back cannot pass this file by accident.
const coreFor = jest.fn((businessId: string) => ({
  recordings: {
    list: async (_opts: unknown) => {
      listedBy.push(businessId)
      if (listThrows) throw new Error('core down')
      const rows = rowsByBusiness.get(businessId) ?? []
      return { recordings: rows, total: rows.length, page: 1, page_size: 200 }
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
  rowPointer?: string | null
  duration?: number | null
  objectSize?: number | null
  status?: string
}) {
  const businessId = opts.businessId ?? BIZ
  const takeId = opts.takeId ?? TAKE
  const ext = opts.ext ?? 'webm'
  const folder = `app_${businessId}_${takeId}`
  const created = opts.createdAt ?? OLD
  const leaves: Entry[] = opts.seqs.map((seq, i) => {
    const size = opts.sizes?.[i] ?? 10 + seq
    const name = `${String(seq).padStart(6, '0')}.${Array.isArray(opts.ext) ? opts.ext[i] : ext}`
    bodies.set(`seg/${folder}/${name}`, Buffer.alloc(size, seq + 1))
    return { name, id: `obj-${folder}-${seq}`, created_at: created, metadata: { size } }
  })
  addFolder(folder)
  listings.set(`seg/${folder}`, [{ data: leaves, error: null }, { data: [], error: null }])
  const key = `app_${businessId}_${takeId}.${ext}`
  if (opts.objectSize != null) infos.set(key, { size: opts.objectSize })
  const pointer = opts.rowPointer === undefined ? key : opts.rowPointer
  if (pointer !== null) {
    const rows = rowsByBusiness.get(businessId) ?? []
    rows.push({
      id: opts.takeId === TAKE2 ? `${SESSION}-2` : SESSION,
      business_id: businessId,
      audio_storage_path: pointer,
      duration_seconds: opts.duration ?? null,
      status: opts.status ?? 'UPLOADING',
    })
    rowsByBusiness.set(businessId, rows)
  }
  return { folder, key, leaves }
}

const rootFolders: Entry[] = []
function addFolder(name: string) {
  rootFolders.push({ name, id: null, created_at: null, metadata: null })
  listings.set('seg', [{ data: [...rootFolders], error: null }, { data: [], error: null }])
}

beforeEach(() => {
  jest.clearAllMocks()
  listings.clear()
  listCursor.clear()
  bodies.clear()
  infos.clear()
  uploads.length = 0
  rootFolders.length = 0
  rowsByBusiness.clear()
  coreWrites.length = 0
  listedBy.length = 0
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
    // Page 1 came back with the folder; page 2 fails, so the rest of the tree
    // was never seen. What WAS listed is still real work.
    listings.set('seg', [
      { data: [...rootFolders], error: null },
      { data: null, error: { message: 'boom' } },
    ])
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.walkComplete).toBe(false)
    expect(summary.assembled).toBe(1)
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
    listings.set(`seg/${folder}`, [
      {
        data: [
          { name: '000000.webm', id: 'a', created_at: OLD, metadata: { size: 4 } },
          { name: '000001.mp4', id: 'b', created_at: OLD, metadata: { size: 4 } },
        ],
        error: null,
      },
      { data: [], error: null },
    ])
    const summary = await runAssembler(deps(), { budgetMs: 60_000 })
    expect(summary.skipped.extMismatch).toBe(1)
    expect(uploads).toHaveLength(0)
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
