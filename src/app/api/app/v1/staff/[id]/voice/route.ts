// Facade: staff voice enrollment — enroll (multipart audio) + revoke
// (design-parity packet 12 §S4b). Single-source: both routes call the SAME
// cores the web actions call (enrollVoiceActionCore / revokeVoiceActionCore,
// src/actions/voice.ts — extracted at S4a, routes deferred to this packet).
//
// Gate: assertVoiceOwnership EXACT mirror (voice.ts's canActOnVoice — self OR
// 'staff.manage', the voice-isolation rule). NOT an ensureCapability floor —
// a plain staffer with no staff.manage grant must still be able to manage
// their OWN voice, so the gate lives entirely inside the shared core via
// `selfUserId`/`callerCapabilities`. `selfUserId` is derived from the Bearer
// identity's roster row (resolveSelfStaffId — the selfRow idiom), never
// read from the request.
//
// TRUST BOUNDARY — multipart idiom = customers/[id]/photos/route.ts
// VERBATIM: file present + non-empty, a size cap, and a magic-byte sniff of
// the real bytes (the declared content-type is caller-controlled). The
// container types sniffed are the ones VoiceEnrollmentDialog's MediaRecorder
// can actually produce — it passes NO mimeType override
// (`new MediaRecorder(stream)`), so the browser's own default container
// applies: WebM/EBML (Chrome/Firefox) or ISO-BMFF/MP4 (Safari,
// MediaRecorder.mimeType 'audio/mp4'). MAX_SAMPLE_BYTES mirrors voice.ts's
// own cap (3 MB — ~15s of opus) — same "redeclare the shape" convention as
// the avatar route's MAX_AVATAR_BYTES, not shared to avoid widening the
// core's own import surface for a value-only need.
//
// Business-result passthrough: both cores' own result shape rides the 2xx
// body VERBATIM — VoiceEnrollmentDialog/StaffList branch on `ok` exactly as
// they do against the web action.
//
// revocation: 'staff.voice.enroll'/'staff.voice.revoke' are facade WRITES —
// new keys this packet registers in REVOCATION_SENSITIVE_ENDPOINTS
// (src/lib/auth/revocation.ts) — a just-terminated staffer must not enroll
// or revoke a voice sample on the local fast-path.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { enrollVoiceActionCore, revokeVoiceActionCore } from '@/actions/voice'

export const runtime = 'nodejs'

type Params = { id: string }

// Mirrors voice.ts's own MAX_SAMPLE_BYTES (~15s of opus).
const MAX_SAMPLE_BYTES = 3 * 1024 * 1024

async function staffId(ctx: FacadeContext<Params>): Promise<string> {
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'staff id is required')
  return id
}

/** Magic-byte sniff over the two containers VoiceEnrollmentDialog's
 *  MediaRecorder can actually produce (no mimeType override is passed, so
 *  the browser's own default applies). Same idiom as
 *  customers/[id]/photos/route.ts's looksLikeImage — a container check, not
 *  a decoder. */
async function looksLikeAudio(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (head.length < 8) return false
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true // WebM/EBML
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to))
  if (ascii(4, 8) === 'ftyp') return true // ISO-BMFF (MP4/M4A — Safari default)
  return false
}

/** Validates one multipart audio field against the trust boundary above.
 *  `required` throws when absent (the `audio` field); the optional
 *  `audioRef` field is skipped entirely when not present (mirrors
 *  enrollVoiceActionCore's own tolerant `audioRef instanceof File` check). */
async function assertValidAudioField(form: FormData, field: 'audio' | 'audioRef', required: boolean): Promise<void> {
  const file = form.get(field)
  if (!(file instanceof File)) {
    if (required) throw new AppApiError('validation', `${field} is required`)
    return
  }
  if (file.size === 0) throw new AppApiError('validation', `${field} is empty`)
  if (!file.type.startsWith('audio/')) {
    throw new AppApiError('validation', `${field} must be audio (audio/* content-type)`)
  }
  if (file.size > MAX_SAMPLE_BYTES) {
    throw new AppApiError('validation', `${field} exceeds the size limit`)
  }
  if (!(await looksLikeAudio(file))) {
    throw new AppApiError('validation', `${field} content is not a recognized audio format`)
  }
}

export const POST = facadeHandler<Params>('staff.voice.enroll', async (ctx) => {
  const id = await staffId(ctx)
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  let form: FormData
  try {
    form = await ctx.req.formData()
  } catch {
    throw new AppApiError('validation', 'multipart form-data body required')
  }

  await assertValidAudioField(form, 'audio', true)
  await assertValidAudioField(form, 'audioRef', false)

  const selfUserId = await resolveSelfStaffId(businessId, ctx.identity.authUserId)

  const result = await enrollVoiceActionCore(
    synqed,
    businessId,
    { selfUserId, callerCapabilities: ctx.identity.capabilities, actorId: ctx.identity.authUserId, source: 'facade' },
    id,
    form,
  )
  return ok(ctx, result)
})

export const DELETE = facadeHandler<Params>('staff.voice.revoke', async (ctx) => {
  const id = await staffId(ctx)
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const selfUserId = await resolveSelfStaffId(businessId, ctx.identity.authUserId)

  const result = await revokeVoiceActionCore(
    synqed,
    businessId,
    { selfUserId, callerCapabilities: ctx.identity.capabilities, actorId: ctx.identity.authUserId, source: 'facade' },
    id,
  )
  return ok(ctx, result)
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.
