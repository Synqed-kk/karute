import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AppApiError } from '@/lib/app-api/errors'
import { featureAllowed } from '@/lib/subscription/feature-gate'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { getOrgSettings } from '@/actions/org-settings'
import {
  runMeteredTranscription,
  speakerIdMode,
  loadStaffReferenceForStaff,
} from '@/lib/ai/transcribe'
import { auditWeb } from '@/lib/audit-web'

export const maxDuration = 300

/**
 * SSRF guard for the JSON path's caller-supplied audioUrl. The only legitimate
 * value is a Supabase Storage URL on THIS project's host (the caller uploads the
 * recording there, then passes the signed URL) — both this route and Deepgram
 * fetch it server-side, so an unrestricted value could reach internal endpoints
 * or arbitrary hosts. Require https + an exact host match against
 * NEXT_PUBLIC_SUPABASE_URL. Anything unparseable or off-host is rejected.
 *
 * NOTE: the facade twin `/api/app/v1/ai/transcribe` takes a STORAGE PATH (not a
 * URL) and mints its own signed READ url after a tenant-prefix check, so this
 * SSRF surface disappears by construction there (packet 08 Decision 2).
 */
function isAllowedAudioUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return false
  try {
    const u = new URL(raw)
    const allowedHost = new URL(base).host
    return u.protocol === 'https:' && u.host === allowedHost
  } catch {
    return false
  }
}

/**
 * POST /api/ai/transcribe
 *
 * Accepts either:
 * - FormData with audio file (small files, browser direct upload)
 * - JSON with { audioUrl, locale } (large files — caller uploaded to Supabase
 *   Storage and is passing us the signed URL). Deepgram fetches the audio
 *   directly from that URL, so we skip the round-trip through this function.
 *
 * The Deepgram + speaker-id body lives in the shared core (packet 08 §Build
 * 1(ii)) so the facade twin can reuse it; this route resolves the diarize toggle
 * and the caller's OWN voiceprint reference (cookie identity) and delegates.
 */
export async function POST(request: Request) {
  // Explicit fail-fast auth guard (defense-in-depth). Anon already fails closed
  // downstream via getBusinessId(), but reject before any rate-limit/data work.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ⚖ THE CEILING IS ASKED ONCE, INSIDE THE METER (the spend wall, 2026-09-08).
  // This route used to consume('transcribe') here, before the plan gate's twin
  // ordering — with runMeteredTranscription consuming at the provider call, a
  // second consume here would count every request against the hourly cap twice.
  // The refusal comes back as a classified rate_limited AppApiError and leaves
  // through the catch below, as the same 429 body + Retry-After this block sent.
  //
  // Plan gate (P4): transcription is the front door of AI karute generation —
  // same key as extract/summarize. Inert until billing arms (see feature-gate.ts).
  if (!(await featureAllowed('aiKaruteGeneration'))) {
    return NextResponse.json(
      { error: 'PLAN_LOCKED', feature: 'aiKaruteGeneration' },
      { status: 403 },
    )
  }
  try {
    const contentType = request.headers.get('content-type') ?? ''

    // Honor the org's speaker_diarization toggle. Missing settings → true
    // (matches OrgSettings getter default + spike spec).
    const orgSettings = await getOrgSettings().catch(() => null)
    const diarize = orgSettings?.speaker_diarization !== false
    const businessType = orgSettings?.business_type ?? null
    const mode = speakerIdMode()
    // Voice-isolation: the caller's OWN enrollment clip (cookie identity).
    const reference =
      mode === 'off'
        ? null
        : await loadStaffReferenceForStaff(orgSettings, await getCurrentUserStaffId())
    // Both request-cached: getSynqedClient already resolved the business id, so
    // this second read is the same lookup, not a second round-trip.
    const meter = {
      synqed: await getSynqedClient(),
      businessId: await getBusinessId(),
      door: 'web' as const,
    }

    if (contentType.includes('application/json')) {
      const { audioUrl, locale: loc } = await request.json()
      if (!audioUrl) {
        return NextResponse.json({ error: 'No audioUrl provided' }, { status: 400 })
      }
      // SSRF guard: only our Supabase Storage host may be fetched (here + by
      // Deepgram). Blocks internal-endpoint probing and arbitrary fetches.
      if (!isAllowedAudioUrl(audioUrl)) {
        return NextResponse.json({ error: 'Invalid audioUrl' }, { status: 400 })
      }
      const { result: body, receipt } = await runMeteredTranscription(meter, {
        audio: { url: audioUrl },
        locale: (loc ?? 'ja') === 'en' ? 'en' : 'ja',
        diarize,
        reference,
        mode,
        businessType,
      })
      // 監査ログ Wave W1 (§3.1 ai.* baseline): logged AFTER transcription
      // succeeds, before the response — ids-only, no transcript content. The
      // spend wall's numbers ride THIS row rather than a second one from the
      // meter: one call, one receipt. The receipt itself never leaves the
      // server — the client gets `body`, exactly as before.
      await auditWeb({
        category: 'recording',
        action: 'recording.transcribe',
        ...(receipt.debit_recorded ? {} : { severity: 'warning' as const }),
        detail: { ...receipt },
        requestId: crypto.randomUUID(),
      })
      return NextResponse.json(body)
    }

    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null
    const locale = (formData.get('locale') as string | null) ?? 'ja'
    if (!audioFile) {
      return NextResponse.json({ error: 'No audio provided' }, { status: 400 })
    }
    const buffer = Buffer.from(await audioFile.arrayBuffer())
    const mimeType = audioFile.type || 'audio/webm'

    const { result: body, receipt } = await runMeteredTranscription(meter, {
      audio: { buffer, mimeType },
      locale: locale === 'en' ? 'en' : 'ja',
      diarize,
      reference,
      mode,
      businessType,
    })
    await auditWeb({
      category: 'recording',
      action: 'recording.transcribe',
      ...(receipt.debit_recorded ? {} : { severity: 'warning' as const }),
      detail: { ...receipt },
      requestId: crypto.randomUUID(),
    })
    return NextResponse.json(body)
  } catch (error) {
    // The spend/rate ceiling — the SAME body and Retry-After the removed
    // consume block above sent, rebuilt from the classified error it throws
    // instead. Status stays a literal 429 for CP7's audit-writer walker.
    if (error instanceof AppApiError && error.code === 'rate_limited') {
      return NextResponse.json(
        { error: error.message, ...(error.detail ?? {}) },
        { status: 429, headers: { 'Retry-After': String(60 * 60) } },
      )
    }
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[/api/ai/transcribe]', message)
    return NextResponse.json(
      { error: 'Transcription failed', detail: message },
      { status: 500 },
    )
  }
}
