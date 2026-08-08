// Client-only, pure browser APIs. No Next.js imports — this file ships in
// both the Next.js web bundle and the Capacitor thin Vite bundle.

// Core rejects any upload request body >= ~950KB (platform-level 503,
// probe-proven 2026-08-08). 50KB margin.
export const PHOTO_UPLOAD_TARGET_BYTES = 900_000

// Downscale ladder: [maxEdge, quality]. Re-encoding to JPEG intentionally
// strips EXIF (including GPS) — not a bug. The 800px/q0.35 floor makes the
// exhaustion path unreachable in practice: a JPEG that small physically
// can't exceed 900KB, so the return-smallest fallback below is defense, not
// a live upload-oversized path (Greptile P1 on the 1280px floor — fixed by
// these two rungs). ponytail: fixed ladder, not adaptive binary-search —
// swap only if quality complaints come in.
const LADDER: Array<[maxEdge: number, quality: number]> = [
  [2048, 0.85],
  [2048, 0.7],
  [1600, 0.6],
  [1280, 0.5],
  [1024, 0.4],
  [800, 0.35],
]

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

function jpegName(name: string): string {
  return name.replace(/\.[^./\\]*$/, '') + '.jpg'
}

export async function shrinkPhotoForUpload(file: File): Promise<File> {
  if (file.size <= PHOTO_UPLOAD_TARGET_BYTES) return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Desktop-browser HEIC (or anything else undecodable) — today's
    // behavior: pass through untouched, server still validates.
    return file
  }

  try {
    let smallest: Blob | null = null
    for (const [maxEdge, quality] of LADDER) {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
      const w = Math.round(bitmap.width * scale)
      const h = Math.round(bitmap.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(bitmap, 0, 0, w, h)
      const blob = await toBlob(canvas, quality)
      if (!blob) return file
      if (!smallest || blob.size < smallest.size) smallest = blob
      if (blob.size <= PHOTO_UPLOAD_TARGET_BYTES) break
    }
    if (!smallest) return file
    return new File([smallest], jpegName(file.name), { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}
