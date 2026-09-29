// S60 A0 — the shared container sniff (src/lib/recording/container-sniff.ts).
// Pins:
//   - the signature table: webm · mp4 · ogg · wav heads each answer their kind;
//     a signature whose full length is not present never matches
//   - firstByte is head[0] (a number, -1 when empty), bytesRead the head length
//   - TOTALITY: every MIME the key grammar admits (MIME_TO_EXT) and every MIME
//     the two recorders negotiate resolves to a kind that has a signature —
//     adding a MIME without a signature fails here
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONTAINER_KIND_BY_EXT,
  CONTAINER_SIGNATURES,
  sniffContainer,
  type ContainerKind,
} from '@/lib/recording/container-sniff'
import { MIME_TO_EXT } from '@/lib/recording/key-grammar'

const bytes = (...xs: number[]) => new Uint8Array(xs)
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

// Real container heads, typed out here (not derived from the table under test).
const WEBM_HEAD = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81)
const MP4_HEAD = bytes(0, 0, 0, 0x1c, ...ascii('ftypM4A '))
const OGG_HEAD = bytes(...ascii('OggS'), 0, 2, 0, 0, 0, 0, 0, 0)
const WAV_HEAD = bytes(...ascii('RIFF'), 0x24, 0x08, 0, 0, ...ascii('WAVE'))
// A mid-cluster WebM SimpleBlock (element id 0xA3) — what a tail-only object
// opens with when the EBML header was lost.
const SIMPLEBLOCK_HEAD = bytes(0xa3, 0x42, 0x8f, 0x81, 0x00, 0x00, 0x80, 0xfc, 0xff, 0xfe, 0x11, 0x22)

describe('sniffContainer — the signature table', () => {
  it.each([
    ['webm head', WEBM_HEAD, 'webm'],
    ['mp4 head', MP4_HEAD, 'mp4'],
    ['ogg head', OGG_HEAD, 'ogg'],
    ['wav head', WAV_HEAD, 'wav'],
    ['SimpleBlock head (0xA3 first)', SIMPLEBLOCK_HEAD, 'unknown'],
    ['empty head', bytes(), 'unknown'],
    ['3-byte 1A 45 DF', bytes(0x1a, 0x45, 0xdf), 'unknown'],
    ['RIFF + 8 bytes without WAVE', bytes(...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('AVI ')), 'unknown'],
    ['RIFF with WAVE cut to 11 bytes', WAV_HEAD.subarray(0, 11), 'unknown'],
    ['ftyp@4 with only 7 bytes', bytes(0, 0, 0, 0x1c, ...ascii('fty')), 'unknown'],
    ['14 zero bytes', new Uint8Array(14), 'unknown'],
  ] as Array<[string, Uint8Array, ContainerKind | 'unknown']>)('%s → %s', (_name, head, kind) => {
    const r = sniffContainer(head)
    expect(r.kind).toBe(kind)
    expect(r.bytesRead).toBe(head.length)
  })

  it('a WebM head of exactly 4 bytes and an MP4 head of exactly 8 bytes match (the full signature is present)', () => {
    expect(sniffContainer(WEBM_HEAD.subarray(0, 4)).kind).toBe('webm')
    expect(sniffContainer(MP4_HEAD.subarray(0, 8)).kind).toBe('mp4')
    expect(sniffContainer(WAV_HEAD.subarray(0, 12)).kind).toBe('wav')
  })

  it('firstByte is -1 for an empty head', () => {
    expect(sniffContainer(bytes())).toEqual({ kind: 'unknown', firstByte: -1, bytesRead: 0 })
  })

  it('firstByte is reported for a refused head — a number, never the bytes', () => {
    expect(sniffContainer(SIMPLEBLOCK_HEAD)).toEqual({ kind: 'unknown', firstByte: 0xa3, bytesRead: 12 })
    expect(sniffContainer(new Uint8Array(14))).toEqual({ kind: 'unknown', firstByte: 0, bytesRead: 14 })
  })

  it('firstByte is reported for a matched head too', () => {
    expect(sniffContainer(WEBM_HEAD).firstByte).toBe(0x1a)
    expect(sniffContainer(OGG_HEAD).firstByte).toBe(0x4f)
  })
})

describe('sniffContainer — totality against the grammar and the recorders', () => {
  /** A MIME resolves: base type → the grammar's extension → a container kind
   *  whose signature table is non-empty and sniffs back to that kind. */
  function expectSniffable(mime: string) {
    const base = mime.split(';')[0].trim()
    const ext = MIME_TO_EXT[base]
    expect({ mime, ext }).toEqual({ mime, ext: expect.any(String) })
    const kind = CONTAINER_KIND_BY_EXT[ext]
    expect({ mime, kind }).toEqual({ mime, kind: expect.any(String) })
    const sig = CONTAINER_SIGNATURES[kind]
    expect(sig.length).toBeGreaterThan(0)
    const len = Math.max(...sig.map((p) => p.offset + p.bytes.length))
    const head = new Uint8Array(len)
    for (const p of sig) head.set(p.bytes, p.offset)
    expect(sniffContainer(head).kind).toBe(kind)
  }

  it('every MIME the key grammar admits (MIME_TO_EXT) has a signature', () => {
    const mimes = Object.keys(MIME_TO_EXT)
    expect(mimes.length).toBeGreaterThan(0)
    for (const mime of mimes) expectSniffable(mime)
  })

  // The recorders' negotiated lists are function-local consts in 'use client'
  // modules (global-recorder.ts is thin-bundled); exporting them would change
  // bundled code, so the list is read from the source instead — the same
  // source-pin idiom other suites use. A MIME added there without a signature
  // fails here.
  it.each([
    ['src/lib/global-recorder.ts'],
    ['src/hooks/use-media-recorder.ts'],
  ])('every MIME %s negotiates has a signature', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8')
    const fn = src.slice(src.indexOf('function getSupportedMimeType'))
    const list = /const formats = \[([\s\S]*?)\]/.exec(fn)
    expect(list).not.toBeNull()
    const mimes = Array.from(list![1].matchAll(/'([^']+)'/g), (m) => m[1])
    expect(mimes.length).toBeGreaterThanOrEqual(4)
    for (const mime of mimes) expectSniffable(mime)
  })
})
