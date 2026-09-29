// S60 A1 — the byte-bounded head probe (probeObjectHead in
// src/lib/recording/container-sniff.ts). Fetch is mocked with ReadableStream
// bodies. Pins:
//   - the request is a ranged GET: `Range: bytes=0-63`, with a timeout signal
//   - 206 and 200 are both accepted; a 200 streaming a whole 1 MB object is
//     read only until 64 bytes are held, then the reader is cancelled
//   - >= 12 bytes held + a known container → readable; + none → unreadable
//     (firstByte / bytesRead as numbers)
//   - < 12 bytes → unknown `short_head`; 416 / 404 / timeout / a throw → unknown
//   - the probe never throws
import {
  PROBE_HEAD_BYTES,
  PROBE_HEAD_TIMEOUT_MS,
  PROBE_MIN_HEAD_BYTES,
  probeObjectHead,
} from '@/lib/recording/container-sniff'

const bytes = (...xs: number[]) => new Uint8Array(xs)
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

// Real container heads, typed out here (not derived from the table under test).
const WEBM_HEAD = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42)
const OGG_HEAD_12 = bytes(...ascii('OggS'), 0, 2, 0, 0, 0, 0, 0, 0)

const URL_ = 'https://storage.test/object/sign/recordings/biz/take.webm?token=t'

/** A body served in `chunkSize` pieces, pulled only on demand (highWaterMark
 *  0), counting every byte handed to the reader and whether it was cancelled. */
function streamOf(data: Uint8Array, chunkSize = data.length) {
  const tally = { pulled: 0, cancelled: false }
  let at = 0
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (at >= data.length) {
          controller.close()
          return
        }
        const chunk = data.subarray(at, at + chunkSize)
        at += chunk.length
        tally.pulled += chunk.length
        controller.enqueue(chunk)
      },
      cancel() {
        tally.cancelled = true
      },
    },
    { highWaterMark: 0 },
  )
  return { body, tally }
}

const originalFetch = global.fetch
let fetchMock: jest.Mock

beforeEach(() => {
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})
afterAll(() => {
  global.fetch = originalFetch
})

function answer(status: number, data?: Uint8Array, chunkSize?: number) {
  const s = data ? streamOf(data, chunkSize) : undefined
  fetchMock.mockResolvedValueOnce(new Response(s?.body ?? null, { status }))
  return s?.tally
}

describe('probeObjectHead — the constants', () => {
  it('asks for 64 bytes, judges from 12, waits the reserve HEAD patience', () => {
    expect(PROBE_HEAD_BYTES).toBe(64)
    expect(PROBE_MIN_HEAD_BYTES).toBe(12)
    expect(PROBE_HEAD_TIMEOUT_MS).toBe(10_000)
  })
})

describe('probeObjectHead — the request', () => {
  it('is a GET carrying Range: bytes=0-63 and an abort signal', async () => {
    answer(206, WEBM_HEAD)
    await probeObjectHead(URL_)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(URL_)
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.headers).toEqual({ Range: 'bytes=0-63' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('probeObjectHead — readable / unreadable', () => {
  it('206 + a webm head → readable webm', async () => {
    answer(206, WEBM_HEAD)
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'readable', kind: 'webm' })
  })

  it('200 streaming a 1 MB object → readable, and the reader is cancelled after <= 64 bytes pulled', async () => {
    const big = new Uint8Array(1024 * 1024)
    big.set(WEBM_HEAD, 0)
    const tally = answer(200, big, 16)!
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'readable', kind: 'webm' })
    expect(tally.pulled).toBeLessThanOrEqual(64)
    expect(tally.pulled).toBe(64)
    expect(tally.cancelled).toBe(true)
  })

  it('200 whose single chunk is 1 MB → readable, cancelled, holds at most 64 bytes', async () => {
    const big = new Uint8Array(1024 * 1024)
    big.set(WEBM_HEAD, 0)
    const tally = answer(200, big)!
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'readable', kind: 'webm' })
    expect(tally.cancelled).toBe(true)
  })

  it('200 + 14 zero bytes → unreadable, firstByte 0, bytesRead 14', async () => {
    answer(200, new Uint8Array(14))
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unreadable', firstByte: 0, bytesRead: 14 })
  })

  it('a headerless 1 MB object → unreadable with bytesRead capped at 64', async () => {
    const big = new Uint8Array(1024 * 1024).fill(0xa3)
    answer(206, big, 10)
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unreadable', firstByte: 0xa3, bytesRead: 64 })
  })

  it('a body of exactly 12 bytes of ogg → readable ogg', async () => {
    answer(206, OGG_HEAD_12)
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'readable', kind: 'ogg' })
  })
})

describe('probeObjectHead — unknown (never a refusal)', () => {
  it('a body of 5 bytes → unknown short_head', async () => {
    answer(206, WEBM_HEAD.subarray(0, 5))
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unknown', reason: 'short_head' })
  })

  it('a body of 11 zero bytes → unknown short_head, not unreadable', async () => {
    answer(200, new Uint8Array(11))
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unknown', reason: 'short_head' })
  })

  it.each([416, 403, 404, 500, 503])('HTTP %i → unknown', async (status) => {
    answer(status, new Uint8Array(14))
    const r = await probeObjectHead(URL_)
    expect(r).toEqual({ state: 'unknown', reason: `http_${status}` })
  })

  it('2xx with no body → unknown', async () => {
    answer(206)
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unknown', reason: 'no_body' })
  })

  it('the timeout (AbortSignal) → unknown timeout', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
        }),
    )
    await expect(probeObjectHead(URL_, { timeoutMs: 5 })).resolves.toEqual({ state: 'unknown', reason: 'timeout' })
  })

  it('fetch throws → unknown fetch_failed', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unknown', reason: 'fetch_failed' })
  })

  it('the body stream errors mid-read → unknown, never a throw', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(WEBM_HEAD.subarray(0, 4))
        controller.error(new TypeError('terminated'))
      },
    })
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 206 }))
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unknown', reason: 'fetch_failed' })
  })
})
