// Staff voice enrollment facade routes (design-parity packet 12 §S4b). Uses
// the REAL enrollVoiceActionCore/revokeVoiceActionCore (src/actions/voice.ts,
// extracted at S4a) — only their own dependencies (createServiceClient,
// org-settings WithClient twins) are mocked, same idiom as
// authz-gap-voice.test.ts (which pins these cores from the web-action side).
// Pins:
//   - NO ensureCapability floor — assertVoiceOwnership EXACT mirror: self OR
//     staff.manage lives INSIDE the shared core (canActOnVoice), so a plain
//     staffer can still enroll/revoke their OWN voice with no staff.manage
//     grant
//   - selfUserId is derived from the Bearer identity's roster row
//     (resolveSelfStaffId — the selfRow idiom), NEVER read from the request
//   - a foreign staffId without staff.manage → { ok: false }, no write
//   - staff.manage grants cross-staff enroll/revoke
//   - multipart trust boundary: missing/empty/oversized/wrong-declared-type/
//     non-audio-magic-bytes all → validation error, core never reached
//   - business-result passthrough: the core's { ok, enrolledAt? } / { ok }
//     rides the 2xx body VERBATIM
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
  }),
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))

const mockCapabilities = jest.fn(async () => new Set(['customers.view']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

const staffListByBusinessOrThrow = jest.fn(async (..._a: unknown[]) => [
  { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'stylist' },
])
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: (...a: unknown[]) => staffListByBusinessOrThrow(...a),
}))

// Store assignments the write clamp reads (ensureStaffWriteInScope): keyed by
// staff id so a test can put the CALLER and the TARGET in different branches.
// Default = everyone floating (empty assignment = works in every store), the
// unclamped path every pre-clamp pin in this file was written against.
let storeAssignments: Record<string, string[]> = {}
const staffStoresGet = jest.fn(async (id: string) => ({ store_ids: storeAssignments[id] ?? [] }))
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: jest.fn((_businessId: string) => ({
    staffStores: { get: (id: string) => staffStoresGet(id) },
  })),
}))

// enrollVoiceActionCore/revokeVoiceActionCore's own dependencies — same
// mocks as authz-gap-voice.test.ts.
const storageUpload = jest.fn(async () => ({ error: null }))
const storageRemove = jest.fn(async () => ({}))
const createServiceClient = jest.fn(() => ({
  storage: { from: () => ({ upload: storageUpload, remove: storageRemove }) },
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => createServiceClient(),
}))

let orgSettingsFixture: { voice_enrollments: Record<string, unknown> } = { voice_enrollments: {} }
const orgSettingsWithClient = jest.fn(async (..._a: unknown[]) => orgSettingsFixture)
const writeOrgSettingsBlobWithClient = jest.fn(async (..._a: unknown[]) => ({ success: true }))
jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: (...a: unknown[]) => orgSettingsWithClient(...a),
  writeOrgSettingsBlobWithClient: (...a: unknown[]) => writeOrgSettingsBlobWithClient(...a),
}))

import { POST, DELETE } from '@/app/api/app/v1/staff/[id]/voice/route'
import { auditLines } from './helpers/audit-lines'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}` }
const params = (id: string) => ({ params: Promise.resolve({ id }) })

// EBML header — the WebM magic bytes VoiceEnrollmentDialog's default
// MediaRecorder container starts with (Chrome/Firefox).
const WEBM_MAGIC = [0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]

function audioFile(bytes: number[] = WEBM_MAGIC, type = 'audio/webm', name = 'voice.webm'): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

function postReq(id: string, form: FormData) {
  return new Request(`https://s/api/app/v1/staff/${id}/voice`, { method: 'POST', headers: auth, body: form })
}
function deleteReq(id: string) {
  return new Request(`https://s/api/app/v1/staff/${id}/voice`, { method: 'DELETE', headers: auth })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view']))
  staffListByBusinessOrThrow.mockResolvedValue([
    { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'stylist' },
  ])
  orgSettingsFixture = { voice_enrollments: {} }
  storeAssignments = {}
  staffStoresGet.mockImplementation(async (id: string) => ({ store_ids: storeAssignments[id] ?? [] }))
  storageUpload.mockResolvedValue({ error: null })
  storageRemove.mockResolvedValue({})
  writeOrgSettingsBlobWithClient.mockResolvedValue({ success: true })
})

describe('POST /api/app/v1/staff/[id]/voice', () => {
  it('no ensureCapability floor: a caller with NO staff.manage enrolls their OWN voice', async () => {
    const fd = new FormData()
    fd.set('audio', audioFile())
    const res = await POST(postReq('auth-user-1', fd), params('auth-user-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.enrolledAt).toBe('string')
    expect(writeOrgSettingsBlobWithClient).toHaveBeenCalled()
  })

  it('refuses enrolling a FOREIGN staffId without staff.manage — no write reaches storage or org-settings', async () => {
    const fd = new FormData()
    fd.set('audio', audioFile())
    const res = await POST(postReq('someone-else', fd), params('someone-else'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
    expect(storageUpload).not.toHaveBeenCalled()
    expect(writeOrgSettingsBlobWithClient).not.toHaveBeenCalled()
  })

  it('staff.manage grants cross-staff enroll', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'staff.manage']))
    const fd = new FormData()
    fd.set('audio', audioFile())
    const res = await POST(postReq('someone-else', fd), params('someone-else'))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(writeOrgSettingsBlobWithClient).toHaveBeenCalled()
  })

  it('selfUserId is null when the caller is absent from the roster (unresolvable self)', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([])
    const fd = new FormData()
    fd.set('audio', audioFile())
    const res = await POST(postReq('auth-user-1', fd), params('auth-user-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
    expect(writeOrgSettingsBlobWithClient).not.toHaveBeenCalled()
  })

  it('missing audio field → validation error, core never reached', async () => {
    const fd = new FormData()
    const res = await POST(postReq('auth-user-1', fd), params('auth-user-1'))
    expect(res.status).toBe(400)
    expect(storageUpload).not.toHaveBeenCalled()
  })

  it('empty audio file → validation error, core never reached', async () => {
    const fd = new FormData()
    fd.set('audio', new File([], 'voice.webm', { type: 'audio/webm' }))
    const res = await POST(postReq('auth-user-1', fd), params('auth-user-1'))
    expect(res.status).toBe(400)
    expect(storageUpload).not.toHaveBeenCalled()
  })

  it('oversized audio (>3MB cap) → validation error, core never reached', async () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 1)
    big.set(WEBM_MAGIC)
    const fd = new FormData()
    fd.set('audio', new File([big], 'voice.webm', { type: 'audio/webm' }))
    const res = await POST(postReq('auth-user-1', fd), params('auth-user-1'))
    expect(res.status).toBe(400)
    expect(storageUpload).not.toHaveBeenCalled()
  })

  it('declared content-type not audio/* → validation error, core never reached', async () => {
    const fd = new FormData()
    fd.set('audio', audioFile(WEBM_MAGIC, 'image/png'))
    const res = await POST(postReq('auth-user-1', fd), params('auth-user-1'))
    expect(res.status).toBe(400)
    expect(storageUpload).not.toHaveBeenCalled()
  })

  it('declared audio/* but bytes are not a real audio container → validation error (magic-byte sniff, never trust declared content-type)', async () => {
    const fake = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    const fd = new FormData()
    fd.set('audio', audioFile(fake, 'audio/webm'))
    const res = await POST(postReq('auth-user-1', fd), params('auth-user-1'))
    expect(res.status).toBe(400)
    expect(storageUpload).not.toHaveBeenCalled()
  })

  it('accepts the ISO-BMFF/MP4 container (Safari default MediaRecorder.mimeType)', async () => {
    const mp4 = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]
    const fd = new FormData()
    fd.set('audio', audioFile(mp4, 'audio/mp4', 'voice.mp4'))
    const res = await POST(postReq('auth-user-1', fd), params('auth-user-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('optional audioRef is validated the SAME way when present', async () => {
    const fake = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    const fd = new FormData()
    fd.set('audio', audioFile())
    fd.set('audioRef', audioFile(fake, 'audio/webm', 'ref.webm'))
    const res = await POST(postReq('auth-user-1', fd), params('auth-user-1'))
    expect(res.status).toBe(400)
    expect(storageUpload).not.toHaveBeenCalled()
  })

  it('emits privacy.voice_enroll at notice, source facade', async () => {
    const fd = new FormData()
    fd.set('audio', audioFile())
    const lines = await auditLines(async () => {
      const res = await POST(postReq('auth-user-1', fd), params('auth-user-1'))
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'privacy',
      action: 'privacy.voice_enroll',
      severity: 'notice',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_type: 'staff',
      target_id: 'auth-user-1',
      source: 'facade',
    })
  })

  it('a refused (foreign-staffId) enroll emits no audit row (silence contract)', async () => {
    const fd = new FormData()
    fd.set('audio', audioFile())
    const lines = await auditLines(async () => {
      await POST(postReq('someone-else', fd), params('someone-else'))
    })
    expect(lines).toHaveLength(0)
  })
})

describe('DELETE /api/app/v1/staff/[id]/voice', () => {
  it('no ensureCapability floor: a caller with NO staff.manage revokes their OWN voice', async () => {
    orgSettingsFixture = {
      voice_enrollments: { 'auth-user-1': { sample_path: 'p', status: 'saved' } },
    }
    const res = await DELETE(deleteReq('auth-user-1'), params('auth-user-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(writeOrgSettingsBlobWithClient).toHaveBeenCalled()
  })

  it('refuses revoking a FOREIGN staffId without staff.manage', async () => {
    orgSettingsFixture = {
      voice_enrollments: { 'someone-else': { sample_path: 'p', status: 'saved' } },
    }
    const res = await DELETE(deleteReq('someone-else'), params('someone-else'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
    expect(writeOrgSettingsBlobWithClient).not.toHaveBeenCalled()
  })

  it('staff.manage grants cross-staff revoke', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'staff.manage']))
    orgSettingsFixture = {
      voice_enrollments: { 'someone-else': { sample_path: 'p', status: 'saved' } },
    }
    const res = await DELETE(deleteReq('someone-else'), params('someone-else'))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('emits privacy.voice_revoke; a refused one emits nothing', async () => {
    orgSettingsFixture = {
      voice_enrollments: { 'auth-user-1': { sample_path: 'p', status: 'saved' } },
    }
    const okLines = await auditLines(async () => {
      const res = await DELETE(deleteReq('auth-user-1'), params('auth-user-1'))
      expect(await res.json()).toEqual({ ok: true })
    })
    expect(okLines).toHaveLength(1)
    expect(okLines[0]).toMatchObject({ action: 'privacy.voice_revoke', target_id: 'auth-user-1', source: 'facade' })

    const refusedLines = await auditLines(async () => {
      await DELETE(deleteReq('someone-else'), params('someone-else'))
    })
    expect(refusedLines).toHaveLength(0)
  })
})

// ─── Actor store-scope clamp (ensureStaffWriteInScope) ──────────────────────
// The facade transport of the clamp src/actions/voice.ts applies on web. The
// SELF arm of canActOnVoice is untouched; a staff.manage holder acting on
// ANOTHER staffer now also needs that person inside their own stores.
describe("voice writes are clamped to the caller's stores", () => {
  const CALLER = 'auth-user-1' // the Bearer sub this suite signs with
  const TARGET = 'someone-else'

  const enrollForm = () => {
    const fd = new FormData()
    fd.set('audio', audioFile())
    return fd
  }
  const writes: Array<[string, () => Promise<Response>]> = [
    ['POST', () => POST(postReq(TARGET, enrollForm()), params(TARGET))],
    ['DELETE', () => DELETE(deleteReq(TARGET), params(TARGET))],
  ]

  beforeEach(() => {
    mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: CALLER, full_name: 'Mika Tanaka', display_role: 'manager' },
      { id: TARGET, full_name: 'Branch Person', display_role: 'stylist' },
    ])
    orgSettingsFixture = { voice_enrollments: { [TARGET]: { sample_path: 'p', status: 'saved' } } }
  })

  describe.each(writes)('%s', (_name, run) => {
    it('out-of-scope target → 403 store_forbidden, storage + org-settings untouched, no audit row', async () => {
      storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
      const lines = await auditLines(async () => {
        const res = await run()
        expect(res.status).toBe(403)
        expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
      })
      // The refusal precedes every side effect — on DELETE that is the point:
      // revoke removes the stored sample, so a late clamp would delete first.
      expect(createServiceClient).not.toHaveBeenCalled()
      expect(storageUpload).not.toHaveBeenCalled()
      expect(storageRemove).not.toHaveBeenCalled()
      expect(writeOrgSettingsBlobWithClient).not.toHaveBeenCalled()
      expect(lines).toHaveLength(0)
    })

    it('in-scope target (shared branch) → passes unchanged', async () => {
      storeAssignments = { [CALLER]: ['store-a', 'store-b'], [TARGET]: ['store-b'] }
      const res = await run()
      expect(res.status).toBe(200)
      expect((await res.json()).ok).toBe(true)
      expect(writeOrgSettingsBlobWithClient).toHaveBeenCalled()
    })

    it('stores.viewAll → passes, the assignment is never consulted', async () => {
      mockCapabilities.mockResolvedValue(new Set(['staff.manage', 'stores.viewAll']))
      storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
      const res = await run()
      expect(res.status).toBe(200)
      expect(staffStoresGet).not.toHaveBeenCalled()
    })

    it("a failed lookup of the caller's own assignment fails closed → 403", async () => {
      staffStoresGet.mockImplementation(async (id: string) => {
        if (id === CALLER) throw new Error('core down')
        return { store_ids: ['store-b'] }
      })
      const res = await run()
      expect(res.status).toBe(403)
      expect(writeOrgSettingsBlobWithClient).not.toHaveBeenCalled()
    })
  })

  it('POST clamps BEFORE the multipart read: an out-of-scope target with an INVALID body is still 403 store_forbidden', async () => {
    // Precedence pin (the PATCH-ordering cell's twin in app-api-staff.test.ts):
    // a 400 here would mean the audio was read — and a 50MB multipart paid for
    // — before the caller's right to touch this row was settled.
    storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
    const bad = new FormData()
    bad.set('audio', new File([new Uint8Array([1, 2, 3])], 'nope.txt', { type: 'text/plain' }))
    const res = await POST(postReq(TARGET, bad), params(TARGET))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
    expect(storageUpload).not.toHaveBeenCalled()
    expect(writeOrgSettingsBlobWithClient).not.toHaveBeenCalled()
  })

  it('self: a clamped caller still manages their OWN voice, assignment never consulted', async () => {
    storeAssignments = { [CALLER]: ['store-a'] }
    orgSettingsFixture = { voice_enrollments: { [CALLER]: { sample_path: 'p', status: 'saved' } } }
    const res = await DELETE(deleteReq(CALLER), params(CALLER))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(staffStoresGet).not.toHaveBeenCalled()
  })
})
