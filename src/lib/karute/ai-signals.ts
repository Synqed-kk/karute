import 'server-only'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getSynqedClient } from '@/lib/synqed/client'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { listAllPackUsage } from '@/lib/packs/store'
import { hmInJst, jstDaysBetween, ymdInJst } from '@/lib/date/jst'
import { getTodaysAppointments } from './ai-context'

export type SignalKind =
  | 'today_roster'
  | 'next_visit'
  | 'ticket_low'
  | 'long_absence'

/** The targeted data slice a chip carries into the chat route (contracts
 *  #context-hint). null = the generic recent slice (today's default behavior). */
export type ContextHint = { customer_id: string } | { scope: 'today' } | null

export interface TodaySignal {
  /** Stable per day+kind+subject so the client can key/dedupe across a session. */
  id: string
  kind: SignalKind
  /** The why-tag on the chip. Field name is contract-fixed (#signal-chips); the
   *  content is locale-selected — JA per mock-v2 canon, EN sibling for `en`. */
  tagJa: string
  /** The chip text. Contract-fixed field name; locale-selected content. */
  titleJa: string
  /** The question sent to chat when the chip is tapped, in the caller's locale. */
  prompt: string
  contextHint: ContextHint
}

// Thresholds mirror the existing pack-alert + agenda rules so the chips agree
// with the rest of the app. `long_absence` = the 再来店 gap shown in the mock;
// `low ticket` = the house 'low' level (resolvePackAlert: remaining === 1).
const LONG_ABSENCE_DAYS = 60
const LOW_TICKET_REMAINING = 1

// Fixed display priority (DoD rank order). At most one signal per kind, so the
// list is naturally ≤ 4 — the slice is a guard, not a truncation of real chips.
const RANK: SignalKind[] = [
  'next_visit',
  'ticket_low',
  'long_absence',
  'today_roster',
]

/** Display name for a signal subject, per locale: JA appends the 様 honorific,
 *  EN uses the bare name (falling back to a neutral placeholder). */
function subjectName(name: string | undefined, locale: 'en' | 'ja'): string {
  if (locale === 'ja') return `${name ?? 'お客'}様`
  return name ?? 'the customer'
}

/**
 * Today's ranked signal chips for the AI相談 page (contracts #signal-chips).
 *
 * Every signal derives from TODAY'S store-scoped appointment roster, so store
 * scope is inherited in one place: `resolveStoreScope()` clamps a restricted
 * staff (allowedStoreIds non-null) to their store exactly like the chat route;
 * viewAll / floating staff read unfiltered. The per-customer enrichment + pack
 * reads are business-wide but only ever indexed by roster ids, so a clamped
 * staff can never surface another store's customer.
 *
 * No AI cost, no karute reads — the grounded answer is fetched when a chip is
 * tapped (the context hint), not here. Best-effort: [] on any error (the page
 * falls back to the tuned strip).
 */
export async function getTodaySignals(
  locale: 'en' | 'ja' = 'ja',
): Promise<TodaySignal[]> {
  try {
    const scope = await resolveStoreScope()
    const storeId =
      scope.allowedStoreIds !== null ? (scope.storeId ?? undefined) : undefined

    const appts = await getTodaysAppointments(storeId)
    if (appts.length === 0) return []

    const rosterIds = [
      ...new Set(appts.map((a) => a.customer_id).filter((id): id is string => id != null)),
    ]

    const synqed = await getSynqedClient()
    const [customers, enrichment, packUsage] = await Promise.all([
      getCachedCustomerList(),
      synqed.customers.enrichment(),
      listAllPackUsage(),
    ])
    const nameById = new Map(customers.map((c) => [c.id, c.name]))
    const enrichById = new Map(enrichment.map((e) => [e.customer_id, e]))

    const now = new Date()
    const day = ymdInJst(now)
    const signals: TodaySignal[] = []

    // next_visit — the earliest appointment still ahead of now today.
    const upcoming = appts
      .filter((a): a is typeof a & { customer_id: string } =>
        a.customer_id != null && new Date(a.starts_at).getTime() > now.getTime())
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
    if (upcoming) {
      const name = subjectName(nameById.get(upcoming.customer_id), locale)
      const time = hmInJst(new Date(upcoming.starts_at))
      signals.push({
        id: `${day}:next_visit:${upcoming.customer_id}`,
        kind: 'next_visit',
        tagJa: locale === 'ja' ? '次のご来店' : 'Next visit',
        titleJa:
          locale === 'ja'
            ? `次の${name}（${time}）：前回のフォローポイント`
            : `Next: ${name} (${time}) — follow-up points`,
        prompt:
          locale === 'ja'
            ? `次にご来店予定の${name}のカルテを踏まえ、本日のフォローポイントを教えてください。`
            : `Based on ${name}'s karute, what are today's follow-up points for their upcoming visit?`,
        contextHint: { customer_id: upcoming.customer_id },
      })
    }

    // ticket_low — today's roster customers down to their last ticket.
    const lowCount = rosterIds.filter(
      (id) => (packUsage.get(id)?.remaining ?? 0) === LOW_TICKET_REMAINING,
    ).length
    if (lowCount > 0) {
      signals.push({
        id: `${day}:ticket_low`,
        kind: 'ticket_low',
        tagJa: locale === 'ja' ? '回数券' : 'Ticket pack',
        titleJa:
          locale === 'ja'
            ? `回数券残り${LOW_TICKET_REMAINING}回：本日${lowCount}名 — 声かけ案`
            : `${LOW_TICKET_REMAINING} ticket left: ${lowCount} today — outreach ideas`,
        prompt:
          locale === 'ja'
            ? '本日ご来店で回数券が残り1回のお客様に、回数券更新のお声かけ案を提案してください。'
            : "Suggest how to raise ticket-pack renewal with today's customers who have 1 ticket left.",
        contextHint: { scope: 'today' },
      })
    }

    // long_absence — the roster customer returning after the longest gap.
    let longest: { id: string; days: number } | null = null
    for (const id of rosterIds) {
      const lastVisit = enrichById.get(id)?.last_visit
      if (!lastVisit) continue
      const days = jstDaysBetween(lastVisit, now)
      if (days >= LONG_ABSENCE_DAYS && (!longest || days > longest.days)) {
        longest = { id, days }
      }
    }
    if (longest) {
      const name = subjectName(nameById.get(longest.id), locale)
      signals.push({
        id: `${day}:long_absence:${longest.id}`,
        kind: 'long_absence',
        tagJa: locale === 'ja' ? '再来店' : 'Returning',
        titleJa:
          locale === 'ja'
            ? `${longest.days}日ぶりの再来店：${name}の経緯まとめ`
            : `Returning after ${longest.days} days: ${name}'s history`,
        prompt:
          locale === 'ja'
            ? `${longest.days}日ぶりにご来店の${name}について、これまでの経緯と本日の対応ポイントをまとめてください。`
            : `${name} is returning after ${longest.days} days — summarize their history and today's key points.`,
        contextHint: { customer_id: longest.id },
      })
    }

    // today_roster — always present when anyone is booked.
    signals.push({
      id: `${day}:today_roster`,
      kind: 'today_roster',
      tagJa: locale === 'ja' ? '本日の予約' : 'Today',
      titleJa:
        locale === 'ja'
          ? `本日の${rosterIds.length}名のお客様の要点まとめ`
          : `Key points for today's ${rosterIds.length} customer${rosterIds.length === 1 ? '' : 's'}`,
      prompt:
        locale === 'ja'
          ? '本日ご来店予定のお客様それぞれについて、前回の要点と本日の注意点を一覧でまとめてください。'
          : "For each customer booked today, summarize last visit's key points and today's cautions.",
      contextHint: { scope: 'today' },
    })

    return signals
      .sort((a, b) => RANK.indexOf(a.kind) - RANK.indexOf(b.kind))
      .slice(0, 4)
  } catch (err) {
    console.error('[getTodaySignals] failed:', err)
    return []
  }
}
