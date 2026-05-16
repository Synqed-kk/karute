// Deepgram pre-recorded transcription wrapper.
// Replaces OpenAI Whisper / gpt-4o-mini-transcribe for /api/ai/transcribe.
//
// Docs: https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded
//
// Why nova-3: it's Deepgram's flagship model and the only one they call out as
// "industry-leading" for Japanese (`ja`). Nova-2 supports `ja` but is
// positioned as a fallback. Whisper is available but not their preferred path.

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen'

export interface DeepgramTranscribeOptions {
  /** BCP-47 language tag. Default 'ja'. */
  language?: 'ja' | 'en'
  /** Deepgram model. Defaults to nova-3 (best quality for ja). */
  model?: string
  /** MIME type of the audio body; passed as Content-Type. */
  mimeType: string
  /** Ask Deepgram to return speaker labels in word[].speaker. */
  diarize?: boolean
}

export interface DeepgramTranscribeUrlOptions {
  language?: 'ja' | 'en'
  model?: string
  diarize?: boolean
}

export interface DeepgramWord {
  word: string
  start: number
  end: number
  confidence: number
  /** Only present when `diarize=true`. 0-indexed speaker label. */
  speaker?: number
}

export interface DeepgramParagraph {
  speaker: number
  start: number
  end: number
  text: string
}

export interface DeepgramTranscribeResult {
  /** Plain-text transcript from the first channel + first alternative. */
  transcript: string
  /** Total audio duration in seconds, per Deepgram metadata. */
  durationSec: number
  /** Deepgram-side request id (useful for support tickets). */
  requestId: string
  /** Alternative-level confidence (0–1). */
  confidence: number
  /** Word-level timing + (when diarized) speaker. */
  words: DeepgramWord[]
  /**
   * Speaker-labeled paragraphs. Only populated when `diarize=true` was
   * requested. Useful for rendering "Staff / Customer" turn-taking in the
   * karute detail transcript card.
   */
  paragraphs: DeepgramParagraph[]
}

interface DeepgramApiResponse {
  metadata?: {
    request_id?: string
    duration?: number
  }
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string
        confidence?: number
        words?: Array<{
          word?: string
          start?: number
          end?: number
          confidence?: number
          speaker?: number
        }>
        paragraphs?: {
          paragraphs?: Array<{
            speaker?: number
            start?: number
            end?: number
            sentences?: Array<{ text?: string }>
          }>
        }
      }>
    }>
  }
}

function buildDeepgramUrl(opts: {
  model?: string
  language?: 'ja' | 'en'
  diarize?: boolean
}): string {
  const params = new URLSearchParams({
    model: opts.model ?? 'nova-3',
    language: opts.language ?? 'ja',
    smart_format: 'true',
    punctuate: 'true',
  })
  if (opts.diarize) params.set('diarize', 'true')
  return `${DEEPGRAM_URL}?${params.toString()}`
}

async function parseDeepgram(res: Response): Promise<DeepgramTranscribeResult> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `Deepgram ${res.status} ${res.statusText}: ${body.slice(0, 240)}`,
    )
  }
  const data = (await res.json()) as DeepgramApiResponse
  const alt = data.results?.channels?.[0]?.alternatives?.[0]
  const transcript = alt?.transcript ?? ''

  const words: DeepgramWord[] = (alt?.words ?? []).map((w) => ({
    word: w.word ?? '',
    start: w.start ?? 0,
    end: w.end ?? 0,
    confidence: w.confidence ?? 0,
    speaker: w.speaker,
  }))

  const paragraphs: DeepgramParagraph[] = (alt?.paragraphs?.paragraphs ?? [])
    .map((p) => ({
      speaker: p.speaker ?? 0,
      start: p.start ?? 0,
      end: p.end ?? 0,
      text: (p.sentences ?? [])
        .map((s) => s.text ?? '')
        .filter(Boolean)
        .join(' '),
    }))
    .filter((p) => p.text.length > 0)

  return {
    transcript,
    durationSec: data.metadata?.duration ?? 0,
    requestId: data.metadata?.request_id ?? '',
    confidence: alt?.confidence ?? 0,
    words,
    paragraphs,
  }
}

function requireApiKey(): string {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY env var is not set')
  return apiKey
}

/**
 * Transcribe raw audio bytes. Use this for small files uploaded via FormData
 * directly from the browser — anything bigger should go through Supabase
 * Storage + `transcribeUrlWithDeepgram` to avoid double-streaming through our
 * serverless function.
 */
export async function transcribeWithDeepgram(
  audio: Buffer | Uint8Array,
  opts: DeepgramTranscribeOptions,
): Promise<DeepgramTranscribeResult> {
  const apiKey = requireApiKey()
  const url = buildDeepgramUrl(opts)

  // Node's Buffer + the narrowed Uint8Array<ArrayBufferLike> don't satisfy
  // lib-dom's BodyInit / BlobPart unions (those expect Uint8Array<ArrayBuffer>,
  // not <ArrayBufferLike>). Wrap in a Blob; the cast is safe at runtime — the
  // BlobPart constructor accepts any TypedArray view including Node Buffers.
  const body = new Blob([audio as unknown as BlobPart], { type: opts.mimeType })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': opts.mimeType,
    },
    body,
  })

  return parseDeepgram(res)
}

/**
 * Transcribe audio hosted at a public (or signed) URL. Deepgram pulls the
 * file directly — saves us a Vercel function from downloading and re-uploading
 * the recording. Supabase Storage signed URLs work fine; the URL just needs
 * to be reachable from Deepgram's side for the lifetime of the request.
 */
export async function transcribeUrlWithDeepgram(
  audioUrl: string,
  opts: DeepgramTranscribeUrlOptions = {},
): Promise<DeepgramTranscribeResult> {
  const apiKey = requireApiKey()
  const url = buildDeepgramUrl(opts)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: audioUrl }),
  })

  return parseDeepgram(res)
}
