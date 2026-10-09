// The sync routes' response reader, shared by the per-store form (SyncSection)
// and the all-stores list (SyncAllStoresList) — its own module so neither
// component imports the other for it.

export type SyncResponse = {
  error?: string | { code?: string; message?: string }
  message?: string
  code?: string
  created?: number
  updated?: number
  skipped?: number
}

/**
 * Read a sync API response defensively. On a HANDLED failure the route returns
 * clean JSON ({ error }); but on a platform CRASH/timeout Vercel returns PLAIN
 * TEXT ("Internal Server Error") — calling res.json() on that threw
 * "Unexpected token 'I'" and masked the real failure. So: read text first, parse
 * if we can, and ALWAYS surface the HTTP status so the true error is visible.
 */
export async function readSyncResponse(
  res: Response,
): Promise<{ ok: true; data: SyncResponse } | { ok: false; message: string }> {
  // The run deadline's abort can land while the body is still arriving; it must
  // reach the caller's failure path, never read as an empty 2xx (a false 同期完了).
  const raw = await res.text().catch((e: unknown) => {
    if (e instanceof Error && e.name === 'AbortError') throw e
    return ''
  })
  let data: SyncResponse | null = null
  try {
    data = raw ? (JSON.parse(raw) as SyncResponse) : null
  } catch {
    /* non-JSON body (e.g. Vercel's plain "Internal Server Error" on a crash) */
  }
  if (!res.ok || data?.error) {
    // The 403 body nests the message ({error:{code,message}}); older/other
    // failures still send error as a plain string — prefer the object's
    // message when present.
    const err = data?.error
    const detail =
      (typeof err === 'object' && err !== null ? err.message : err) ??
      (raw ? raw.slice(0, 160) : res.statusText)
    return { ok: false, message: `Error (${res.status}): ${detail}` }
  }
  return { ok: true, data: data ?? {} }
}
