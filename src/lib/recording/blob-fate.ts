// ONE verdict on a whole blob (build 32, PR-B commit 2 — B1, B7, R-2).
//
// A blob the phone cannot vouch for must never seal the write-once take key
// and must never be transcribed as complete. Two facts decide, once per whole
// blob, before any door is chosen: the head (the SAME sniff the server's
// finalize probe uses — container-sniff.ts is the one shared home, B-S66-7)
// and the size against the bytes the recorder put on disk
// (TakeMeta.bytesEmitted, B6). The verdict is APPLIED only at a write-once
// door (secure-take.ts's secureBlob, ai-pipeline.ts's server-named fallback);
// the staged door is the destination for a damaged blob and never refuses it.
//
// The seg/ uploader and the memory pump's slices are EXCLUDED by name: a
// seq>0 slice has no container head.

import { PROBE_MIN_HEAD_BYTES, sniffContainer } from '@/lib/recording/container-sniff'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { AUDIO_PARTIAL, AUDIO_UNREADABLE } from '@/lib/recording/job-errors'

export type BlobFate = 'ok' | 'partial' | 'unreadable'

/** Pure. `head` null = unknown (too short, or the read threw) → never a
 *  refusal (B7). `bytesEmitted` undefined = a reload lost the count → no
 *  partial claim. A take whose tail never landed is partial by its own mark. */
export function decideBlobFate(facts: {
  head: Uint8Array | null
  size: number
  bytesEmitted?: number
  tailIncomplete?: boolean
}): BlobFate {
  if (facts.head && facts.head.length >= PROBE_MIN_HEAD_BYTES && sniffContainer(facts.head).kind === 'unknown')
    return 'unreadable'
  if (facts.tailIncomplete) return 'partial'
  if (facts.bytesEmitted !== undefined && facts.size < facts.bytesEmitted) return 'partial'
  return 'ok'
}

/** The first PROBE_MIN_HEAD_BYTES of the blob, or null: a blob shorter than
 *  that is unknown, and a head read that throws is unknown — never `network`. */
export async function readBlobHead(blob: Blob): Promise<Uint8Array | null> {
  if (blob.size < PROBE_MIN_HEAD_BYTES) return null
  try {
    return new Uint8Array(await blob.slice(0, PROBE_MIN_HEAD_BYTES).arrayBuffer())
  } catch {
    return null
  }
}

/** The verdict for a whole blob; `stagedPartialDoor` OFF = always 'ok' (today). */
export async function blobFate(
  blob: Blob,
  facts: { bytesEmitted?: number; tailIncomplete?: boolean } = {},
): Promise<BlobFate> {
  if (!RECORDING_SWITCHES.stagedPartialDoor) return 'ok'
  return decideBlobFate({ head: await readBlobHead(blob), size: blob.size, ...facts })
}

/** The take's `secureError` for a damaged verdict (DAMAGED_SECURE_CODES). */
export function damagedSecureCode(fate: Exclude<BlobFate, 'ok'>): typeof AUDIO_UNREADABLE | typeof AUDIO_PARTIAL {
  return fate === 'unreadable' ? AUDIO_UNREADABLE : AUDIO_PARTIAL
}

/** The THIN staged door's one typed refusal (B-S66-5). A caller reads `.code`,
 *  never the message — a string is not a contract. `status` is the HTTP status
 *  where there was one, else 0. The message stays the sentence it always was. */
export class StagedDoorError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = 'StagedDoorError'
    this.code = code
    this.status = status
  }
}
