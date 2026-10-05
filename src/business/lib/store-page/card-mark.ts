// The card mark (D-LOGO, DECISIONS-S49) — ONE square mark per business, shown exactly as uploaded.
// Pure checks only: CORE-55's technical rules and nothing else (no transparency rule, no colour rule).
// The file's name and its MIME type never decide the format; the first bytes do.
// Every refusal string is COPY-S49 verbatim (R82): L1 type · L2 file size · L3 square · L4 too small · L5 too large.

export type MarkFormat = 'png' | 'jpeg' | 'webp'
export type MarkRefusal = 'type' | 'bytes' | 'square' | 'small' | 'large'
export type Mark = { url: string; width: number; height: number }
// ⚖ S64 R239 — a refusal and the owner's remove are different events; a refused pick must never become a saved removal.
export type MarkEvent = { cause: 'picked'; mark: Mark } | { cause: 'removed' } | { cause: 'refused'; why: MarkRefusal }

/** ≤ 2 MB (CORE-55), R192: the stricter reading of 「2MB以下」 — 2 000 000 bytes is accepted, one byte more is
 *  refused, so a file we accept is never over core's limit whichever unit core means. */
export const MARK_MAX_BYTES = 2_000_000
export const MARK_MIN_PX = 256
export const MARK_MAX_PX = 2048
/** Square within ±1 px: 512×511 passes, 512×510 does not. */
export const MARK_SQUARE_SLACK = 1
/** How many leading bytes the format check needs (WebP's tag sits at 8-11). */
export const MARK_HEAD_BYTES = 12

export const MARK_REFUSAL: Readonly<Record<MarkRefusal, string>> = {
  type: 'このファイル形式には対応していません。PNG・JPEG・WebP形式の画像を選んでください。', // COPY-S49 L1
  bytes: 'ファイルサイズが大きすぎます。2MB以下の画像を選んでください。', // COPY-S49 L2
  square: 'この画像は正方形ではありません。正方形（縦と横が同じ長さ）の画像を選んでください。', // COPY-S49 L3
  small: '画像が小さすぎます。縦横256px以上の画像を選んでください。', // COPY-S49 L4
  large: '画像が大きすぎます。縦横2048px以下の画像を選んでください。', // COPY-S49 L5
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

function startsWith(head: Uint8Array, sig: ReadonlyArray<number>, at = 0): boolean {
  if (head.length < at + sig.length) return false
  return sig.every((b, i) => head[at + i] === b)
}

/** The format the bytes prove, or null. */
export function sniffMarkFormat(head: Uint8Array): MarkFormat | null {
  if (startsWith(head, PNG)) return 'png'
  if (startsWith(head, JPEG)) return 'jpeg'
  if (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) return 'webp'
  return null
}

/** The checks that need no decoding: format by magic bytes, then the byte size. */
export function checkMarkFile(head: Uint8Array, byteSize: number): MarkRefusal | null {
  if (sniffMarkFormat(head) === null) return 'type'
  if (byteSize > MARK_MAX_BYTES) return 'bytes'
  return null
}

/** The checks on the decoded pixel size: square ±1 px, then 256–2048 px on both sides. */
export function checkMarkSize(width: number, height: number): MarkRefusal | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'type'
  if (Math.abs(width - height) > MARK_SQUARE_SLACK) return 'square'
  if (Math.min(width, height) < MARK_MIN_PX) return 'small'
  if (Math.max(width, height) > MARK_MAX_PX) return 'large'
  return null
}
