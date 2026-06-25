import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { cleanupExpiredAiCache } from '@/lib/ai-cache'

export const maxDuration = 30

/**
 * Daily cleanup:
 * 1. Delete any orphaned recordings from storage (older than 1 hour)
 * 2. Delete expired AI cache entries (in synqed-core)
 *
 * Runs from cron (no user session). Recordings still use the service-role
 * Supabase client (Storage); the AI cache lives in synqed-core.
 */
export async function GET() {
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
