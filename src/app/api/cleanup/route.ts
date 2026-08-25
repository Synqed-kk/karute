import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { cleanupExpiredAiCache } from '@/lib/ai-cache'

export const maxDuration = 30

/**
 * Daily cleanup:
 * 1. Delete any orphaned recordings from storage (older than 1 hour)
 * 2. Delete expired AI cache entries (in synqed-core)
 *
 * Runs from Vercel Cron (no user session) — which sends
 * `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is configured. This
 * endpoint deletes storage + purges cache with the service-role client, so it
 * must NOT be publicly callable. Fail CLOSED: if CRON_SECRET is unset, or the
 * header doesn't match, reject. (Set CRON_SECRET on Vercel prod+preview before
 * deploy, or the scheduled cleanup 401s until it's present.)
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  let recordingsDeleted = 0
  let cacheDeleted = 0

  // 1. Clean up orphaned recordings. The bucket listing is PAGED (storage-js
  // defaults to 100 per call), so the old unparameterised list() only ever saw
  // the FIRST page and left every orphan past it in the bucket. Walk to the end,
  // THEN delete: removing mid-walk shifts the offsets underneath us and the next
  // page skips exactly as many objects as the last one deleted. Advance by what
  // the page RETURNED, not by the limit we asked for, so a server-side cap below
  // PAGE_SIZE can't end the walk early; MAX_PAGES is the runaway stop.
  const PAGE_SIZE = 1000
  const MAX_PAGES = 100
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const expired: string[] = []
    for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
      const { data: files } = await supabase.storage
        .from('recordings')
        .list('', { limit: PAGE_SIZE, offset })
      if (!files || files.length === 0) break
      for (const f of files) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (new Date((f as any).created_at) < oneHourAgo) expired.push(f.name)
      }
      offset += files.length
    }
    if (expired.length > 0) {
      await supabase.storage.from('recordings').remove(expired)
      recordingsDeleted = expired.length
    }
  } catch (err) {
    console.error('[cleanup] recordings error:', err)
  }

  // 2. Clean up expired AI cache (synqed-core)
  cacheDeleted = await cleanupExpiredAiCache()

  return NextResponse.json({
    recordingsDeleted,
    cacheDeleted,
  })
}
