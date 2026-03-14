// ---------------------------------------------------------------------------
// Avatar color palette (pastel, designed for dark backgrounds)
// ---------------------------------------------------------------------------

const AVATAR_PALETTE: Array<{ bg: string; text: string }> = [
  { bg: 'bg-blue-400/20',   text: 'text-blue-300' },   // pastel blue
  { bg: 'bg-pink-400/20',   text: 'text-pink-300' },   // pastel pink
  { bg: 'bg-green-400/20',  text: 'text-green-300' },  // pastel green
  { bg: 'bg-yellow-400/20', text: 'text-yellow-300' }, // pastel yellow
  { bg: 'bg-purple-400/20', text: 'text-purple-300' }, // pastel purple
  { bg: 'bg-orange-400/20', text: 'text-orange-300' }, // pastel coral/orange
  { bg: 'bg-teal-400/20',   text: 'text-teal-300' },   // pastel teal
  { bg: 'bg-indigo-400/20', text: 'text-indigo-300' }, // pastel lavender/indigo
  { bg: 'bg-rose-400/20',   text: 'text-rose-300' },   // pastel rose
  { bg: 'bg-cyan-400/20',   text: 'text-cyan-300' },   // pastel cyan
]

/**
 * Hashes a UUID string to a stable integer using a simple djb2-style algorithm.
 * Pure function — same input always returns same output (no randomness).
 */
function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
    // Keep as 32-bit integer
    hash = hash | 0
  }
  return Math.abs(hash)
}

/**
 * Returns a deterministic pastel avatar color pair for a given customer UUID.
 *
 * Per user decision: colors must be consistent per customer — not random on each
 * render. This function is a pure hash-based selection from a fixed palette.
 *
 * Returns Tailwind class strings for use in className attributes.
 */
export function getAvatarColor(customerId: string): { bg: string; text: string } {
  const index = hashString(customerId) % AVATAR_PALETTE.length
  return AVATAR_PALETTE[index]
}

// ---------------------------------------------------------------------------
// Initials extraction
// ---------------------------------------------------------------------------

/**
 * Unicode CJK ranges:
 * - CJK Unified Ideographs: U+4E00–U+9FFF
 * - CJK Extension A: U+3400–U+4DBF
 * - Katakana: U+30A0–U+30FF
 * - Hiragana: U+3040–U+309F
 * - Katakana Phonetic Extensions: U+31F0–U+31FF
 * - CJK Compatibility Ideographs: U+F900–U+FAFF
 */
const CJK_REGEX = /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

function isCJK(str: string): boolean {
  return CJK_REGEX.test(str)
}

/**
 * Returns initials for display in the avatar circle.
 *
 * - Latin names: first letter of first two words (e.g. "John Smith" → "JS")
 * - CJK names: first 1–2 characters (e.g. "田中太郎" → "田中")
 * - Single-word names: first two characters regardless of script
 * - Empty/whitespace: "?" fallback
 */
export function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'

  if (isCJK(trimmed)) {
    // For CJK names, take first 2 characters
    return trimmed.slice(0, 2)
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 1) {
    // Single word — take first two characters, uppercase
    return words[0].slice(0, 2).toUpperCase()
  }

  // Multiple words — first letter of first two words
  return (words[0][0] + words[1][0]).toUpperCase()
}
