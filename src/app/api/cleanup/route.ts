import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { cleanupExpiredAiCache } from '@/lib/ai-cache'
import { looksLikeRecordingKey } from '@/lib/recording/key-grammar'

export const maxDuration = 30

/**
 * Daily cleanup:
 * 1. REPORT orphaned-looking objects in the recordings bucket (older than 1 hour)
 * 2. Delete expired AI cache entries (in synqed-core)
 *
 * ⚖ Liam 2026-09-03 — recorded audio is NEVER deleted, so pass 1 deletes
 * nothing. It used to remove every object older than an hour with no look at
 * the job state behind it, which ate the audio of any take still queued,
 * retrying or failed at the next daily sweep. It now walks the same bucket,
 * runs the same key grammar the upload fences run, and LOGS what does not
 * conform so a human can look; the count comes back as
 * `recordingsOrphanCandidates`. Anything that has to go, goes by a named hand.
 *
 * Runs from Vercel Cron (no user session) — which sends
 * `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is configured. This
 * endpoint reads storage + purges cache with the service-role client, so it
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

  let recordingsOrphanCandidates = 0
  let cacheDeleted = 0
  // A degraded sweep must not read as a finished one. The caller is a cron with
  // no other view of the run, and the candidate count alone can't separate "the
  // bucket held 12 orphans" from "we stopped after 12 and never saw the rest".
  // Flip this on every path that leaves part of the bucket unwalked; the
  // response carries it so a truncated run is legible to whoever reads it.
  let recordingsSweepComplete = true

  // 1. Report orphaned-looking recordings. The bucket listing is PAGED
  // (storage-js defaults to 100 per call), so the old unparameterised list()
  // only ever saw the FIRST page and left every orphan past it unreported.
  // Advance by what the page RETURNED, not by the limit we asked for, so a
  // server-side cap below PAGE_SIZE can't end the walk early; MAX_PAGES is the
  // runaway stop.
  // ponytail: PAGE_SIZE × MAX_PAGES = 100k objects per run is the ceiling; a
  // bucket past it reports recordingsSweepComplete:false rather than lying, and
  // the fix if it ever fires is a resume cursor, not a bigger bound.
  const PAGE_SIZE = 1000
  const MAX_PAGES = 100
  try {
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000
    let page = 0
    for (let offset = 0; page < MAX_PAGES; page++) {
      const { data: files, error: listError } = await supabase.storage
        .from('recordings')
        .list('', { limit: PAGE_SIZE, offset })
      // A failed page also answers with data null, which the old destructuring
      // read as "bucket ended here" — the sweep then finished silently and every
      // orphan past the failure waited for the next cron with nothing logged.
      // End the walk (the offsets after a failed page can't be trusted) but SAY
      // so; the names already reported were genuinely listed, so the count of
      // them stays honest.
      if (listError) {
        console.error('[cleanup] recordings list error:', listError)
        recordingsSweepComplete = false
        break
      }
      if (!files || files.length === 0) break
      for (const f of files) {
        // A root listing also carries FOLDER placeholders — `seg`, the tree the
        // segment uploader writes into — which are not objects at all. storage-js
        // marks exactly this with `id: null` (folders have no object id); skip on
        // that signal, not on "has no dot" — a real dotless junk object must
        // still be reported. The created_at guard below happens to catch a
        // placeholder too, but as a belt, not as the reason.
        if (f.id == null) continue
        // Ours by the same grammar the upload fences run: never reported, at any
        // age. ⚖ audio is never deleted, so age says nothing about a take.
        if (looksLikeRecordingKey(f.name)) continue
        // A null/absent/unparseable created_at parses to NaN, which the old
        // `new Date(...) < cutoff` form read as the epoch — i.e. ALWAYS expired,
        // reporting a row of unknown age. Require a real timestamp.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const createdAt = Date.parse((f as any).created_at)
        if (!Number.isFinite(createdAt) || createdAt >= oneHourAgo) continue
        recordingsOrphanCandidates++
        console.warn('[cleanup]', {
          evt: 'recordings_orphan_candidate',
          name: f.name,
          ageHours: Math.round((now - createdAt) / 3_600_000),
        })
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
      recordingsOrphanCandidates,
      recordingsSweepComplete,
      cacheDeleted,
    },
    { status: recordingsSweepComplete ? 200 : 500 }
  )
}
