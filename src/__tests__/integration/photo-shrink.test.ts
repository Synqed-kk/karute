/**
 * @jest-environment jsdom
 *
 * shrinkPhotoForUpload — client-side downscale before upload (core rejects
 * request bodies >= ~950KB, platform 503). Pins:
 *  - small files pass through untouched (same object, no re-encode);
 *  - big files walk the [maxEdge, quality] ladder and stop at the first
 *    blob <= PHOTO_UPLOAD_TARGET_BYTES;
 *  - createImageBitmap decode failure (desktop HEIC etc.) → original File;
 *  - canvas.toBlob yielding null → original File.
 */
import { PHOTO_UPLOAD_TARGET_BYTES, shrinkPhotoForUpload } from '@/lib/photo-shrink'

function fileOfSize(name: string, size: number, type = 'image/jpeg'): File {
  return new File([new Uint8Array(size)], name, { type })
}

function mockBitmap(width = 4000, height = 3000) {
  return { width, height, close: jest.fn() }
}

describe('shrinkPhotoForUpload', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns the same file object when already under target', async () => {
    const file = fileOfSize('small.png', PHOTO_UPLOAD_TARGET_BYTES - 1, 'image/png')
    const createImageBitmap = jest.fn()
    ;(globalThis as unknown as { createImageBitmap: typeof createImageBitmap }).createImageBitmap =
      createImageBitmap

    const result = await shrinkPhotoForUpload(file)

    // Boolean identity check, not expect(result).toBe(file) — jest's diff
    // printer on a failed File/Blob toBe() recurses into jsdom's internal
    // Blob handle and crashes the process (reproduced independent of file
    // size); this form fails cleanly with a readable message instead.
    expect(result === file).toBe(true)
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('walks the quality ladder and returns the first blob that fits, as a .jpg File', async () => {
    const big = fileOfSize('IMG_0001.HEIC', PHOTO_UPLOAD_TARGET_BYTES + 1_000)
    const bitmap = mockBitmap()
    ;(globalThis as unknown as { createImageBitmap: jest.Mock }).createImageBitmap = jest
      .fn()
      .mockResolvedValue(bitmap)

    const oversized = new Blob([new Uint8Array(PHOTO_UPLOAD_TARGET_BYTES + 1)], {
      type: 'image/jpeg',
    })
    const fits = new Blob([new Uint8Array(PHOTO_UPLOAD_TARGET_BYTES - 1)], {
      type: 'image/jpeg',
    })
    const toBlob = jest
      .fn()
      .mockImplementationOnce((cb: BlobCallback) => cb(oversized))
      .mockImplementationOnce((cb: BlobCallback) => cb(fits))
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob)
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: jest.fn(),
    } as unknown as CanvasRenderingContext2D)

    const result = await shrinkPhotoForUpload(big)

    expect(toBlob).toHaveBeenCalledTimes(2)
    // Pins the ladder actually steps DOWN quality per attempt — a mock that
    // ignores the quality arg would still pass a bare call-count check.
    expect(toBlob.mock.calls[0][2]).toBe(0.85)
    expect(toBlob.mock.calls[1][2]).toBe(0.7)
    expect(result.type).toBe('image/jpeg')
    expect(result.name).toBe('IMG_0001.jpg')
    expect(result.size).toBe(fits.size)
    expect(result.size).toBeLessThanOrEqual(PHOTO_UPLOAD_TARGET_BYTES)
    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })

  it('walks ALL six rungs down to the 800px/q0.35 floor when nothing fits, and returns the smallest', async () => {
    const big = fileOfSize('IMG_0004.jpg', PHOTO_UPLOAD_TARGET_BYTES + 1_000)
    const bitmap = mockBitmap()
    ;(globalThis as unknown as { createImageBitmap: jest.Mock }).createImageBitmap = jest
      .fn()
      .mockResolvedValue(bitmap)

    // Every rung oversized; the 5th is the smallest — pins that the ladder
    // exhausts all rungs and the smallest (not the last) blob wins.
    const sizes = [2_000_000, 1_800_000, 1_600_000, 1_400_000, 1_000_000, 1_100_000]
    const blobs = sizes.map(
      (s) => new Blob([new Uint8Array(s)], { type: 'image/jpeg' }),
    )
    const toBlob = jest.fn()
    blobs.forEach((b) => toBlob.mockImplementationOnce((cb: BlobCallback) => cb(b)))
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob)
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: jest.fn(),
    } as unknown as CanvasRenderingContext2D)

    const result = await shrinkPhotoForUpload(big)

    expect(toBlob).toHaveBeenCalledTimes(6)
    expect(toBlob.mock.calls.map((c) => c[2])).toEqual([0.85, 0.7, 0.6, 0.5, 0.4, 0.35])
    expect(result.size).toBe(1_000_000)
    expect(result.name).toBe('IMG_0004.jpg')
  })

  it('returns the original file when createImageBitmap rejects (e.g. HEIC decode failure)', async () => {
    const big = fileOfSize('IMG_0002.HEIC', PHOTO_UPLOAD_TARGET_BYTES + 1_000)
    ;(globalThis as unknown as { createImageBitmap: jest.Mock }).createImageBitmap = jest
      .fn()
      .mockRejectedValue(new Error('decode failed'))

    const result = await shrinkPhotoForUpload(big)

    expect(result === big).toBe(true)
  })

  it('returns the original file when canvas.toBlob yields null', async () => {
    const big = fileOfSize('IMG_0003.jpg', PHOTO_UPLOAD_TARGET_BYTES + 1_000)
    const bitmap = mockBitmap()
    ;(globalThis as unknown as { createImageBitmap: jest.Mock }).createImageBitmap = jest
      .fn()
      .mockResolvedValue(bitmap)
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) =>
      cb(null),
    )
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: jest.fn(),
    } as unknown as CanvasRenderingContext2D)

    const result = await shrinkPhotoForUpload(big)

    expect(result === big).toBe(true)
  })
})
