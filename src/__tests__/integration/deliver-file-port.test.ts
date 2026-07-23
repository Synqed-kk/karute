/**
 * @jest-environment jsdom
 *
 * DataPort.deliverFile (design-parity packet 23, /data-export port). jsdom
 * has no URL.createObjectURL and no navigator.share/canShare — both defined/
 * restored per test/suite so a missing stub doesn't silently no-op instead
 * of exercising the real branch.
 */
// jsdom's own Blob polyfill has no .text()/.arrayBuffer() — Node's real Blob
// (node:buffer, spec-complete) is what real browsers behave like; used for
// TEST fixtures only, deliverFile itself never constructs a Blob.
import { Blob as NodeBlob } from 'node:buffer'
import { sameOriginDataPort } from '@/lib/ports/data-port'
// deliver-file.vite.ts, NOT data.vite.ts — that file imports ../env, which
// reads import.meta.env; jest cannot parse import.meta at all (thin-port-
// contract.test.ts's header comment). deliverFile lives in the import.meta-
// free sibling module for exactly this reason.
import { deliverFile as viteDeliverFile } from '../../../thin/ports/deliver-file.vite'

// Node's Blob type isn't structurally identical to lib.dom's (bytes()
// return type) — one cast lives here instead of at every call site.
function testBlob(parts: string[], options: { type: string }): Blob {
  return new NodeBlob(parts, options) as unknown as Blob
}

describe('sameOriginDataPort.deliverFile (web) — the anchor-click block moved out of DataExportView', () => {
  let createObjectURL: jest.Mock
  let clickSpy: jest.SpyInstance

  beforeEach(() => {
    createObjectURL = jest.fn(() => 'blob:mock-url')
    // jsdom has no createObjectURL implementation — stub it (packet's own
    // "Object-URL lifecycle stays as-is on web" note assumes a real browser).
    ;(URL as unknown as { createObjectURL: jest.Mock }).createObjectURL = createObjectURL
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    clickSpy.mockRestore()
  })

  it('creates an object URL, sets href/download, appends+clicks+removes the anchor, and resolves "downloaded"', async () => {
    const blob = testBlob(['a,b\n1,2'], { type: 'text/csv' })
    const result = await sameOriginDataPort.deliverFile(blob, 'customers_2026_07_23.csv')

    expect(result).toBe('downloaded')
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    // The anchor is removed after the click — nothing lingers in the DOM.
    expect(document.querySelector('a[download]')).toBeNull()
  })
})

describe('deliverFile (thin, deliver-file.vite.ts) — Web Share API level 2 with a clipboard fallback', () => {
  const blob = testBlob(['a,b\n1,2'], { type: 'text/csv' })
  let originalShare: unknown
  let originalCanShare: unknown
  let originalClipboard: unknown

  beforeEach(() => {
    originalShare = (navigator as unknown as { share?: unknown }).share
    originalCanShare = (navigator as unknown as { canShare?: unknown }).canShare
    originalClipboard = (navigator as unknown as { clipboard?: unknown }).clipboard
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'share', { value: originalShare, configurable: true })
    Object.defineProperty(navigator, 'canShare', { value: originalCanShare, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true })
  })

  it('share happy path → "shared", never touches the clipboard', async () => {
    const share = jest.fn(async () => {})
    const writeText = jest.fn(async () => {})
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const result = await viteDeliverFile(blob, 'customers.csv')

    expect(result).toBe('shared')
    expect(share).toHaveBeenCalledTimes(1)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('AbortError (user closed the share sheet) → "shared", silent — no throw, no clipboard', async () => {
    const abort = Object.assign(new Error('closed'), { name: 'AbortError' })
    const share = jest.fn(async () => {
      throw abort
    })
    const writeText = jest.fn(async () => {})
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const result = await viteDeliverFile(blob, 'customers.csv')

    expect(result).toBe('shared')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('no canShare → clipboard fallback, "copied"', async () => {
    const writeText = jest.fn(async () => {})
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const result = await viteDeliverFile(blob, 'customers.csv')

    expect(result).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('a,b\n1,2')
  })

  it('canShare returns false → clipboard fallback, "copied"', async () => {
    const writeText = jest.fn(async () => {})
    const share = jest.fn(async () => {})
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const result = await viteDeliverFile(blob, 'customers.csv')

    expect(result).toBe('copied')
    expect(share).not.toHaveBeenCalled()
  })

  it('share throws a non-Abort error → falls through to the clipboard, "copied"', async () => {
    const share = jest.fn(async () => {
      throw new Error('share failed')
    })
    const writeText = jest.fn(async () => {})
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const result = await viteDeliverFile(blob, 'customers.csv')

    expect(result).toBe('copied')
  })

  it('both share and clipboard unavailable/failing → throws (view shows exportFailed)', async () => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn(async () => { throw new Error('clipboard denied') }) },
      configurable: true,
    })

    await expect(viteDeliverFile(blob, 'customers.csv')).rejects.toThrow('clipboard denied')
  })
})
