import { NextResponse } from 'next/server'
import { enforceAiRateLimit } from '@/lib/ai-rate-limit'
import {
  transcribeUrlWithDeepgram,
  transcribeWithDeepgram,
  type DeepgramTranscribeResult,
} from '@/lib/deepgram'
import { getCurrentUserStaffId } from '@/lib/staff'
import { createServiceClient } from '@/lib/supabase/service'
import { identifyStaffSegments } from '@/lib/speaker-id/openai'
import { mapStaffSpeaker } from '@/lib/speaker-id/align'
import type { OrgSettings } from '@/actions/org-settings'
import { getOrgSettings } from '@/actions/org-settings'

export const maxDuration = 300

/**
 * POST /api/ai/transcribe
 *
 * Accepts either:
 * - FormData with audio file (small files, browser direct upload)
 * - JSON with { audioUrl, locale } (large files — caller uploaded to Supabase
 *   Storage and is passing us the signed URL). Deepgram fetches the audio
 *   directly from that URL, so we skip the round-trip through this function.
 *
 * Returns:
 * ```
 * {
 *   transcript: string            // plain text — what karute_records persists
 *   durationSec?: number          // audio length per Deepgram metadata
 *   confidence?: number           // alternative-level confidence (0–1)
 *   words?: Array<{ word, start, end, confidence, speaker? }>
 *   paragraphs?: Array<{ speaker, start, end, text }>  // only when diarized
 * }
 * ```
 *
 * The `transcript` field is the only one existing consumers read; the rest
 * are additive and tied to Deepgram's response. Diarization is controlled by
 * org_settings.speaker_diarization (default true).
 */
export async function POST(request: Request) {
  const limited = await enforceAiRateLimit('transcribe')
  if (limited) return limited
  try {
    const contentType = request.headers.get('content-type') ?? ''

    // Honor the org's speaker_diarization toggle. Missing settings → true
    // (matches OrgSettings getter default + spike spec).
    const orgSettings = await getOrgSettings().catch(() => null)
    const diarize = orgSettings?.speaker_diarization !== false

    if (contentType.includes('application/json')) {
      const { audioUrl, locale: loc } = await request.json()
      if (!audioUrl) {
        return NextResponse.json({ error: 'No audioUrl provided' }, { status: 400 })
      }
      const lang = (loc ?? 'ja') === 'en' ? 'en' : 'ja'
      const mode = speakerIdMode()
      const ref = mode === 'off' ? null : await loadStaffReference(orgSettings)
      // Identify needs the bytes; only fetch when the file is within the
      // engine's 25MB cap (oversize → heuristic-only, logged via absence).
      let audioBuf: Buffer | null = null
      if (ref) {
        try {
          const head = await fetch(audioUrl, { method: 'HEAD' })
          const len = Number(head.headers.get('content-length') ?? '0')
          if (len > 0 && len <= MAX_IDENTIFY_BYTES) {
            const r = await fetch(audioUrl)
            audioBuf = Buffer.from(await r.arrayBuffer())
          }
        } catch {
          audioBuf = null
        }
      }
      const segsPromise =
        ref && audioBuf
          ? identifyStaffSegments({
              audio: audioBuf,
              audioMimeType: 'audio/webm',
              referenceClip: ref,
              language: lang,
            })
          : Promise.resolve(null)
      const result = await transcribeUrlWithDeepgram(audioUrl, {
        language: lang,
        diarize,
      })
      const speakerId = alignAndLog(result, await segsPromise, mode)
      return NextResponse.json({
        ...serialize(result),
        ...(speakerId ? { speakerId } : {}),
      })
    }

    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null
    const locale = (formData.get('locale') as string | null) ?? 'ja'
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio provided' }, { status: 400 })
    }
    const buffer = Buffer.from(await audioFile.arrayBuffer())
    const mimeType = audioFile.type || 'audio/webm'

    const lang = locale === 'en' ? 'en' : 'ja'
    const mode = speakerIdMode()
    const ref = mode === 'off' ? null : await loadStaffReference(orgSettings)
    // Engine call runs CONCURRENTLY with Deepgram — added wall time is
    // max(0, engine − deepgram), timeout-capped inside the provider.
    const segsPromise = ref
      ? identifyStaffSegments({
          audio: buffer,
          audioMimeType: mimeType,
          referenceClip: ref,
          language: lang,
        })
      : Promise.resolve(null)
    const result = await transcribeWithDeepgram(buffer, {
      language: lang,
      mimeType,
      diarize,
    })
    const speakerId = alignAndLog(result, await segsPromise, mode)
    return NextResponse.json({
      ...serialize(result),
      ...(speakerId ? { speakerId } : {}),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[/api/ai/transcribe]', message)
    return NextResponse.json(
      { error: 'Transcription failed', detail: message },
      { status: 500 },
    )
  }
}

// ── Speaker-id pass (Stage 1, docs/diarization-stack.md) ────────────────────
// The logged-in staff's enrollment clip rides to the voice-match engine; the
// aligner maps the result onto Deepgram's speaker ints. SPEAKER_ID_MODE:
// 'off' | 'shadow' (compute + log, don't act — the default while ja accuracy
// is unproven) | 'enforce' (the pipeline's role attribution uses it).
// HARD RULE: any failure here returns null — transcription never blocks.

type SpeakerIdMode = 'off' | 'shadow' | 'enforce'

function speakerIdMode(): SpeakerIdMode {
  const m = process.env.SPEAKER_ID_MODE
  return m === 'off' || m === 'enforce' ? m : 'shadow'
}

const MAX_IDENTIFY_BYTES = 25 * 1024 * 1024

async function loadStaffReference(
  orgSettings: OrgSettings | null,
): Promise<Buffer | null> {
  try {
    const staffId = await getCurrentUserStaffId()
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
