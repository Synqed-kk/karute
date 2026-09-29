// The ONE home for the audio container magic bytes (S60 A0). Pure,
// dependency-free and client-safe: the staff-voice route uses it today, the
// finalize guard and the meter use it next, and the phone bundles it later —
// one table, so a container is never recognised in one place and refused in
// another.
//
// The sniff answers only WHICH container the bytes present open with. It never
// decides policy: a caller keeps its own accepted set (the voice route takes
// WebM + MP4 only) and its own length floor. It is never keyed on a file
// extension either — older `.webm` keys can hold MP4 bytes, so the head is the
// only truth about what an object is.
//
// A signature matches only when every one of its bytes is present: a head too
// short to hold a signature does not match it, it answers `unknown`.

export type ContainerKind = 'webm' | 'mp4' | 'ogg' | 'wav'

export type SniffResult = {
  kind: ContainerKind | 'unknown'
  /** head[0], or -1 when the head is empty. A number, never the bytes. */
  firstByte: number
  bytesRead: number
}

type SignaturePart = { readonly offset: number; readonly bytes: readonly number[] }

const ascii = (s: string): readonly number[] => Array.from(s, (c) => c.charCodeAt(0))

/** Every container the recorders can negotiate (webm → mp4 → ogg → wav), each
 *  with ALL the parts that must be present for a match. Frozen, exported so
 *  the totality test pins it against the grammar's MIME map and the
 *  recorders' negotiated lists. */
export const CONTAINER_SIGNATURES: Readonly<Record<ContainerKind, readonly SignaturePart[]>> = Object.freeze({
  // EBML header magic at 0 (WebM — Chrome/Firefox/Android).
  webm: [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }],
  // ISO-BMFF `ftyp` box type at 4 (MP4/M4A — Safari/iOS). Needs 8 bytes.
  mp4: [{ offset: 4, bytes: ascii('ftyp') }],
  // Ogg page capture pattern at 0.
  ogg: [{ offset: 0, bytes: ascii('OggS') }],
  // RIFF chunk at 0 AND the WAVE form type at 8. Needs 12 bytes.
  wav: [
    { offset: 0, bytes: ascii('RIFF') },
    { offset: 8, bytes: ascii('WAVE') },
  ],
})

/** The container each recording extension names. The grammar's MIME map
 *  (key-grammar.ts MIME_TO_EXT) must resolve through this to a kind with a
 *  signature — the totality test fails the day a MIME is added without one.
 *  Informational only: the verdict never reads the extension. */
export const CONTAINER_KIND_BY_EXT: Readonly<Record<string, ContainerKind>> = Object.freeze(
  Object.assign(Object.create(null), {
    webm: 'webm',
    mp4: 'mp4',
    ogg: 'ogg',
    wav: 'wav',
  }),
)

const KINDS = Object.keys(CONTAINER_SIGNATURES) as ContainerKind[]

function partPresent(head: Uint8Array, part: SignaturePart): boolean {
  if (head.length < part.offset + part.bytes.length) return false
  for (let i = 0; i < part.bytes.length; i++) {
    if (head[part.offset + i] !== part.bytes[i]) return false
  }
  return true
}

/** Which container the bytes present open with. Pure; never throws. */
export function sniffContainer(head: Uint8Array): SniffResult {
  const firstByte = head.length > 0 ? head[0] : -1
  for (const kind of KINDS) {
    if (CONTAINER_SIGNATURES[kind].every((part) => partPresent(head, part))) {
      return { kind, firstByte, bytesRead: head.length }
    }
  }
  return { kind: 'unknown', firstByte, bytesRead: head.length }
}

// ── The byte-bounded head probe (S60 A1) ─────────────────────────────────────
//
// Reads at most PROBE_HEAD_BYTES of a stored object through its signed URL and
// answers what the head says. Tri-state, and only `unreadable` is a verdict:
//   - `readable`   — at least PROBE_MIN_HEAD_BYTES held and the head opens with
//                    a known container.
//   - `unreadable` — at least PROBE_MIN_HEAD_BYTES held and the head matches
//                    NONE of the containers the recorders negotiate.
//   - `unknown`    — anything else (a throw, the timeout, a non-2xx, no body,
//                    a head too short to judge). Never a refusal: the caller
//                    answers what it answers today.
// The verdict is never keyed on the extension. The probe never throws.

/** The ranged GET asks for bytes 0..63 — enough for every signature above
 *  (the longest ends at byte 12) with room to spare. */
export const PROBE_HEAD_BYTES = 64

/** Fewer bytes than this and the head is too short to be judged unreadable:
 *  the longest signature (WAV: RIFF@0 + WAVE@8) needs 12. */
export const PROBE_MIN_HEAD_BYTES = 12

/** Same value as RESERVE_HEAD_TIMEOUT_MS (transcribe.ts); one storage class,
 *  one patience. Two named constants, cross-referenced: this module is
 *  client-safe and must not import the server-only meter. */
export const PROBE_HEAD_TIMEOUT_MS = 10_000

const PROBE_RANGE = `bytes=0-${PROBE_HEAD_BYTES - 1}`
const HTTP_PARTIAL_CONTENT = 206
const HTTP_OK = 200

export type ProbeResult =
  | { state: 'readable'; kind: ContainerKind }
  | { state: 'unreadable'; firstByte: number; bytesRead: number }
  | { state: 'unknown'; reason: string; bytesRead?: number }

/** Probe the head of the object behind `signedUrl`. 206 (Range honoured) and
 *  200 (Range ignored, the whole object streams) are both accepted: either
 *  way the body is read from its stream only until PROBE_MIN_HEAD_BYTES are
 *  held (or it ends), then the reader is cancelled — the body is never
 *  buffered whole. The guarantee is on what is EXAMINED (at most
 *  PROBE_HEAD_BYTES), not on transport bytes: a platform may deliver a first
 *  chunk of any size (REV 2.3 A4'). The timeout bounds every read as well as
 *  the fetch, so a stalled body answers `unknown`. */
export async function probeObjectHead(
  signedUrl: string,
  opts?: { timeoutMs?: number },
): Promise<ProbeResult> {
  const timeoutMs = opts?.timeoutMs ?? PROBE_HEAD_TIMEOUT_MS
  const signal = AbortSignal.timeout(timeoutMs)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const res = await fetch(signedUrl, {
      headers: { Range: PROBE_RANGE },
      signal,
    })
    if (res.status !== HTTP_PARTIAL_CONTENT && res.status !== HTTP_OK) {
      res.body?.cancel().catch(() => {})
      return { state: 'unknown', reason: `http_${res.status}` }
    }
    if (!res.body) return { state: 'unknown', reason: 'no_body' }

    // A fixed PROBE_HEAD_BYTES buffer: each chunk is copied in only up to the
    // room left, so what the probe holds never exceeds PROBE_HEAD_BYTES.
    const head = new Uint8Array(PROBE_HEAD_BYTES)
    let held = 0
    reader = res.body.getReader()
    const timedOut = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    timedOut.catch(() => {})
    let ended = false
    while (held < PROBE_MIN_HEAD_BYTES) {
      const { done, value } = await Promise.race([reader.read(), timedOut])
      if (done) {
        ended = true
        break
      }
      const take = Math.min(value.length, PROBE_HEAD_BYTES - held)
      head.set(value.subarray(0, take), held)
      held += take
    }
    if (!ended) reader.cancel().catch(() => {})

    if (held < PROBE_MIN_HEAD_BYTES) return { state: 'unknown', reason: 'short_head', bytesRead: held }
    // The sniff receives at most PROBE_HEAD_BYTES (64): `held` never exceeds the buffer.
    const sniff = sniffContainer(head.subarray(0, held))
    if (sniff.kind !== 'unknown') return { state: 'readable', kind: sniff.kind }
    return { state: 'unreadable', firstByte: sniff.firstByte, bytesRead: sniff.bytesRead }
  } catch (err) {
    reader?.cancel().catch(() => {})
    // A DOMException (the timeout) is not always `instanceof Error` across
    // realms, so read its name directly.
    const name = (err as { name?: unknown } | null)?.name
    return { state: 'unknown', reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'fetch_failed' }
  }
}
