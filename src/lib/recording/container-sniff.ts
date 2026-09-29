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
