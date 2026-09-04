import { Entry } from '@/types/ai'
import { getDataPort } from '@/lib/ports/data-port'
import { getRecordingPipelinePort } from '@/lib/ports/recording-port'
import { readTakeSecureMeta } from '@/lib/karute/take-store'
import { buildDiarizedTranscript, toSpeakerText } from './diarized'

/**
 * Represents each step of the AI processing pipeline.
 */
export type PipelineStep = 'transcribing' | 'extracting' | 'summarizing' | 'complete' | 'error'

/**
 * The full result returned when the pipeline completes successfully.
 */
export type PipelineResult = {
  transcript: string
  entries: Entry[]
  summary: string
}

/** Transcription succeeded but recognized no speech (silence / too quiet) —
 *  the one failure anyone can hit on purpose by recording silence. Typed so
 *  the UI can show the specific 音声が認識できませんでした message instead of
 *  raw exception text (which must never reach the screen). */
export class EmptyTranscriptError extends Error {
  constructor() {
    super('Transcription returned an empty transcript.')
    this.name = 'EmptyTranscriptError'
  }
}

/**
 * Retries a fetch call once on failure.
 * - First failure: waits 1.5 seconds, then retries.
 * - Second failure: throws.
 */
async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    const detail = typeof json.detail === 'string' ? json.detail : null
    const error = typeof json.error === 'string' ? json.error : null
    return [error, detail].filter(Boolean).join(' — ') || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}: ${text.slice(0, 200)}`
  }
}

async function fetchWithRetry(fn: () => Promise<Response>): Promise<Response> {
  try {
    const res = await fn()
    if (!res.ok) {
      throw new Error(await readErrorMessage(res))
    }
    return res
  } catch (firstError) {
    // Wait 1.5 seconds before retrying
    await new Promise((resolve) => setTimeout(resolve, 1500))
    try {
      const res = await fn()
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errText}`)
      }
      return res
    } catch (secondError) {
      throw secondError
    }
  }
}

/**
 * Orchestrates the full AI processing pipeline:
 *   1. Transcribe audio blob via Deepgram nova-3 (/api/ai/transcribe)
 *   2. Run extraction and summary in parallel via Promise.all (/api/ai/extract + /api/ai/summarize)
 *
 * Calls onProgress at each stage so UI can show step-by-step progress.
 * Auto-retries each API call once on failure; throws on second failure.
 */
/** Optional prompt context — anchors the AI to THIS customer (rejects other
 *  customers' names from phone calls etc.) and to the session date (converts
 *  「来週」-style relative dates to absolute). Both degrade gracefully. */
export type PipelineContext = {
  customerName?: string | null
  sessionDate?: string | null
}

export async function runAIPipeline(
  audioBlob: Blob,
  /** The persisted take this audio belongs to (lib/karute/take-store), or null
   *  when the store never held it. ⚖ capture pipeline PR4: the take carries the
   *  finalized key its whole self was PUT to at stop, and THAT object is what
   *  this transcribes — read here rather than passed in, so every caller gets
   *  the same answer and none of them has to remember to ask. */
  takeId: string | null,
  locale: string,
  onProgress: (step: PipelineStep) => void,
  ctx: PipelineContext = {},
): Promise<PipelineResult> {
  // Step 1: Transcription
  onProgress('transcribing')

  // Upload + transcribe legs go through the recording pipeline PORT (Decision 2):
  // web = a service-minted signed upload URL + /api/ai; thin = a service-minted signed upload URL
  // + /api/app/v1/ai (no supabase-js in the bundle). The GlobalRecorder /
  // globalPipeline / draft singletons are unchanged — the seam is HERE only.
  const recordingPort = getRecordingPipelinePort()
  // …AND THE STOP GETS TO FINISH FIRST (capture pipeline PR4 fix round 2). The
  // 自動 arm reaches this line at the stop instant, with that take's own whole
  // upload still in flight — so the read below answered null on an ORDINARY
  // recording and prepareTranscription's fallback staged a second copy of the
  // same audio to a key no row points at. Free when this runtime has no stop
  // leg for the take (the recovery/inbox saves, another tab), bounded at two
  // minutes when it does.
  // Lazy, and for this file's oldest reason (see recording-port's own): the
  // recorder's import graph reaches @/actions/recordings → next/cache, which
  // jest cannot load in a node-environment suite — a static import here breaks
  // every consumer of this module, inbox-store's page included.
  if (takeId) await (await import('@/lib/global-recorder')).globalRecorder.awaitTakeSecured(takeId)
  const finalizedPath = takeId ? ((await readTakeSecureMeta(takeId))?.finalizedPath ?? null) : null
  const { body: transcribeBody } = await recordingPort.prepareTranscription(
    audioBlob,
    finalizedPath,
  )

  const transcribeRes = await fetchWithRetry(() =>
    getDataPort().apiFetch(`${recordingPort.aiBase}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...transcribeBody, locale }),
    }),
  ).catch((err) => {
    throw new Error(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`)
  })

  // ⚖ NOTHING IS CLEANED UP (capture pipeline PR4): the object this just read is
  // the take's finalized audio, and audio is never deleted.

  const transcribeData = await transcribeRes.json()
  const transcript: string = transcribeData.transcript

  if (!transcript) {
    throw new EmptyTranscriptError()
  }

  // Stage 0 (docs/diarization-stack.md): use the speaker labels we already
  // pay Deepgram for. When attribution succeeds, BOTH the prompts and the
  // stored transcript get the labeled text (施術者:/お客様:/周囲) — what the
  // AI read is exactly what staff can audit. Any failure → flat transcript,
  // exactly yesterday's behavior (graceful degradation).
  // Voiceprint staff hint (speaker-id pass) — acted on only in enforce mode;
  // shadow mode logs server-side without changing behavior.
  const sid = transcribeData.speakerId
  const staffHint =
    sid && sid.mode === 'enforce'
      ? { speaker: sid.staffSpeakerIndex as number, confidence: sid.confidence as number }
      : null
  const diarized = buildDiarizedTranscript(
    transcribeData.paragraphs ?? [],
    transcribeData.words ?? [],
    transcribeData.confidence ?? 0,
    staffHint,
  )
  const aiTranscript = diarized ? toSpeakerText(diarized) : transcript

  // Step 2: Parallel extraction and summary
  onProgress('extracting')

  const [extractRes, summarizeRes] = await Promise.all([
    fetchWithRetry(() =>
      getDataPort().apiFetch(`${recordingPort.aiBase}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: aiTranscript,
          locale,
          customerName: ctx.customerName ?? null,
          sessionDate: ctx.sessionDate ?? null,
        }),
      }),
    ).catch((err) => {
      throw new Error(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`)
    }),
    fetchWithRetry(() =>
      getDataPort().apiFetch(`${recordingPort.aiBase}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: aiTranscript,
          locale,
          customerName: ctx.customerName ?? null,
          sessionDate: ctx.sessionDate ?? null,
        }),
      }),
    ).catch((err) => {
      throw new Error(`Summary generation failed: ${err instanceof Error ? err.message : String(err)}`)
    }),
  ])

  const extractData = await extractRes.json()
  const summarizeData = await summarizeRes.json()

  const entries: Entry[] = extractData.entries
  const summary: string = summarizeData.summary

  // Step 3: Complete
  onProgress('complete')

  return { transcript: aiTranscript, entries, summary }
}
