import 'server-only'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { openai } from '@/lib/openai'
import { getCachedAI, setCachedAI } from '@/lib/ai-cache'
import { getOrgSettings, orgSettingsWithClient, type OrgSettings } from '@/actions/org-settings'
import type { SynqedClient } from '@synqed-kk/client'
import {
  getBusinessAiPersona,
  resolvePersonaTokens,
  clinicalGuardrail,
} from '@/lib/karute/business-ai-tokens'
import { defensivePreamble, wrapUntrustedContent } from '@/lib/ai-safety'
import { KARUTE_PROMPT_VERSION, cleanNameToken } from '@/lib/karute/prompt-fragments'
import type { SuggestedMessage } from '@/components/karute/redesign/detail/AISuggestedMessageCard'
import { audit } from '@/lib/audit'
import { auditWeb } from '@/lib/audit-web'
import { JST_TZ, hmInJst, ymdInJst } from '@/lib/date/jst'

const OutreachSchema = z.object({
  body: z
    .string()
    .describe(
      'The follow-up message text, ready to send as-is. Grounded ONLY in the karute provided.',
    ),
})

/** FC4: a generated body naming a concrete date/time is legitimate when it's
 *  grounded in today's summary (rule 1 allows that) — but this regex can't
 *  tell "grounded" from "invented" apart, so it isn't used to reject the
 *  draft. It only gates the 365-day cache write: a match skips setCachedAI
 *  so a possibly-invented date/time can't get cache-locked for a year (the
 *  draft is still returned and shown — staff review is the real gate).
 *  Covers: JA month/day (8月21日), HH:MM time, JA 時/半/分 clock phrasing,
 *  EN month-abbreviation + day incl. ordinal suffix (Aug 21 / August 21st —
 *  the ordinal's `1`→`s` char pair defeats a bare \b, so the suffix is
 *  matched explicitly), and slash dates (8/21, incl. full-width ８／２１).
 *  Deliberate NON-matches, each because the same shape is common legitimate
 *  care-instruction phrasing and a false positive costs a cache skip per
 *  open: dash ranges (週2-3回) · bare ordinals without a month (the 3rd
 *  session) · slash values followed by a quantity counter (1/2カップ,
 *  1/3ほど — the trailing-counter lookahead below). Also covered (Greptile
 *  #680): day-first EN dates (21 August / 21st August) and ISO dates
 *  (2026-08-21). Residuals accepted, cache-skip-only cost either way: a
 *  counter-less fraction (「1/2ずつ」) still false-positives, and RELATIVE
 *  date phrasing ("in two weeks", 「2週間後」) is deliberately NOT matched —
 *  it names no concrete calendar fact to go stale, and is legitimate
 *  care-advice phrasing (次は2週間後がおすすめ). */
const DATE_TIME_TOKEN_RE =
  /[0-9０-９]{1,2}\s*月\s*[0-9０-９]{1,2}\s*日|[0-9]{1,2}:[0-9]{2}|[0-9０-９]{1,2}\s*時(?:半|[0-9０-９]{1,2}分)?|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+[0-9]{1,2}(?:st|nd|rd|th)?\b|\b[0-9]{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\b[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}\b|(?<![0-9０-９])[0-9０-９]{1,2}[/／][0-9０-９]{1,2}(?![0-9０-９])(?!\s*(?:個|カップ|杯|錠|包|回|本|枚|滴|袋|量|程度|ほど|cc|ml|g\b))/i

/**
 * AI推奨メッセージ — drafts the post-session follow-up shown on the karute
 * detail card. The card already carries the human loop (edit / approve-send via
 * MessageComposeDialog); this only produces the draft. Grounded in THIS
 * session's summary — never invents offers, prices, or facts. Cached per
 * (karute, summary) so the LLM runs once per record, not per view. Best-effort:
 * null on any failure → the card keeps its 対応予定 preview.
 */
interface OutreachParams {
  karuteId: string
  /** For the audit rows' detail.customer_id (viewer name-join, Wave V
   *  karute-target canon) — never a prompt anchor. */
  customerId: string | null
  customerName: string
  summary: string | null
  locale: string
  /** This karute's own linked appointment (D7) — excluded from the
   *  next-booking line's candidates so an early-in-visit save can't surface
   *  "next" = the visit happening right now. Required (not optional) so a
   *  new call site can't silently drop the exclusion. */
  appointmentId: string | null
  /** This karute's own store (D7) — NOT used to scope the next-booking
   *  lookup (that's business-wide, see findNextBooking). Only consulted
   *  afterwards to decide whether the line NAMES the destination store. */
  storeId: string | null
}

/** The SDK surface `appendNextBookingLine` needs — a booking lookup + the
 *  (rare) cross-store name resolution. Narrower than the facade's org-settings
 *  client; both compose fine since Pick types are structurally additive. */
type BookingLookupClient = Pick<SynqedClient, 'appointments' | 'stores'>

/** 生成-row emitters (Liam ruling 2026-07-29: the ai.suggested_message row
 *  means "the LLM actually ran", never "the card was viewed"). Private
 *  helpers on the auditLockout pattern (CP7): each body emits
 *  UNCONDITIONALLY on its one return path and is AUDITED_CORES-registered;
 *  computeSuggestedFollowUp conditions the CALL (generation branch only —
 *  cache hits and gated/no-summary nulls never reach it). */
async function auditSuggestedMessageGeneratedWeb(params: OutreachParams): Promise<void> {
  await auditWeb({
    category: 'ai',
    action: 'ai.suggested_message',
    targetType: 'karute',
    targetId: params.karuteId,
    detail: { customer_id: params.customerId },
    requestId: crypto.randomUUID(),
  })
}

function auditSuggestedMessageGeneratedFacade(
  businessId: string,
  actorId: string,
  requestId: string,
  params: OutreachParams,
): void {
  audit({
    category: 'ai',
    action: 'ai.suggested_message',
    actorId,
    actorType: 'staff',
    businessId,
    targetType: 'karute',
    targetId: params.karuteId,
    detail: { customer_id: params.customerId },
    requestId,
    source: 'facade',
  })
}

/** 「8月21日(金)」 shape — same Intl.DateTimeFormat pattern jst.ts's
 *  formatLongDateJst uses (weekday+month+day, JST-pinned), just without the
 *  year. Deliberately NOT the `.getDay()`-on-shifted-instant idiom at
 *  screen-rows.ts:187-188 (has a latent UTC-runtime off-by-one) — Intl's
 *  timeZone option does the JST conversion, no manual date math. */
function formatBookingDateJst(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: JST_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d)
}

/** ja: hmInJst's existing 24h "14:00". en: 12h via Intl (never a manual
 *  24→12 conversion). */
function formatBookingTimeJst(d: Date, locale: string): string {
  if (locale === 'ja') return hmInJst(d)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: JST_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

/** The single next SCHEDULED booking for `customerId`, excluding this
 *  karute's own appointment — ONE business-wide query (never store-scoped;
 *  storeId plays no part in the lookup, only in whether the caller later
 *  NAMES the store), earliest starts_at overall. Sorted client-side (FC7):
 *  the server's sort order is an unverifiable external contract, so this
 *  never assumes `.appointments[0]` is already earliest. Never throws — the
 *  caller's try/catch is the single error boundary. */
async function findNextBooking(
  client: BookingLookupClient,
  customerId: string,
  ownAppointmentId: string | null,
) {
  const list = await client.appointments.list({
    customer_id: customerId,
    from: new Date().toISOString(),
    status: 'SCHEDULED',
    page_size: 5,
  })
  return (
    list.appointments
      .filter((a) => a.id !== ownAppointmentId)
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0] ??
    null
  )
}

/** Deterministic next-booking line (D6-D9) — the SINGLE choke point both
 *  entry paths (getSuggestedFollowUp / getSuggestedFollowUpWithClient) route
 *  through, called AFTER the cache read/write boundary so the cached draft
 *  body stays booking-date-free and the line is computed fresh every open (a
 *  booking made after the draft was cached still shows up). Best-effort like
 *  every other read in this file: `client: null` (web path with no client in
 *  scope yet) triggers a lazy getSynqedClient() acquisition; any failure
 *  anywhere in the lookup returns `body` UNCHANGED, never throws.
 *
 *  Dynamic import (not a static top-of-file one) mirrors this file's
 *  existing feature-gate import — keeps @synqed-kk/client's runtime code out
 *  of test import-chains that never exercise this branch. */
async function appendNextBookingLine(
  body: string,
  client: BookingLookupClient | null,
  opts: {
    customerId: string | null
    locale: string
    appointmentId: string | null
    storeId: string | null
  },
): Promise<string> {
  if (!opts.customerId) return body
  try {
    const synqed =
      client ?? (await (await import('@/lib/synqed/client')).getSynqedClient())
    const next = await findNextBooking(synqed, opts.customerId, opts.appointmentId)
    if (!next) return body

    const startsAt = new Date(next.starts_at)
    const sameDay = ymdInJst(startsAt) === ymdInJst(new Date())
    const time = formatBookingTimeJst(startsAt, opts.locale)

    // Cross-store naming (D7): name the store whenever same-store can't be
    // PROVEN — a booking at a different store than this session's, or a
    // session whose own store is unknown (legacy null storeId — Greptile
    // #680 P1: silently omitting the location there reads as "here" when it
    // may not be). Only a proven same-store result stays name-less. FC2: an
    // unresolved name must not render location-blind — a failed or empty
    // resolution drops the WHOLE line, not just the name.
    let storeName: string | null = null
    if (next.store_id && next.store_id !== opts.storeId) {
      try {
        storeName = await synqed.stores.get(next.store_id).then((s) => s.name)
      } catch (err) {
        console.error('[appendNextBookingLine] cross-store name resolution failed:', err)
        return body
      }
      if (!storeName) {
        console.error('[appendNextBookingLine] cross-store name resolution returned no name')
        return body
      }
    }

    const ja = opts.locale === 'ja'
    if (ja) {
      const at = storeName ? `${storeName}にて` : ''
      const line = sameDay
        ? `本日この後${at}${time}のご予約をお受けしております。お待ちしております。`
        : `次回は${at}${formatBookingDateJst(startsAt, 'ja')}${time}のご予約をお受けしております。お待ちしております。`
      return `${body}\n\n${line}`
    }
    const date = formatBookingDateJst(startsAt, 'en')
    const at = storeName ? ` at ${storeName}` : ''
    const line = sameDay
      ? `We also have you booked for later today at ${time}${at}. We look forward to seeing you then.`
      : `We have your next appointment on ${date} at ${time}${at}. We look forward to seeing you then.`
    return `${body}\n\n${line}`
  } catch (err) {
    console.error('[appendNextBookingLine] failed:', err)
    return body
  }
}

/** Web (cookie) entry — cookie org-settings + cookie feature gate. */
export async function getSuggestedFollowUp(
  params: OutreachParams,
): Promise<SuggestedMessage | null> {
  let result: SuggestedMessage | null
  try {
    result = await computeSuggestedFollowUp(
      params,
      () => getOrgSettings().catch(() => null),
      // Dynamic import keeps test import-chains light.
      async () => {
        const { featureAllowed } = await import('@/lib/subscription/feature-gate')
        return featureAllowed('aiOutreachDrafts')
      },
      () => auditSuggestedMessageGeneratedWeb(params),
    )
  } catch (err) {
    // Errors are not actions (same doctrine as the /api/ai/* routes' catch
    // blocks) — nothing audits here.
    console.error('[getSuggestedFollowUp] failed:', err)
    return null
  }
  // D6: explicit null-guard BEFORE touching .body — never rely on the
  // try/catch above to paper over a null result. No client in scope on the
  // web path — appendNextBookingLine acquires its own (best-effort).
  if (result) {
    result = {
      ...result,
      body: await appendNextBookingLine(result.body, null, {
        customerId: params.customerId,
        locale: params.locale,
        appointmentId: params.appointmentId,
        storeId: params.storeId,
      }),
    }
  }
  // Per-VIEW row, web twin of the facade's karute.ai.suggestedMessage hook row
  // (both view-kind since the 2026-07-29 honesty split — Liam ruling): fires
  // unconditionally on every non-error return of computeSuggestedFollowUp
  // (cache-hit, plan-locked/no-summary null, and a freshly generated draft all
  // count) so the web surface stays audited. The 生成 row is the conditional
  // helper above — a real generation therefore writes view + 生成 together.
  await auditWeb({
    category: 'ai',
    action: 'ai.suggested_message_view',
    targetType: 'karute',
    targetId: params.karuteId,
    detail: { customer_id: params.customerId },
    requestId: crypto.randomUUID(),
  })
  return result
}

/** Facade (Bearer) entry — identity-threaded org-settings + business-scoped
 *  feature gate (packet 07 Decision 1). Same generator core, no cookie. The
 *  facade's generic success hook (logFacadeAudit) owns the per-VIEW row for
 *  this path (karute.ai.suggestedMessage, view-kind since 2026-07-29); the
 *  actor/requestId args exist ONLY so a real generation can stamp its 生成
 *  row via the facade helper above — this function itself stays emit-free
 *  (Core/WithClient split convention). */
export async function getSuggestedFollowUpWithClient(
  synqed: Pick<SynqedClient, 'orgSettings' | 'appointments' | 'stores'>,
  businessId: string,
  actorId: string,
  requestId: string,
  params: OutreachParams,
): Promise<SuggestedMessage | null> {
  let result: SuggestedMessage | null
  try {
    result = await computeSuggestedFollowUp(
      params,
      () => orgSettingsWithClient(synqed).catch(() => null),
      async () => {
        const { featureAllowedForBusiness } = await import('@/lib/subscription/feature-gate')
        return featureAllowedForBusiness(businessId, 'aiOutreachDrafts')
      },
      async () => auditSuggestedMessageGeneratedFacade(businessId, actorId, requestId, params),
    )
  } catch (err) {
    console.error('[getSuggestedFollowUpWithClient] failed:', err)
    return null
  }
  // D6: explicit null-guard before touching .body (L3#6) — the facade already
  // has its client resolved, so it's passed straight through (no acquisition).
  if (!result) return null
  return {
    ...result,
    body: await appendNextBookingLine(result.body, synqed, {
      customerId: params.customerId,
      locale: params.locale,
      appointmentId: params.appointmentId,
      storeId: params.storeId,
    }),
  }
}

async function computeSuggestedFollowUp(
  params: OutreachParams,
  resolveOrgSettings: () => Promise<OrgSettings | null>,
  checkOutreachAllowed: () => Promise<boolean>,
  onGenerated: () => Promise<void>,
): Promise<SuggestedMessage | null> {
  const { karuteId, summary, locale } = params
  if (!summary?.trim()) return null
  // Same treatment as every other prompt anchor: the name is DATA — clamp and
  // strip control chars before it touches a system prompt.
  const customerName = cleanNameToken(params.customerName) || 'お客様'

  if (!process.env.OPENAI_API_KEY) return null
  // Plan gate (P4): outreach drafts are a paid capability once billing arms.
  // Locked → null, and the card keeps its 対応予定 preview (this function is
  // best-effort by contract).
  if (!(await checkOutreachAllowed())) return null
  const orgSettings = await resolveOrgSettings()
  const persona = getBusinessAiPersona(orgSettings?.business_type)
  const tok = resolvePersonaTokens(persona, locale)

  const cacheInput = {
    // Outreach-only suffix (D9): KARUTE_PROMPT_VERSION is shared with the
    // ai-passport これまで box's cache key — bumping THAT constant blanks
    // every customer's passport business-wide (2026-07-15 incident, pinned
    // by prompt-v34-salience.test.ts:87). This suffix busts ONLY outreach
    // drafts (forcing a lazy regen under the tightened no-booking-close rule
    // below) without touching the passport cache or any other consumer.
    v: `${KARUTE_PROMPT_VERSION}:outreach-2`,
    k: karuteId,
    // Full summary — the cache layer hashes the whole input, so a regenerated
    // summary always misses the old draft (a 2000-char slice could collide).
    s: summary,
    bt: orgSettings?.business_type ?? null,
    locale,
  }
  const cached = (await getCachedAI('karute_followup', cacheInput).catch(() => null)) as {
    body?: string
  } | null
  if (cached?.body) return { channel: 'LINE', body: cached.body }

  const ja = locale === 'ja'
  const system = ja
    ? `あなたは${tok.businessNoun}のスタッフに代わって、本日ご来店いただいたお客様へのフォローアップメッセージ（LINE）を下書きするAIです。スタッフが送信前に必ず確認・編集します。

【ルール】
- 根拠：本日のカルテ要約に書かれている内容だけを使う。割引・特典・価格・予約日時など、要約に無いことは一切書かない（作った事実は信頼を壊す）。
- 構成：(1) 本日の来店へのお礼 → (2) 本日の内容に軽く触れる（1点だけ、要約から） → (3) ${persona.clinicalPosture !== 'service' ? 'セルフケアの宿題があればやさしく一言' : '宿題やおすすめしたケアがあればやさしく一言'} → (4) ${persona.clinicalPosture !== 'service' ? '体調の変化' : '気になる変化'}があればいつでもご連絡くださいと締める（来店・予約・またのご来店など、次回に関する言及は一切書かない — システムが別途ご案内します）。
- トーン：丁寧で温かい接客の日本語。絵文字は使わない。マークダウン・箇条書きは使わない（そのまま送れる普通の文章）。
- 長さ：120〜220文字程度。LINEで読みやすい短さ。
- 医療的な断定はしない：${clinicalGuardrail(persona.clinicalPosture, 'ja')}
- 宛名は「${customerName}様」で始める。店名・スタッフ名は書かない（送信画面で自動処理される想定はせず、単に省く）。

${defensivePreamble('ja')}`
    : `You draft the post-visit follow-up message (LINE) a ${tok.businessNoun} staff member sends to today's customer. Staff always review and edit before sending.

Rules:
- Grounded ONLY in today's karute summary. Never invent discounts, offers, prices, or booking times not present in it.
- Structure: (1) thank them for today's visit → (2) touch on ONE thing from the session → (3) gently mention any homework or recommended care → (4) close with "reach out anytime if anything changes" — never mention a next visit, booking, or "see you again" (a separate message handles that).
- Tone: warm, polite service language. No emoji, no markdown, no bullet points — plain sendable text.
- Length: 2-4 short sentences.
- No medical claims: ${clinicalGuardrail(persona.clinicalPosture, locale)}
- Open with "Dear ${customerName}," style addressing. Omit shop/staff names.

${defensivePreamble(locale)}`

  const completion = await openai.chat.completions.parse({
    model: process.env.AI_MODEL || 'gpt-4o',
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Today's karute summary:\n${wrapUntrustedContent('karute_summary', summary)}`,
      },
    ],
    response_format: zodResponseFormat(OutreachSchema, 'followup_draft'),
    temperature: 0.4,
  })
  const body = completion.choices[0]?.message?.parsed?.body?.trim()
  if (!body) return null
  // The LLM produced a usable draft — the ONE place this feature's 生成 row
  // is earned (a completed call with an empty/unparseable body earns
  // nothing: taxonomy = "draft generated", not "tokens spent"). Best-effort
  // like every audit emit (the helper never throws for web; facade audit()
  // is fire-and-forget) — a logging failure must not cost the draft.
  await onGenerated().catch(() => {})
  // FC4: a concrete date/time token in the body MIGHT be grounded in the
  // summary (legitimate, rule 1 allows it) or might be the LLM improvising a
  // "see you again" date despite the prompt's rule 4 — the regex can't tell
  // those apart, so it doesn't touch the draft itself. It only skips the
  // cache write below, so a possibly-invented date/time can't get locked in
  // for 365 days; the draft is still returned/shown either way (staff
  // review before send is the real gate).
  if (!DATE_TIME_TOKEN_RE.test(body)) {
    // Liam ruling 2026-07-29: a generated draft is FACTS-KEYED, not time-keyed —
    // it must never quietly regenerate while the karute is unchanged. The key
    // already hashes the full summary (any edit/regen = new key = fresh draft),
    // so retention is the only expiry left: 365d = effectively "keep until the
    // facts change" within core ai_cache's expires_at contract.
    await setCachedAI('karute_followup', cacheInput, { body }, 365).catch(() => {})
  }
  return { channel: 'LINE', body }
}
