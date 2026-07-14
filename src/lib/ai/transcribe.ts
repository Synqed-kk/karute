import 'server-only'
import {
  transcribeUrlWithDeepgram,
  transcribeWithDeepgram,
  type DeepgramTranscribeResult,
} from '@/lib/deepgram'
import { createServiceClient } from '@/lib/supabase/service'
import { identifyStaffSegments } from '@/lib/speaker-id/openai'
import { mapStaffSpeaker } from '@/lib/speaker-id/align'
import type { OrgSettings } from '@/actions/org-settings'

/**
 * The Deepgram transcription + speaker-id body — previously inlined in
 * `POST /api/ai/transcribe`, moved VERBATIM (packet 08 §Build 1(ii)) so the
 * legacy cookie route AND the facade Bearer twin (Decision 2) share ONE
 * implementation. Identity-agnostic: the diarize toggle + the staff voiceprint
 * REFERENCE are resolved by the CALLER (cookie `getCurrentUserStaffId` on the web
 * route, Bearer `selfStaffId` on the facade — the voice-isolation rule binds the
 * reference to the caller's OWN enrollment clip on both paths) and injected here.
 * NO rate-limit / feature-gate / usage report: those stay with the caller so the
 * accounting path is shared, not duplicated.
 */

// ── Speaker-id pass (Stage 1, docs/diarization-stack.md) ────────────────────
// The logged-in staff's enrollment clip rides to the voice-match engine; the
// aligner maps the result onto Deepgram's speaker ints. SPEAKER_ID_MODE:
// 'off' | 'shadow' (compute + log, don't act — the default while ja accuracy
// is unproven) | 'enforce' (the pipeline's role attribution uses it).
// HARD RULE: any failure here returns null — transcription never blocks.

export type SpeakerIdMode = 'off' | 'shadow' | 'enforce'

export function speakerIdMode(): SpeakerIdMode {
  const m = process.env.SPEAKER_ID_MODE
  return m === 'off' || m === 'enforce' ? m : 'shadow'
}

const MAX_IDENTIFY_BYTES = 25 * 1024 * 1024

/**
 * Download a SPECIFIC staff member's enrollment clip (voice-isolation rule
 * #401: only that staff's OWN reference — never the roster). Web resolves
 * `staffId` from the cookie session; the facade from the Bearer `selfStaffId`.
 * Any failure → null (transcription never blocks).
 */
export async function loadStaffReferenceForStaff(
  orgSettings: OrgSettings | null,
  staffId: string | null,
): Promise<Buffer | null> {
  try {
    if (!staffId) return null
    const e = orgSettings?.voice_enrollments?.[staffId]
    if (!e || e.status !== 'saved' || !e.ref_path) return null
    const supabase = createServiceClient()
    const { data, error } = await supabase.storage
      .from('recordings')
      .download(e.ref_path)
    if (error || !data) return null
    return Buffer.from(await data.arrayBuffer())
  } catch {
    return null
  }
}

interface SpeakerIdPayload {
  staffSpeakerIndex: number
  confidence: number
  ambiguous: boolean
  provider: 'openai'
  mode: SpeakerIdMode
}

function alignAndLog(
  result: DeepgramTranscribeResult,
  segments: Awaited<ReturnType<typeof identifyStaffSegments>>,
  mode: SpeakerIdMode,
): SpeakerIdPayload | null {
  if (!segments) return null
  const match = mapStaffSpeaker(result.words, segments)
  if (!match) return null
  const heuristicStaff = result.paragraphs[0]?.speaker ?? null
  // The shadow log IS the bake-off benchmark harness — keep it structured.
  console.log(
    '[speaker-id]',
    JSON.stringify({
      mode,
      heuristicStaff,
      voiceprintStaff: match.staffSpeakerIndex,
      confidence: Number(match.confidence.toFixed(3)),
      ambiguous: match.ambiguous,
      agree: heuristicStaff === match.staffSpeakerIndex,
      durationSec: Math.round(result.durationSec),
    }),
  )
  return {
    staffSpeakerIndex: match.staffSpeakerIndex,
    confidence: match.confidence,
    ambiguous: match.ambiguous,
    provider: 'openai',
    mode,
  }
}

// Strip empty arrays so the response stays small when Deepgram doesn't
// return word-level data (which can happen on very short clips).
function serialize(result: DeepgramTranscribeResult) {
  return {
    transcript: result.transcript,
    durationSec: result.durationSec,
    confidence: result.confidence,
    ...(result.words.length ? { words: result.words } : {}),
    ...(result.paragraphs.length ? { paragraphs: result.paragraphs } : {}),
  }
}

/** Audio source: a URL Deepgram fetches directly (large uploads), or the raw
 *  bytes (small direct uploads). */
export type TranscriptionAudio = { url: string } | { buffer: Buffer; mimeType: string }

/**
 * Run transcription + the optional voiceprint speaker-id pass and return the
 * serialized response shape the legacy route always emitted (`serialize(result)`
 * + optional `speakerId`) — the client-side diarization assembly consumes it
 * unchanged.
 */
export async function runTranscription(params: {
  audio: TranscriptionAudio
  locale: string
  diarize: boolean
  /** The caller's OWN enrollment clip (voice-isolation), or null when speaker-id
   *  is off / not enrolled. */
  reference: Buffer | null
  mode: SpeakerIdMode
}): Promise<Record<string, unknown>> {
  const { audio, locale, diarize, reference, mode } = params
  const lang = locale === 'en' ? 'en' : 'ja'

  // Identify needs the bytes; for a URL, only fetch when the file is within the
  // engine's 25MB cap (oversize → heuristic-only, logged via absence).
  let identifyBuf: Buffer | null = null
  if (reference) {
    if ('buffer' in audio) {
      identifyBuf = audio.buffer
    } else {
      try {
        const head = await fetch(audio.url, { method: 'HEAD' })
        const len = Number(head.headers.get('content-length') ?? '0')
        if (len > 0 && len <= MAX_IDENTIFY_BYTES) {
          const r = await fetch(audio.url)
          identifyBuf = Buffer.from(await r.arrayBuffer())
        }
      } catch {
        identifyBuf = null
      }
    }
  }

  const segsPromise =
    reference && identifyBuf
      ? identifyStaffSegments({
          audio: identifyBuf,
          audioMimeType: 'buffer' in audio ? audio.mimeType : 'audio/webm',
          referenceClip: reference,
          language: lang,
        })
      : Promise.resolve(null)

  const result =
    'url' in audio
      ? await transcribeUrlWithDeepgram(audio.url, { language: lang, diarize })
      : await transcribeWithDeepgram(audio.buffer, {
          language: lang,
          mimeType: audio.mimeType,
          diarize,
        })

  const speakerId = alignAndLog(result, await segsPromise, mode)
  return {
    ...serialize(result),
    ...(speakerId ? { speakerId } : {}),
  }
}
