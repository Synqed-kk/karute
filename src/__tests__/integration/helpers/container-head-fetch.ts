// A `fetch` stand-in for the S60 head probe (container-sniff.ts#probeObjectHead)
// — answers ONLY a ranged GET (the probe's `Range: bytes=0-63`), so a suite's
// other fetches can never be handed a container head by accident.

/** A real WebM (EBML) head: `1A 45 DF A3` at 0, then the EBML header's first
 *  elements — what every good MediaRecorder webm take starts with. */
export const WEBM_HEAD = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42,
])

/** The field object's head (La Estro 9/29): 14 bytes, no container signature. */
export const HEADERLESS_HEAD = new Uint8Array(14)

function rangeOf(init?: RequestInit): string | undefined {
  const h = init?.headers
  if (!h) return undefined
  if (h instanceof Headers) return h.get('Range') ?? undefined
  return (h as Record<string, string>).Range
}

/** Answer the ranged probe GET with `status` and `head`; anything else throws. */
export function rangedHeadFetch(status: number, head: Uint8Array) {
  return async (_url: unknown, init?: RequestInit): Promise<Response> => {
    if (!rangeOf(init)) throw new Error('container-head-fetch: only the ranged probe GET is answered')
    return new Response(head.slice(), { status })
  }
}
