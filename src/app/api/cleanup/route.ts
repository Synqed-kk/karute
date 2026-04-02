import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const maxDuration = 30

/**
 * Daily cleanup:
 * 1. Delete any orphaned recordings from storage (older than 1 hour)
 * 2. Delete expired AI cache entries
 */
export async function GET() {
  const supabase = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

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

  // 2. Clean up expired AI cache
  try {
    const { count } = await sb
      .from('ai_cache')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id', { count: 'exact', head: true })
    cacheDeleted = count ?? 0
  } catch (err) {
    console.error('[cleanup] cache error:', err)
  }

  return NextResponse.json({
    recordingsDeleted,
    cacheDeleted,
  })
}
