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

  // 1. Clean up orphaned recordings
  try {
    const { data: files } = await supabase.storage.from('recordings').list()
    if (files && files.length > 0) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const oldFiles = files.filter((f: any) => new Date(f.created_at) < oneHourAgo)
      if (oldFiles.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.storage.from('recordings').remove(oldFiles.map((f: any) => f.name))
        recordingsDeleted = oldFiles.length
      }
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
