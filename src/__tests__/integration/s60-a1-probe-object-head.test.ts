// S60 A1 — the byte-bounded head probe (probeObjectHead in
// src/lib/recording/container-sniff.ts). Fetch is mocked with ReadableStream
// bodies. Pins:
//   - the request is a ranged GET: `Range: bytes=0-63`, with a timeout signal
//   - 206 and 200 are both accepted; a 200 streaming a whole 1 MB object is
//     read only until >= 12 bytes are held (or it ends), then the reader is
//     cancelled; the examined head = the first min(held, 64) bytes (REV 2.3 A4')
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

  // REV 2.3 A4: the transport-byte count is not a guarantee and is no longer asserted.
  it('200 streaming a 1 MB object → readable, and the reader is cancelled once >= 12 bytes are held', async () => {
    const big = new Uint8Array(1024 * 1024)
    big.set(WEBM_HEAD, 0)
    const tally = answer(200, big, 16)!
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'readable', kind: 'webm' })
    expect(tally.cancelled).toBe(true)
  })

  it('200 whose single chunk is 1 MB → readable, cancelled, holds at most 64 bytes', async () => {
    const big = new Uint8Array(1024 * 1024)
    big.set(WEBM_HEAD, 0)
    const tally = answer(200, big)!
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'readable', kind: 'webm' })
    expect(tally.cancelled).toBe(true)
  })

  // S63 FIX-3 (codex 9): the 「at most 64 bytes」 bites — an UNREADABLE answer
  // carries bytesRead, so a mock handing over far more than 64 bytes in one
  // chunk must still report at most 64 examined, from a Range: bytes=0-63 request.
  it('200 whose single chunk is 1 MB of no container → unreadable, bytesRead <= 64, asked for bytes=0-63', async () => {
    const big = new Uint8Array(1024 * 1024).fill(0x07)
    const tally = answer(200, big)!
    const result = await probeObjectHead(URL_)
    expect(tally.pulled).toBeGreaterThan(64)
    expect(result).toEqual({ state: 'unreadable', firstByte: 0x07, bytesRead: 64 })
    expect((result as { bytesRead: number }).bytesRead).toBeLessThanOrEqual(64)
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Range: 'bytes=0-63' })
    expect(tally.cancelled).toBe(true)
  })

  it('200 + 14 zero bytes → unreadable, firstByte 0, bytesRead 14', async () => {
    answer(200, new Uint8Array(14))
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unreadable', firstByte: 0, bytesRead: 14 })
  })

  // REV 2.3 A4': 10-byte chunks → two reads hold 20 (>= 12), then cancel → bytesRead 20.
  it('a headerless 1 MB object in 10-byte chunks → unreadable, bytesRead 20', async () => {
    const big = new Uint8Array(1024 * 1024).fill(0xa3)
    answer(206, big, 10)
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unreadable', firstByte: 0xa3, bytesRead: 20 })
  })

  it('a body of exactly 12 bytes of ogg → readable ogg', async () => {
    answer(206, OGG_HEAD_12)
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'readable', kind: 'ogg' })
  })
})

describe('probeObjectHead — unknown (never a refusal)', () => {
  // S63 FIX-3 (Greptile thread 4): the probe never follows a redirect.
  it('a 302 with a Location → unknown redirect, one fetch, the Location never fetched', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: 'https://elsewhere.test/other-object' } }),
    )
    const result = await probeObjectHead(URL_)
    expect(result).toEqual({ state: 'unknown', reason: 'redirect' })
    expect((result as { bytesRead?: number }).bytesRead ?? null).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(URL_)
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual')
  })

  it('a body of 5 bytes → unknown short_head', async () => {
    answer(206, WEBM_HEAD.subarray(0, 5))
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unknown', reason: 'short_head', bytesRead: 5 })
  })

  it('a body of 11 zero bytes → unknown short_head, not unreadable', async () => {
    answer(200, new Uint8Array(11))
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unknown', reason: 'short_head', bytesRead: 11 })
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

// REV 2.3 A4/A4' — the honest guarantee: read until >= 12 bytes are HELD (or
// the stream ends), then cancel; EXAMINE the first min(held, 64) bytes, and
// bytesRead is that examined count. What a platform delivered in a read is not
// bounded. The sniff's input bound is asserted through bytesRead <= 64 on every
// answer that carries it.
function readerBody(chunks: Array<Uint8Array | 'hang'>, cancelImpl?: () => Promise<void>) {
  const tally = { reads: 0, cancelled: 0 }
  let i = 0
  const reader = {
    read: jest.fn(() => {
      tally.reads++
      const c = chunks[i++]
      if (c === 'hang') return new Promise<never>(() => {})
      return Promise.resolve(c ? { done: false, value: c } : { done: true, value: undefined })
    }),
    cancel: jest.fn(() => {
      tally.cancelled++
      return cancelImpl ? cancelImpl() : Promise.resolve()
    }),
    releaseLock: jest.fn(),
  }
  const res = { status: 206, body: { getReader: () => reader, cancel: () => Promise.resolve() } }
  return { res, tally }
}

/** Every non-short verdict that carries bytesRead examined 12..64 bytes. */
function expectExamined(r: Awaited<ReturnType<typeof probeObjectHead>>) {
  if (r.state !== 'unreadable') return
  expect(r.bytesRead).toBeGreaterThanOrEqual(PROBE_MIN_HEAD_BYTES)
  expect(r.bytesRead).toBeLessThanOrEqual(PROBE_HEAD_BYTES)
}

describe('probeObjectHead — REV 2.3 A4 read/cancel guarantee', () => {
  it('an oversized first chunk (1 MB in ONE read) → verdict from its head, exactly one read(), cancel() called', async () => {
    const big = new Uint8Array(1024 * 1024)
    big.set(WEBM_HEAD, 0)
    const { res, tally } = readerBody([big])
    fetchMock.mockResolvedValueOnce(res)
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'readable', kind: 'webm' })
    expect(tally.reads).toBe(1)
    expect(tally.cancelled).toBe(1)
  })

  it('a fragmented body (3 × 5-byte chunks, more behind) → reads until >= 12 bytes, then cancels', async () => {
    const z = () => new Uint8Array(5)
    const { res, tally } = readerBody([z(), z(), z(), z(), z(), z()])
    fetchMock.mockResolvedValueOnce(res)
    const r = await probeObjectHead(URL_)
    expect(r).toEqual({ state: 'unreadable', firstByte: 0, bytesRead: 15 })
    expectExamined(r)
    expect(tally.reads).toBe(3)
    expect(tally.cancelled).toBe(1)
  })

  it('a headerless 1 MB in ONE read → one read, cancel(), bytesRead 64', async () => {
    const { res, tally } = readerBody([new Uint8Array(1024 * 1024).fill(0xa3)])
    fetchMock.mockResolvedValueOnce(res)
    const r = await probeObjectHead(URL_)
    expect(r).toEqual({ state: 'unreadable', firstByte: 0xa3, bytesRead: 64 })
    expectExamined(r)
    expect(tally.reads).toBe(1)
    expect(tally.cancelled).toBe(1)
  })

  it('5 bytes then EOF → unknown short_head, bytesRead 5, nothing to cancel', async () => {
    const { res, tally } = readerBody([new Uint8Array(5)])
    fetchMock.mockResolvedValueOnce(res)
    await expect(probeObjectHead(URL_)).resolves.toEqual({ state: 'unknown', reason: 'short_head', bytesRead: 5 })
    expect(tally.reads).toBe(2)
    expect(tally.cancelled).toBe(0)
  })

  it('a reader that never resolves → the timeout fires → unknown timeout', async () => {
    const { res, tally } = readerBody([new Uint8Array(5), 'hang'])
    fetchMock.mockResolvedValueOnce(res)
    await expect(probeObjectHead(URL_, { timeoutMs: 5 })).resolves.toEqual({ state: 'unknown', reason: 'timeout' })
    expect(tally.reads).toBe(2)
  })

  it('cancel() rejecting → the verdict still returns', async () => {
    const big = new Uint8Array(1024 * 1024).fill(0xa3)
    const { res, tally } = readerBody([big], () => Promise.reject(new TypeError('cancel failed')))
    fetchMock.mockResolvedValueOnce(res)
    const r = await probeObjectHead(URL_)
    expect(r).toEqual({ state: 'unreadable', firstByte: 0xa3, bytesRead: 64 })
    expectExamined(r)
    expect(tally.cancelled).toBe(1)
  })
})
