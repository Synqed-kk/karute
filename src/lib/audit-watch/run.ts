/**
 * 監査ログ round 2, PR C — subject 4: one business's audit-watch pass
 * (PACKET-AUDITLOG-PR-C-SERVER-WATCH-2026-09-11.md item 4). The cron route
 * (src/app/api/audit-watch/route.ts) is thin auth + allowlist + loop; this is
 * where the two candidate detectors (find-karute-missing.ts,
 * find-transcribe-storms.ts) meet the read/write — same route/lib split as
 * src/app/api/packs/auto-burn/route.ts ↔ src/lib/packs/auto-burn.ts.
 *
 * ALL reads go through the SDK directly (synqed.audit.list, never
 * listAuditLogWithClient — that helper writes its own privacy.audit_log.view
 * receipt per call, which this cron must never do: CP1, no actor, no view
 * row).
 */
import type { AuditEvent, RecentRedemption } from '@synqed-kk/client'
import { newSynqedClient } from '@/lib/synqed/client'
import { audit } from '@/lib/audit'
import { readRecordingsInbox } from '@/lib/recordings/inbox-read'
import { deriveInboxRows, INBOX_WINDOW_MS, type InboxRow } from '@/lib/recordings/inbox'
import { findKaruteMissing, lastAssemblerPassAt } from '@/lib/audit-watch/find-karute-missing'
import { ASSEMBLE_AFTER_MS } from '@/lib/recording/assembler'
import { findTranscribeStorms } from '@/lib/audit-watch/find-transcribe-storms'
import { ymdInJst, jstStartOfToday } from '@/lib/date/jst'

const AUDIT_PAGE_SIZE = 200
/** Safety stop on the category:'recording' page walk (mirrors /api/cleanup's
 *  MAX_PAGES idiom) — the deadline below is the honest stop in practice. */
const MAX_AUDIT_PAGES = 50
/** Per-candidate idempotency-check page size (packet item 4c). */
const DEDUPE_PAGE_SIZE = 50

type Detail = Record<string, string | number | boolean | null>

export interface BusinessWatchResult {
  businessId: string
  candidates: number
  written: number
  skipped: number
  truncated: boolean
}

function detailDay(detail: unknown): unknown {
  return detail && typeof detail === 'object' ? (detail as Record<string, unknown>).day : undefined
}

/** ONE per-target dedupe read (CP2): true when NO existing row shares this
 *  action (and, for a storm, the same detail.day). No action filter exists on
 *  ListAuditOptions yet (Anthony ticket item 2), so this scans the target's
 *  small `recording`-category page client-side. */
async function isNewCandidate(
  synqed: ReturnType<typeof newSynqedClient>,
  targetId: string,
  action: string,
  day: string | null,
): Promise<boolean> {
  const existing = await synqed.audit.list({
    target_type: 'recording',
    target_id: targetId,
    category: 'recording',
    page_size: DEDUPE_PAGE_SIZE,
  })
  return !existing.events.some((e) => e.action === action && (day == null || detailDay(e.detail) === day))
}

/** Every `recording`-category event since `from`, paged to completion or
 *  until `deadline` — no action filter exists server-side, so the storm
 *  finder filters to `recording.transcribe` itself. */
async function pageRecordingEvents(
  synqed: ReturnType<typeof newSynqedClient>,
  from: string,
  to: string,
  deadline: number,
): Promise<{ events: AuditEvent[]; truncated: boolean }> {
  const events: AuditEvent[] = []
  for (let page = 1; page <= MAX_AUDIT_PAGES; page++) {
    if (Date.now() >= deadline) return { events, truncated: true }
    const res = await synqed.audit.list({ category: 'recording', from, to, page, page_size: AUDIT_PAGE_SIZE })
    events.push(...res.events)
    if (res.events.length === 0 || page * AUDIT_PAGE_SIZE >= res.total) return { events, truncated: false }
  }
  return { events, truncated: true }
}

/** store_id/appointment_id/staff_id aren't on InboxRow (the 録音履歴 screen
 *  never needed them) — one Recording read per candidate fills them. Rare by
 *  construction (this whole feature exists because misses are rare), so a
 *  per-candidate `get` is cheaper than widening the shared inbox row shape
 *  for a field only this cron reads. ticket_burned reuses auto-burn.ts:367's
 *  ONE-bulk-read-then-filter idiom (never a per-appointment SDK call — none
 *  exists): null when there is no appointment to check, or the bulk read
 *  itself failed. */
async function karuteMissingDetail(
  synqed: ReturnType<typeof newSynqedClient>,
  row: InboxRow,
  redemptions: RecentRedemption[] | null,
): Promise<Detail> {
  const recording = await synqed.recordings.get(row.recordingSessionId as string).catch(() => null)
  const appointmentId = recording?.appointment_id ?? null
  return {
    recording_session_id: row.recordingSessionId,
    customer_id: row.customerId,
    staff_id: recording?.staff_id ?? null,
    appointment_id: appointmentId,
    store_id: recording?.store_id ?? null,
    duration_seconds: row.durationSeconds,
    reason: row.reason,
    ticket_burned:
      appointmentId == null || redemptions == null
        ? null
        : redemptions.some((r) => r.appointment_id === appointmentId),
  }
}

export async function watchOneBusiness(
  businessId: string,
  now: Date,
  mode: 'dry' | 'write',
  deadline: number,
): Promise<BusinessWatchResult> {
  const result: BusinessWatchResult = { businessId, candidates: 0, written: 0, skipped: 0, truncated: false }
  if (Date.now() >= deadline) {
    result.truncated = true
    return result
  }
  const synqed = newSynqedClient(businessId)

  try {
    // (a) recording.karute_missing candidates.
    const sessions = await readRecordingsInbox({ synqed, staffId: null, businessId, now })
    const rows = deriveInboxRows({ sessions, takes: [], now: now.getTime() })
    const missing = findKaruteMissing({
      rows,
      now: now.getTime(),
      lastAssemblerPassAt: lastAssemblerPassAt(now.getTime()),
      assembleAfterMs: ASSEMBLE_AFTER_MS,
    })

    // (b) recording.transcribe_storm candidates — since the start of
    // yesterday JST, so a storm spanning the JST midnight boundary is never
    // split across two runs.
    const from = new Date(jstStartOfToday().getTime() - 24 * 60 * 60 * 1000)
    const { events, truncated: pagesTruncated } = await pageRecordingEvents(
      synqed,
      from.toISOString(),
      now.toISOString(),
      deadline,
    )
    if (pagesTruncated) result.truncated = true
    const storms = findTranscribeStorms({ events, truncated: pagesTruncated })

    result.candidates = missing.length + storms.length

    const redemptions =
      missing.length > 0
        ? await synqed.packs
            .listRecentRedemptions(new Date(now.getTime() - INBOX_WINDOW_MS).toISOString())
            .catch(() => null)
        : null

    // (c) idempotency + write, one candidate at a time (CP2 — a candidate
    // skipped here is never walked again in this run).
    for (const row of missing) {
      if (Date.now() >= deadline) {
        result.truncated = true
        break
      }
      const targetId = row.recordingSessionId as string
      const isNew = await isNewCandidate(synqed, targetId, 'recording.karute_missing', null)
      if (!isNew) {
        result.skipped++
        continue
      }
      if (mode === 'write') {
        audit({
          category: 'recording',
          action: 'recording.karute_missing',
          actorId: null,
          actorType: 'system',
          businessId,
          targetType: 'recording',
          targetId,
          severity: 'notice',
          detail: await karuteMissingDetail(synqed, row, redemptions),
          requestId: `audit-watch:recording.karute_missing:${targetId}:${ymdInJst(now)}`,
          source: 'system',
        })
      }
      result.written++
    }

    for (const storm of storms) {
      if (Date.now() >= deadline) {
        result.truncated = true
        break
      }
      const isNew = await isNewCandidate(synqed, storm.targetId, 'recording.transcribe_storm', storm.day)
      if (!isNew) {
        result.skipped++
        continue
      }
      if (mode === 'write') {
        audit({
          category: 'recording',
          action: 'recording.transcribe_storm',
          actorId: null,
          actorType: 'system',
          businessId,
          targetType: 'recording',
          targetId: storm.targetId,
          severity: 'notice',
          detail: {
            recording_session_id: storm.targetId,
            customer_id: storm.customerId,
            staff_id: storm.staffId,
            count: storm.count,
            cost_cents_estimate: storm.costCentsEstimate,
            truncated: storm.truncated,
            day: storm.day,
          },
          requestId: `audit-watch:recording.transcribe_storm:${storm.targetId}:${storm.day}`,
          source: 'system',
        })
      }
      result.written++
    }
  } catch (err) {
    console.error('[audit-watch]', businessId, err instanceof Error ? err.message : err)
    result.truncated = true
  }
  return result
}
