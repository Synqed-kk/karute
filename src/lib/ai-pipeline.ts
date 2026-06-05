import { Entry } from '@/types/ai'
import { createClient } from '@/lib/supabase/client'

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
 *   1. Transcribe audio blob via Whisper (/api/ai/transcribe)
 *   2. Run extraction and summary in parallel via Promise.all (/api/ai/extract + /api/ai/summarize)
 *
 * Calls onProgress at each stage so UI can show step-by-step progress.
 * Auto-retries each API call once on failure; throws on second failure.
 */
export async function runAIPipeline(
  audioBlob: Blob,
  locale: string,
  onProgress: (step: PipelineStep) => void,
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

  // Step 2: Parallel extraction and summary
  onProgress('extracting')

  const [extractRes, summarizeRes] = await Promise.all([
    fetchWithRetry(() =>
      fetch('/api/ai/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, locale }),
      }),
    ).catch((err) => {
      throw new Error(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`)
    }),
    fetchWithRetry(() =>
      fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, locale }),
      }),
    ).catch((err) => {
      throw new Error(`Summary generation failed: ${err instanceof Error ? err.message : String(err)}`)
    }),
  ])

  const extractData = await extractRes.json()
  const summarizeData = await summarizeRes.json()

  const entries: Entry[] = extractData.entries
  // The summary API now returns a bullet ARRAY (SummaryResultSchema). Join with
  // "\n" for the string `karute.summary` field; the karute-detail adapter splits
  // it back into bullets. Stay defensive about a legacy string response.
  const summary: string = Array.isArray(summarizeData.summary)
    ? summarizeData.summary.join('\n')
    : (summarizeData.summary ?? '')

  // Step 3: Complete
  onProgress('complete')

  return { transcript, entries, summary }
}
