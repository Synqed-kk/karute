// OpenAI gpt-4o-transcribe-diarize as a SPEAKER-MAP SECOND PASS (engine #1
// behind the SpeakerIdProvider interface — docs/diarization-stack.md Stage 1).
// We pass the logged-in staff's enrollment clip as a known-speaker reference
// and keep ONLY the 'staff' time segments; the transcript text is DISCARDED
// (Deepgram nova-3 stays the source of truth for words — this model has
// known transcript quirks we never expose). The reference-anchored label is
// immune to the model's cross-chunk label drift; generic A/B labels are NOT,
// so never build logic on them.

import type { StaffSegment } from './align'

/** API hard limits (verified 2026-06): ~25MB / ~23min per request; reference
 *  clips must be 2–10 seconds. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const TIMEOUT_MS = 60_000

interface DiarizedSegment {
  speaker: string
  start: number
  end: number
}

/** Identify the staff's time segments in a session recording.
 *  Returns null on ANY failure — callers fall back to the heuristic;
 *  identification must never block or fail transcription. */
export async function identifyStaffSegments(input: {
  audio: Buffer
  audioMimeType: string
  referenceClip: Buffer
  language: 'ja' | 'en'
}): Promise<StaffSegment[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  if (input.audio.byteLength === 0 || input.audio.byteLength > MAX_AUDIO_BYTES) {
    return null
  }
  try {
    const fd = new FormData()
    fd.append('model', 'gpt-4o-transcribe-diarize')
    fd.append(
      'file',
      new File([new Uint8Array(input.audio)], 'session.webm', {
        type: input.audioMimeType || 'audio/webm',
      }),
    )
    fd.append('response_format', 'diarized_json')
    fd.append('chunking_strategy', 'auto')
    fd.append('language', input.language)
    fd.append('known_speaker_names[]', 'staff')
    // The API requires references as base64 data-URI STRINGS, not file
    // parts — sending a File gets HTTP 400 'Input should be a valid string'
    // (verified live 2026-06-12).
    fd.append(
      'known_speaker_references[]',
      `data:audio/webm;base64,${input.referenceClip.toString('base64')}`,
    )

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = (await res.json()) as { segments?: DiarizedSegment[] }
    if (!Array.isArray(data.segments)) return null
    const staff = data.segments
      .filter((s) => s.speaker === 'staff' && s.end > s.start)
      .map((s) => ({ start: s.start, end: s.end }))
    return staff.length > 0 ? staff : null
  } catch {
    return null
  }
}
