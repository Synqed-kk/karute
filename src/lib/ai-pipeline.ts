import { Entry } from '@/types/ai'
import { createClient } from '@/lib/supabase/client'
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
  locale: string,
  onProgress: (step: PipelineStep) => void,
  ctx: PipelineContext = {},
): Promise<PipelineResult> {
  // Step 1: Transcription
  onProgress('transcribing')

  // Upload audio to Supabase Storage to bypass Vercel payload limits
  const supabase = createClient()
  const fileName = `rec_${Date.now()}.webm`

  const { error: uploadError } = await supabase.storage
    .from('recordings')
    .upload(fileName, audioBlob, { upsert: true })

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`)
  }

  // Get a signed URL (valid 10 min) for the server to download
  const { data: signedData, error: signError } = await supabase.storage
    .from('recordings')
    .createSignedUrl(fileName, 3600)

  if (signError || !signedData?.signedUrl) {
    throw new Error(`Failed to get signed URL: ${signError?.message}`)
  }

  const transcribeRes = await fetchWithRetry(() =>
    fetch('/api/ai/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUrl: signedData.signedUrl, locale }),
    }),
  ).catch((err) => {
    throw new Error(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`)
  })

  // Clean up storage after transcription
  supabase.storage.from('recordings').remove([fileName]).catch(() => {})

  const transcribeData = await transcribeRes.json()
  const transcript: string = transcribeData.transcript

  if (!transcript) {
    throw new Error('Transcription returned an empty transcript.')
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
      fetch('/api/ai/extract', {
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
      fetch('/api/ai/summarize', {
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
