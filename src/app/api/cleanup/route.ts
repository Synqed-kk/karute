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
  // A degraded sweep must not read as a finished one. The caller is a cron with
  // no other view of the run, and `recordingsDeleted` alone can't separate "the
  // bucket held 12 orphans" from "we stopped after 12 and never saw the rest".
  // Flip this on every path that leaves part of the bucket unwalked; the
  // response carries it so a truncated run is legible to whoever reads it.
  let recordingsSweepComplete = true

  // 1. Clean up orphaned recordings. The bucket listing is PAGED (storage-js
  // defaults to 100 per call), so the old unparameterised list() only ever saw
  // the FIRST page and left every orphan past it in the bucket. Walk to the end,
  // THEN delete: removing mid-walk shifts the offsets underneath us and the next
  // page skips exactly as many objects as the last one deleted. Advance by what
  // the page RETURNED, not by the limit we asked for, so a server-side cap below
  // PAGE_SIZE can't end the walk early; MAX_PAGES is the runaway stop.
  const PAGE_SIZE = 1000
  const MAX_PAGES = 100
  // Delete in fixed-size batches instead of handing every expired name to one
  // remove(): a single oversized request can be refused WHOLE, and the old code
  // discarded remove()'s result and reported expired.length regardless — a
  // deletion count for objects still sitting in the bucket. 100 = the storage
  // client's own default page size, so a batch is never bigger than a listing.
  const REMOVE_BATCH_SIZE = 100
  try {
    const oneHourAgo = Date.now() - 60 * 60 * 1000
    const expired: string[] = []
    let page = 0
    for (let offset = 0; page < MAX_PAGES; page++) {
      const { data: files, error: listError } = await supabase.storage
        .from('recordings')
        .list('', { limit: PAGE_SIZE, offset })
      // A failed page also answers with data null, which the old destructuring
      // read as "bucket ended here" — the sweep then finished silently and every
      // orphan past the failure waited for the next cron with nothing logged.
      // End the walk (the offsets after a failed page can't be trusted) but SAY
      // so; the names already collected were genuinely listed and expired, so
      // deleting them below stays correct.
      if (listError) {
        console.error('[cleanup] recordings list error:', listError)
        recordingsSweepComplete = false
        break
      }
      if (!files || files.length === 0) break
      for (const f of files) {
        // A null/absent/unparseable created_at parses to NaN, which the old
        // `new Date(...) < cutoff` form read as the epoch — i.e. ALWAYS expired,
        // queueing a row of unknown age for deletion. Require a real timestamp.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const createdAt = Date.parse((f as any).created_at)
        if (Number.isFinite(createdAt) && createdAt < oneHourAgo) expired.push(f.name)
      }
      offset += files.length
    }
    // Only a zero-length page ends the walk at the true end of the bucket, and
    // that path leaves `page` below the bound. Reaching MAX_PAGES therefore means
    // rows were still coming back when the runaway stop fired — anything past
    // what we walked was never looked at. (A page shorter than PAGE_SIZE does
    // NOT mean the bucket ended, per the offset comment above, so the bound is
    // the only thing this can key on.)
    if (page === MAX_PAGES) {
      console.error('[cleanup] recordings walk hit MAX_PAGES; bucket may extend past it')
      recordingsSweepComplete = false
    }
    for (let i = 0; i < expired.length; i += REMOVE_BATCH_SIZE) {
      const batch = expired.slice(i, i + REMOVE_BATCH_SIZE)
      const { data, error } = await supabase.storage.from('recordings').remove(batch)
      // Count only what storage confirmed gone; a failed batch must not inflate
      // the number, and the batches after it still deserve their attempt.
      if (error) {
        console.error('[cleanup] recordings batch error:', error)
        continue
      }
      // remove() returns the objects it ACTUALLY removed, which is not always
      // every name we asked for — an object can vanish between the listing and
      // the delete (this system's own post-transcription cleanup produces
      // exactly that race). Count the result, not the ask.
      recordingsDeleted += data?.length ?? 0
    }
  } catch (err) {
    console.error('[cleanup] recordings error:', err)
    recordingsSweepComplete = false
  }

  // 2. Clean up expired AI cache (synqed-core)
  cacheDeleted = await cleanupExpiredAiCache()

  // The scheduler reads only the HTTP status, so an incomplete sweep must not
  // record as a successful run.
  return NextResponse.json(
    {
      recordingsDeleted,
      recordingsSweepComplete,
      cacheDeleted,
    },
    { status: recordingsSweepComplete ? 200 : 500 }
  )
}
