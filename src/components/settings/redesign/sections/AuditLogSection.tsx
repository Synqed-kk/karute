'use client'

// 監査ログ viewer (AUDIT-LOG-DESIGN.md §11). Default feed = changes + notice/
// warning only — view events outnumber changes ~10:1 and would bury edits; the
// 「閲覧を含む」 toggle opts them in. The per-customer deep-link
// (/settings?tab=audit&target=<id>) INVERTS that default: it IS the dispute
// view, so every access to that person's record shows.
// I7 (hard invariant): this surface never renders per-staff aggregation —
// counts, rates, rankings. Raw events only. The スタッフ filter is the §10
// cause-based investigation path and always renders raw events; the summary
// strip counts EVENTS for the whole filter window, never per-person.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Activity,
  ArrowLeft,
  Calendar,
  ChevronDown,
  CreditCard,
  Eye,
  FileText,
  KeyRound,
  Loader2,
  Lock,
  Mic,
  Settings2,
  ShieldAlert,
  Sparkles,
  User,
  Users,
} from 'lucide-react'
import type { StaffMember } from '@/lib/staff'
import { listAuditLog, type AuditLogEvent } from '@/actions/audit-log'
import { listEntryEditHistory, type EntryEditHistoryRow } from '@/actions/karute'
import {
  automationLabelKey,
  foldRepeats,
  formatStormCostUsd,
  karuteMissingReasonKey,
  rangeDays,
  transcribeFailedReasonKey,
  type FoldGroup,
} from '@/lib/audit-labels'

const CATEGORIES = [
  'auth',
  'customer',
  'karute',
  'recording',
  'ai',
  'privacy',
  'settings',
  'staff',
  'billing',
  'booking',
] as const

const CATEGORY_ICONS: Record<string, typeof Activity> = {
  auth: KeyRound,
  customer: User,
  karute: FileText,
  recording: Mic,
  ai: Sparkles,
  privacy: Lock,
  settings: Settings2,
  staff: Users,
  billing: CreditCard,
  booking: Calendar,
}

const RANGE_PRESETS = ['7d', '30d', '90d', 'all'] as const
type RangePreset = (typeof RANGE_PRESETS)[number]

function presetFrom(preset: RangePreset): string | undefined {
  const days = rangeDays(preset)
  return days === null ? undefined : new Date(Date.now() - days * 86_400_000).toISOString()
}

function isViewEvent(action: string): boolean {
  return action.endsWith('.view') || action.endsWith('_view')
}

// Same helper shape as MenusSection.tsx:26 — a two-line local, not a shared
// module (one other caller, different namespace).
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

// karute.entry_edit rows expand in place to show what changed (Liam ruling
// 2026-07-26, AUDIT-LOG-DESIGN.md §11) — list rows stay ids-only, content is
// pulled live from the entry-edits trail on tap. Cache keyed by the audit
// row's own id (not entry_id): a re-expand of the SAME row never refetches;
// two different rows on the same entry each fetch once, which is fine.
type EntryEditTrailState =
  | { status: 'loading' }
  | { status: 'ok'; rows: EntryEditHistoryRow[]; truncated: boolean }
  | { status: 'error' }

// new Date + Intl.format throws on an invalid string — same guard idiom as
// EntryHistorySheet.tsx's formatCreatedAt (the one-sheet history block this
// accordion's rendering is copied from).
function formatEditTrailTimestamp(iso: string, fmt: Intl.DateTimeFormat): string | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : fmt.format(d)
}

interface AuditLogSectionProps {
  staffList: StaffMember[]
  /** Customer id from the privacy-tab deep-link (?tab=audit&target=…). */
  initialTargetId?: string | null
}

export function AuditLogSection({ staffList, initialTargetId }: AuditLogSectionProps) {
  const t = useTranslations('settings.auditLog')
  const tRole = useTranslations('settings.permissions')
  const tc = useTranslations('common')
  const locale = useLocale()

  const [category, setCategory] = useState<string | null>(null)
  const [actorId, setActorId] = useState<string | null>(null)
  const [range, setRange] = useState<RangePreset>('30d')
  // Deep-link opens the dispute view: views INCLUDED (§11 inversion).
  const [targetId, setTargetId] = useState(initialTargetId ?? null)
  // I4 (round-2 D2): what `targetId` names when set. The initial deep-link is
  // always the customer dispute view; a recording thread only opens via a tap
  // on a recording row's sub-line (see renderEventGroup below).
  const [targetType, setTargetType] = useState<'customer' | 'recording'>('customer')
  const [includeViews, setIncludeViews] = useState(Boolean(initialTargetId))
  const [breakGlass, setBreakGlass] = useState(false)
  // G2 (round-4 line-audit): tapping 警告 or 重大 is a SERVER filter (core's
  // real severity param) — ONE feed at a time, never both. `days` below
  // reads `events` directly, whichever single feed load() last fetched.
  const [lens, setLens] = useState<'warn' | 'critical' | null>(null)
  // karute.entry_edit expansion — one row open at a time (§11 accordion).
  const [expandedEditId, setExpandedEditId] = useState<string | null>(null)
  const [editTrails, setEditTrails] = useState<Record<string, EntryEditTrailState>>({})

  const [events, setEvents] = useState<AuditLogEvent[]>([])
  const [breakGlassTotal, setBreakGlassTotal] = useState<number | null>(null)
  const [warningsTotal, setWarningsTotal] = useState<number | null>(null)
  const [changesTotal, setChangesTotal] = useState<number | null>(null)
  const [criticalTotal, setCriticalTotal] = useState<number | null>(null)
  const [targetLabels, setTargetLabels] = useState<Record<string, string>>({})
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'forbidden' | 'failed' | null>(null)
  // I4: honest "this thread may be incomplete" flag — set only on a
  // targetType:'recording' read (the reader's own threadPartial contract).
  const [threadPartial, setThreadPartial] = useState(false)

  // I4 — shared by the back button AND the (now-removed) inline clear button:
  // leaving a thread always resets to the plain feed.
  const closeTarget = useCallback(() => {
    setTargetId(null)
    setTargetType('customer')
    setIncludeViews(false)
    setThreadPartial(false)
  }, [])

  const staffNames = useMemo(
    () => new Map(staffList.map((s) => [s.id, s.full_name])),
    [staffList],
  )

  // Stale-response guard: filter changes and load-more can overlap; only the
  // newest request may write state, or page-2 of an OLD filter set would
  // append onto a different filter's page-1.
  const generation = useRef(0)
  // Same-tick double-tap guard for the entry-edit trail fetch below:
  // editTrails read in toggleEntryEditTrail is a stale closure until React
  // commits the 'loading' write, so two synchronous clicks would both pass
  // the cache check and double-fetch. A ref is written synchronously.
  const inFlightEditFetches = useRef<Set<string>>(new Set())

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      const myGeneration = ++generation.current
      setLoading(true)
      let res: Awaited<ReturnType<typeof listAuditLog>>
      try {
        res = await listAuditLog({
          category: category ?? undefined,
          actorId: actorId ?? undefined,
          from: presetFrom(range),
          targetId: targetId ?? undefined,
          // I4: 'recording' triggers D1's thread join server-side; absent
          // (undefined) when no target is set, same as today for customer.
          targetType: targetId ? targetType : undefined,
          includeViews,
          breakGlass: breakGlass || undefined,
          // G2 round-4: one real severity value at a time — see the `days`
          // useMemo below, which never re-filters the loaded events.
          severity: lens ?? undefined,
          page: nextPage,
        })
      } catch {
        // Network-level rejection (offline, mid-deploy): surface the error
        // state instead of an unhandled rejection.
        if (myGeneration === generation.current) {
          setError('failed')
          setLoading(false)
        }
        return
      }
      if (myGeneration !== generation.current) return
      if (!res.ok) {
        setError(res.error)
        setLoading(false)
        return
      }
      setError(null)
      setEvents((prev) => (append ? [...prev, ...res.events] : res.events))
      // The totals describe the whole filtered window, which an append (page
      // N+1, same filters) does not change — so a transient probe failure on
      // a later page must not downgrade a known-exact total to the client
      // approximation (or, for break-glass, to the – placeholder). Filter
      // changes go through append=false and take the fresh value either way
      // (Greptile #581 P1 rounds 1+2).
      setBreakGlassTotal((prev) =>
        append && res.breakGlassTotal === null ? prev : res.breakGlassTotal,
      )
      setWarningsTotal((prev) => (append && res.warningsTotal === null ? prev : res.warningsTotal))
      setChangesTotal((prev) => (append && res.changesTotal === null ? prev : res.changesTotal))
      setCriticalTotal((prev) => (append && res.criticalTotal === null ? prev : res.criticalTotal))
      setTargetLabels((prev) => (append ? { ...prev, ...res.targetLabels } : res.targetLabels))
      setPage(res.page)
      setHasMore(res.hasMore)
      setThreadPartial(Boolean(res.threadPartial))
      setLoading(false)
    },
    [category, actorId, range, targetId, targetType, includeViews, breakGlass, lens],
  )

  useEffect(() => {
    void load(1, false)
  }, [load])

  // Filter-change scroll reset (field report 7/28, same class as Greptile
  // #595): a filter tap can collapse a long feed to ~1 row while the user is
  // scrolled deep — the viewport then sits past the new (short) content, so
  // it reads as a white screen and taps hit nothing. Reset so the filter
  // chips + summary strip land in view again. SAME mechanism as #595's fix
  // (SettingsShell.tsx's ONE SCROLL-RESET AUTHORITY effect — that fix started
  // life inside DrillInView, which no longer carries it): walk up from the section root
  // zeroing scrollTop — a no-op on an unscrolled ancestor, and this already
  // covers both targets web/thin split that fix solved (web's ancestor chain
  // ends at <html>, whose scrollTop IS the window scroll in standards mode;
  // thin's ends at its own overflow container). useLayoutEffect, not effect,
  // so the reset lands before paint. Keyed on every state that REPLACES the
  // feed: the seven `load(1, false)` deps (category/actorId/range/targetId/
  // includeViews/breakGlass/lens — G2 round-4: lens is a server filter, not
  // a client-side re-filter, but this effect's own dependency array is
  // independent of load's identity, so it's listed here too).
  // Deliberately NOT keyed on page/events, so a load-more append (same
  // filters, next page) never fires this.
  const rootRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    for (let el = rootRef.current?.parentElement ?? null; el; el = el.parentElement) {
      el.scrollTop = 0
    }
  }, [category, actorId, range, targetId, targetType, includeViews, breakGlass, lens])

  const dayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short' }),
    [locale],
  )
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  )
  // Combined date+time for the entry-edit trail's rows (they can span many
  // days) — same shape as EntryHistorySheet.tsx's dateFmt.
  const editTrailDateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  )

  // Summary strip. 緊急アクセス is server-exact for the whole filter window;
  // 変更/警告/重大 now prefer the server-exact totals (packet 18 T1 — severity/
  // exclude_views probes) when the server returned them (non-null); the +
  // only appears on the fallback path (probes failed/skipped), same as
  // before this packet. G2 (round-4): 警告 and 重大 are counted SEPARATELY —
  // a critical row never counts toward the 警告 tile, even on the client
  // fallback path.
  const stats = useMemo(() => {
    let changes = 0
    let warnings = 0
    let critical = 0
    for (const e of events) {
      if (e.severity === 'critical') critical++
      else if (e.severity === 'warn') warnings++
      else if (!isViewEvent(e.action)) changes++
    }
    return {
      changes: changesTotal ?? changes,
      changesApprox: changesTotal === null && hasMore ? '+' : '',
      warnings: warningsTotal ?? warnings,
      warningsApprox: warningsTotal === null && hasMore ? '+' : '',
      critical: criticalTotal ?? critical,
      criticalApprox: criticalTotal === null && hasMore ? '+' : '',
    }
  }, [events, changesTotal, warningsTotal, criticalTotal, hasMore])

  // Day-grouped feed (device-local dates, same zone the timestamps render in).
  // G2 (round-4): lens is a server filter (see load() above) — `events`
  // already IS the filtered set, so no client-side re-filter here.
  const days = useMemo(() => {
    const groups: { key: string; date: Date; events: AuditLogEvent[] }[] = []
    const byKey = new Map<string, { key: string; date: Date; events: AuditLogEvent[] }>()
    for (const e of events) {
      const d = new Date(e.at)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      let group = byKey.get(key)
      if (!group) {
        group = { key, date: d, events: [] }
        byKey.set(key, group)
        groups.push(group)
      }
      group.events.push(e)
    }
    return groups
  }, [events])

  function actionLabel(action: string): string {
    // Known actions get a JP label; anything new renders as its raw key so a
    // fresh writer never blanks the feed.
    return t.has(`actions.${action}`) ? t(`actions.${action}`) : action
  }

  function roleLabel(role: string): string {
    return tRole.has(`role_${role}`) ? tRole(`role_${role}`) : role
  }

  // I5 — one muted line naming the filter window. {store} is 全店舗 while the
  // log is all-stores-only (PR B2 gate) — reuses the sibling already live in
  // this same auditLog namespace (menuUpdate.allStores) rather than adding a
  // duplicate literal.
  function scopeLineText(): string {
    const days = rangeDays(range)
    const store = t('menuUpdate.allStores')
    return days === null ? t('strip.scopeAll', { store }) : t('strip.scope', { days, store })
  }

  /** Second line of a row: who/what it happened to, plus the change itself
   *  for events whose detail carries before/after. Ids only in the data —
   *  names join from targetLabels (server) or the staff roster (client). */
  function eventSub(e: AuditLogEvent): string | null {
    const detail = (e.detail ?? {}) as Record<string, unknown>
    const targetName = e.target_id
      ? (e.target_type === 'staff' ? staffNames.get(e.target_id) : undefined) ??
        targetLabels[e.target_id] ??
        e.target_id
      : null
    // R7-1 (Liam's phone review, 8/23: "extremely important"): the server
    // already built this line (src/actions/audit-log.ts,
    // listAuditLogWithClient) off the SAME extended targetLabels this page
    // requests — a bare "<from-name> → <to-name>" with no targetName
    // prefix, since the target IS the karute (a different id than either
    // customer here) and prefixing it would just add noise to Liam's ask.
    if (e.action === 'karute.customer_reassign' && e.reassign_customer_line) {
      return e.reassign_customer_line
    }
    // I7 (round-2 D2): the storm has no customer/staff of its own worth
    // naming — count, cost and day are the whole story. cost_cents_estimate
    // is Deepgram $/min USD cents (ai-rate-limit.ts) — formatted as a dollar
    // string, never yen.
    if (e.action === 'recording.transcribe_storm') {
      const n = typeof detail.count === 'number' ? detail.count : 0
      const cost =
        typeof detail.cost_cents_estimate === 'number' ? formatStormCostUsd(detail.cost_cents_estimate) : ''
      const day = typeof detail.day === 'string' ? detail.day : ''
      return t('storm.sub', { n, cost, day })
    }
    if (typeof detail.before_role === 'string' && typeof detail.after_role === 'string') {
      const change = `${roleLabel(detail.before_role)} → ${roleLabel(detail.after_role)}`
      return targetName ? `${targetName} · ${change}` : change
    }
    if (e.action === 'settings.staff_stores_change' && typeof detail.count === 'number') {
      const stores = t('storesCount', { count: detail.count })
      return targetName ? `${targetName} · ${stores}` : stores
    }
    // Booking burn outcome (cancel/no-show): burn_pack alone is the staff's
    // CHOICE, burn_error is what actually happened to it — surface it so a
    // failed/already-consumed burn doesn't read as a clean success.
    if (typeof detail.burn_error === 'string' && detail.burn_error) {
      const label = t.has(`burnError.${detail.burn_error}`)
        ? t(`burnError.${detail.burn_error}`)
        : detail.burn_error
      return targetName ? `${targetName} · ${label}` : label
    }
    // booking.update: what changed, in owner vocabulary.
    if (e.action === 'booking.update' && typeof detail.changed === 'string' && detail.changed) {
      const label = detail.changed
        .split(',')
        .map((c) => (t.has(`changed.${c}`) ? t(`changed.${c}`) : c))
        .join('・')
      return targetName ? `${targetName} · ${label}` : label
    }
    // settings.recording_autostart_toggle: ON vs OFF (detail.enabled) — the
    // two live prod rows render byte-identical without this (stress-audit
    // F5b). The store name is already resolved above via the event's own
    // target (targetType 'store', emitAutostartReceipt).
    if (
      e.action === 'settings.recording_autostart_toggle' &&
      typeof detail.enabled === 'boolean'
    ) {
      return t(detail.enabled ? 'autostartOn' : 'autostartOff', { store: targetName ?? e.target_id ?? '' })
    }
    // settings.menu_update: the TRACKED old/new pairs (changedDetail(),
    // src/actions/menus.ts) rendered compactly, plus name/category as bare
    // "changed" flags — those two are staff free text that can carry PII (a
    // customer's name), so the VALUE never renders (audit.ts's ids/flags/
    // counts-only rule), only that a change happened.
    if (e.action === 'settings.menu_update') {
      const chips: string[] = []
      if (
        typeof detail.duration_minutes_old === 'number' &&
        typeof detail.duration_minutes_new === 'number'
      ) {
        chips.push(
          `${t('menuUpdate.duration')} ${detail.duration_minutes_old}分 → ${detail.duration_minutes_new}分`,
        )
      }
      if (
        typeof detail.price_list_amount_old === 'number' &&
        typeof detail.price_list_amount_new === 'number'
      ) {
        chips.push(
          `${t('menuUpdate.price')} ${yen(detail.price_list_amount_old)} → ${yen(detail.price_list_amount_new)}`,
        )
      }
      if ('price_min_amount_old' in detail || 'price_min_amount_new' in detail) {
        const fmt = (v: unknown) => (typeof v === 'number' ? yen(v) : t('menuUpdate.none'))
        chips.push(
          `${t('menuUpdate.minPrice')} ${fmt(detail.price_min_amount_old)} → ${fmt(detail.price_min_amount_new)}`,
        )
      }
      if ('store_id_old' in detail || 'store_id_new' in detail) {
        // null = 全店舗 (all stores); a non-null id joins via targetLabels,
        // the SAME map resolveTargetLabels() fills for store-target rows —
        // widened server-side to also cover these detail ids.
        const fmt = (v: unknown) =>
          typeof v === 'string' ? (targetLabels[v] ?? v) : t('menuUpdate.allStores')
        chips.push(`${t('menuUpdate.store')} ${fmt(detail.store_id_old)} → ${fmt(detail.store_id_new)}`)
      }
      if (
        typeof detail.online_visible_old === 'boolean' &&
        typeof detail.online_visible_new === 'boolean'
      ) {
        // ON/OFF are literal, not translated — same idiom as the ¥ sign in
        // yen() above (packet spec renders them as bare Latin letters in
        // both locales).
        const onOffLabel = (v: boolean) => (v ? 'ON' : 'OFF')
        chips.push(
          `${t('menuUpdate.onlineVisible')} ${onOffLabel(detail.online_visible_old)} → ${onOffLabel(detail.online_visible_new)}`,
        )
      }
      if (
        typeof detail.display_order_old === 'number' &&
        typeof detail.display_order_new === 'number'
      ) {
        chips.push(`${t('menuUpdate.order')} ${detail.display_order_old} → ${detail.display_order_new}`)
      }
      if (detail.name_changed === true) chips.push(t('menuUpdate.nameChanged'))
      if (detail.category_changed === true) chips.push(t('menuUpdate.categoryChanged'))
      const change = chips.join(' · ')
      if (!change) return targetName
      return targetName ? `${targetName} · ${change}` : change
    }
    // recording.session_cleanup (and any other target_type:'recording' row):
    // the session row is HARD-DELETED at write time, so a resolved customer
    // name (via targetLabels, widened in resolveTargetLabels above) is the
    // best case — an unresolved one must NEVER fall through to the raw
    // session UUID (the field report this fix answers). THREE-WAY, not two
    // (line-read nit): a missing customer_id genuinely means "no customer
    // selected", but a PRESENT customer_id that still isn't in targetLabels
    // (a failed name batch, or a purged customer) is a resolution failure,
    // not an absence — claiming "no customer selected" there would be a
    // false statement about what happened, so that case gets the neutral,
    // no-claim 録音/"Recording" line instead. duration_seconds (when
    // present) rides all three cases as a suffix; legacy rows without it
    // render unchanged.
    if (e.target_type === 'recording') {
      const resolvedName = e.target_id ? targetLabels[e.target_id] : undefined
      const hasCustomerId = typeof detail.customer_id === 'string' && detail.customer_id.length > 0
      const base = resolvedName ?? t(hasCustomerId ? 'recordingUnresolved' : 'recordingNoCustomer')
      const duration =
        typeof detail.duration_seconds === 'number'
          ? t('durationSuffix', { n: detail.duration_seconds })
          : ''
      // #865 (merged 9/9) put staff_id into the assembler's detail — resolve
      // it the same way targetName above resolves a staff target_id (live
      // roster first, then the server's targetLabels fallback for ids the
      // roster can't key — F3, round-2 line-audit: resolveTargetLabels now
      // widens its staff batch to include detail.staff_id off recording rows,
      // same idiom as the customer_id widen two branches up, so a departed
      // staffer's row still names them). Unresolvable → append nothing, never
      // a raw uuid (same rule the customer branch above follows).
      const staffName =
        typeof detail.staff_id === 'string'
          ? (staffNames.get(detail.staff_id) ?? targetLabels[detail.staff_id])
          : undefined
      const staffSuffix = staffName ? ` · ${t('recordingStaff', { name: staffName })}` : ''
      let line = `${base}${duration}${staffSuffix}`
      // I6 (round-2 D2): karute_missing / transcribe_failed append the
      // reason word — mapped from the writer's real value, never the raw
      // code (karuteMissingReasonKey/transcribeFailedReasonKey return null
      // for anything unrecognized, which renders nothing). karute_missing
      // additionally appends the ticket-burned fact when core's bulk check
      // found one; ticket_burned is false/null far more often than true, so
      // this only fires on a real hit.
      if (e.action === 'recording.karute_missing') {
        const reasonKey = karuteMissingReasonKey(detail.reason)
        if (reasonKey) line += ` · ${t(reasonKey)}`
        if (detail.ticket_burned === true) line += ` · ${t('recording.ticketBurned')}`
      } else if (e.action === 'recording.transcribe_failed') {
        const reasonKey = transcribeFailedReasonKey(detail.reason)
        if (reasonKey) line += ` · ${t(reasonKey)}`
      }
      return line
    }
    return targetName
  }

  // Tap a karute.entry_edit / karute.summary_edit row: toggle it open/closed,
  // fetching its trail once (cached by row id thereafter — no refetch on
  // re-expand).
  function toggleEntryEditTrail(e: AuditLogEvent) {
    if (expandedEditId === e.id) {
      setExpandedEditId(null)
      return
    }
    setExpandedEditId(e.id)
    if (editTrails[e.id] || inFlightEditFetches.current.has(e.id)) return
    const detail = (e.detail ?? {}) as Record<string, unknown>
    // summary_edit rows are record-level BY DESIGN (no entry_id — core logs
    // the change with both entry ids null); entry_edit rows need theirs.
    const isSummary = e.action === 'karute.summary_edit'
    const entryId = typeof detail.entry_id === 'string' ? detail.entry_id : null
    const recordId = e.target_id
    if ((!isSummary && !entryId) || !recordId) {
      setEditTrails((prev) => ({ ...prev, [e.id]: { status: 'error' } }))
      return
    }
    inFlightEditFetches.current.add(e.id)
    setEditTrails((prev) => ({ ...prev, [e.id]: { status: 'loading' } }))
    void (async () => {
      try {
        let result: Awaited<ReturnType<typeof listEntryEditHistory>>
        try {
          result = await listEntryEditHistory(recordId)
        } catch {
          setEditTrails((prev) => ({ ...prev, [e.id]: { status: 'error' } }))
          return
        }
        if ('error' in result) {
          setEditTrails((prev) => ({ ...prev, [e.id]: { status: 'error' } }))
          return
        }
        setEditTrails((prev) => ({
          ...prev,
          [e.id]: {
            status: 'ok',
            // Per-ENTRY scope, same join as the edit sheets: the record's full
            // trail, filtered to rows that touch this row's entry_id on either
            // side of a REGEN_REPLACE-style swap — or, for a summary_edit row,
            // to the RECORD-LEVEL rows (both entry ids null = core's
            // summary-edit lineage; SummaryEditSheet's same filter).
            rows: result.edits.filter((r) =>
              isSummary
                ? r.entryIdNew === null && r.entryIdOld === null
                : r.entryIdNew === entryId || r.entryIdOld === entryId,
            ),
            truncated: result.truncated,
          },
        }))
      } finally {
        inFlightEditFetches.current.delete(e.id)
      }
    })()
  }

  function renderEventGroup(group: FoldGroup) {
    // I1 — the representative row (newest member: fold's first-occurrence
    // position IS the newest, since callers always pass one day's events,
    // already newest-first) drives icon/title/actor/entry-edit expand; every
    // member of the group shares the same (action, target_type, target_id,
    // actor_id) by construction.
    const e = group.events[0]!
    const many = group.events.length > 1
    const Icon = CATEGORY_ICONS[e.category] ?? Activity
    const sub = eventSub(e)
    // I1 — the fold count badge + time range. Range is computed from the
    // WHOLE group (not assumed pre-sorted) and joins the sub-line, not the
    // single-time slot — a folded row's own time stays the representative's.
    const foldRange = many
      ? (() => {
          const times = group.events.map((x) => Date.parse(x.at)).sort((a, b) => a - b)
          return t('fold.range', {
            from: timeFmt.format(new Date(times[0]!)),
            to: timeFmt.format(new Date(times[times.length - 1]!)),
          })
        })()
      : null
    const subText = foldRange ? (sub ? `${sub} · ${foldRange}` : foldRange) : sub
    // I4 — a recording row's sub-line is the tap target that opens its
    // thread, UNLESS a recording thread is already open (tapping inside it
    // again would be a no-op reload of the same thing).
    const isRecordingLink =
      e.target_type === 'recording' && Boolean(e.target_id) && !(targetId && targetType === 'recording')
    // Mock 840dd1d1 note 3: view rows mix into the feed as
    // muted gray lines, so 変更 rows stay the eye's anchor when
    // 閲覧を含む is ON. Severity coloring still wins on the icon.
    const isView = isViewEvent(e.action)
    // Durable label wins (packet 18 T3, SDK 1.14 write-time
    // snapshot) — the live roster is only a fallback for rows
    // written before core started sending it; 不明 last. System
    // rows keep their own distinct label (unaffected — core
    // never resolves a label for a null actor_id).
    // || not ?? — an empty-string snapshot must fall through to
    // the roster/不明 chain, never render a blank (Greptile #581 P2).
    // I2 (round-2 D2): a system row names the automation FAMILY that wrote
    // it (自動文字起こし/自動復元/自動チェック/自動消化/自動破棄) when one
    // matches; any other system row keeps today's plain システム.
    const autoLabelKey = e.actor_type === 'system' ? automationLabelKey(e.action) : null
    const actorName =
      e.actor_type === 'system'
        ? autoLabelKey
          ? t(autoLabelKey)
          : t('systemActor')
        : e.actor_label ||
          ((e.actor_id && staffNames.get(e.actor_id)) || t('unknownActor'))
    const isEntryEdit =
      e.action === 'karute.entry_edit' || e.action === 'karute.summary_edit'
    const isOpen = isEntryEdit && expandedEditId === e.id
    const trail = isEntryEdit ? editTrails[e.id] : undefined
    return (
      <li key={group.key} className="flex flex-col px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span
            className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
              e.severity === 'critical'
                ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                : e.severity === 'warn'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground'
            }`}
            aria-hidden
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span
                className={
                  isView
                    ? 'text-sm text-muted-foreground'
                    : 'text-sm font-medium text-foreground'
                }
              >
                {actionLabel(e.action)}
              </span>
              {many && (
                <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground tabular-nums">
                  {t('fold.count', { n: group.events.length })}
                </span>
              )}
              {e.break_glass && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                  <ShieldAlert className="size-3" />
                  {t('breakGlassChip')}
                </span>
              )}
            </div>
            {subText &&
              (isRecordingLink ? (
                // I4 — one tap target, the whole sub-line: opens this
                // recording's thread (target rows ∪ the joined karute/pack
                // rows, D1's join). F7(b) ceiling: the join can walk up to
                // ~28 serialized core calls / ~4,000 rows (LENS-PR-D1-BLIND
                // §3) before CORE-19's action/detail filters remove it.
                // F4 fix (blind lens finding 4): clear the rendered feed and
                // force the loading idiom in THIS SAME state update — the
                // effect that fires load() also sets loading, but only on
                // its next tick, and without clearing `events` here the
                // previous feed's rows (a different recording's story)
                // would render under the thread's own title for that gap.
                <button
                  type="button"
                  onClick={() => {
                    setEvents([])
                    setLoading(true)
                    setTargetType('recording')
                    setTargetId(e.target_id)
                  }}
                  className="block truncate border-b border-dotted border-muted-foreground/50 text-left text-xs text-muted-foreground hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400"
                >
                  {subText}
                </button>
              ) : (
                <p className="truncate text-xs text-muted-foreground">{subText}</p>
              ))}
          </div>
          <div className="shrink-0 text-right">
            {e.actor_type === 'system' || !e.actor_id ? (
              <div className={`text-xs ${isView ? 'text-muted-foreground' : 'text-foreground'}`}>
                {actorName}
              </div>
            ) : (
              // §10 cause-based investigation: an actor name is a
              // one-tap person filter. Raw events only — never stats.
              <button
                type="button"
                onClick={() => {
                  setActorId(e.actor_id)
                  setLens(null)
                }}
                className={`border-b border-dotted border-muted-foreground/50 text-xs hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400 ${
                  isView ? 'text-muted-foreground' : 'text-foreground'
                }`}
              >
                {actorName}
              </button>
            )}
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {timeFmt.format(new Date(e.at))}
            </div>
          </div>
          {isEntryEdit && (
            // §11 expand: what was edited, not just that an edit
            // happened. Same onClick idiom as the actor-name
            // button above — a dedicated control, not the whole
            // row (the actor button already lives inside it).
            <button
              type="button"
              onClick={() => toggleEntryEditTrail(e)}
              aria-label={t('entryEditToggle')}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <ChevronDown
                className={`size-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>
        {isOpen && (
          <div className="ml-11 mt-2 rounded-lg border border-border/60 bg-muted/30 p-3">
            {/* Greptile P1, superseded 2026-08-19: the karute.entry_edit
                emit now carries detail.entry_edit_id (app-side fix, this
                PR — rows emitted before it lack the field, and a degraded
                core response writes null), so exact per-event pairing IS
                possible. This panel still deliberately shows the ENTRY's
                whole trail, not just this audit row's own change; wiring
                the precise entry_edit_id filter is a queued follow-up. */}
            {trail?.status === 'ok' && (
              <p className="mb-2 text-[11px] text-muted-foreground">
                {t(
                  e.action === 'karute.summary_edit'
                    ? 'summaryEditTrailTitle'
                    : 'entryEditTrailTitle',
                  { count: trail.rows.length },
                )}
              </p>
            )}
            {(!trail || trail.status === 'loading') && (
              <p className="text-xs text-muted-foreground">{tc('loading')}</p>
            )}
            {trail?.status === 'error' && (
              <p className="text-xs text-red-500">{t('entryEditError')}</p>
            )}
            {trail?.status === 'ok' && trail.rows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {/* Truncated + zero-match means rows may sit past
                    the cap — never claim the record was deleted.
                    Non-truncated zero-match: entryEditDeleted's
                    copy states the RULE (a deleted karute's
                    history dies with it) without asserting THIS
                    is that case — the read has a documented
                    offset-drift gap (listEntryEditHistoryWithClient,
                    src/actions/karute.ts) that can also return
                    empty for an intact record, and this is a
                    dispute-investigation surface. */}
                {trail.truncated ? t('entryEditPartial') : t('entryEditDeleted')}
              </p>
            )}
            {trail?.status === 'ok' && trail.rows.length > 0 && (
              <>
                <ul className="flex flex-col gap-2">
                  {trail.rows.map((row) => {
                    const ts = formatEditTrailTimestamp(row.createdAt, editTrailDateFmt)
                    return (
                      <li
                        key={row.id}
                        className="flex flex-col gap-1 rounded-md border border-border/60 bg-background p-2.5"
                      >
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {row.actorName ?? t('unknownActor')}
                          </span>
                          {ts && <span className="tabular-nums">{ts}</span>}
                        </div>
                        {row.contentBefore !== null && (
                          <p className="text-xs leading-relaxed text-muted-foreground line-through">
                            {row.contentBefore}
                          </p>
                        )}
                        {row.contentAfter !== null && (
                          <p className="text-xs leading-relaxed text-foreground">
                            {row.contentAfter}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
                {trail.truncated && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {t('entryEditPartial')}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <div ref={rootRef} className="space-y-4">
      {/* I4 — a thread (either kind) swaps the section label for a back
       *  button + a title naming what the thread is about; the plain feed
       *  keeps today's label/description. */}
      {targetId ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={closeTarget}
            aria-label={t('clearTarget')}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h3 className="text-lg font-semibold">
            {targetType === 'recording' ? t('thread.title') : t('thread.customerTitle')}
          </h3>
        </div>
      ) : (
        <div>
          <h3 className="text-lg font-semibold">{t('label')}</h3>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
      )}

      {/* Dispute-view banner — customer thread only; the recording thread's
       *  own title above already says what this view is (⚖ NO I8: no chip,
       *  no door, no explanation sentence beyond this existing line). */}
      {targetId && targetType === 'customer' && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sm text-sky-700 dark:text-sky-300">
          <Eye className="size-4 shrink-0" />
          <span className="flex-1">{t('targetFilter')}</span>
        </div>
      )}

      {/* I4 — the honest partial line: some of this recording's own history
       *  could not be walked (a failed recording lookup, or an inner walk
       *  that hit its page cap). Reuses the section's own loading idiom
       *  while the read is in flight — this only shows once it settles. */}
      {targetId && targetType === 'recording' && threadPartial && !loading && (
        <p className="text-xs text-muted-foreground">{t('thread.partial')}</p>
      )}

      {/* Toolbar (§11 filters, owner-vocabulary form): category + person
       *  dropdowns, 期間 segments, the two on/off filters as icon chips.
       *  F3 fix (blind lens finding 3): ALWAYS visible, exactly as on main
       *  e478c2500 — a targetId (customer dispute OR a tapped recording
       *  thread) never hides it; the title row above is additive, never a
       *  replacement. For a recording thread the toolbar's category/staff/
       *  severity controls stay visible for continuity but the thread's own
       *  read ignores them (F5, load() below) — only 期間/閲覧を含む apply. */}
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarSelect
          label={t('categoryLabel')}
          value={category ?? ''}
          onChange={(v) => setCategory(v || null)}
          options={[
            { value: '', label: t('allCategories') },
            ...CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) })),
          ]}
        />
        <ToolbarSelect
          label={t('staffLabel')}
          value={actorId ?? ''}
          onChange={(v) => {
            setActorId(v || null)
            setLens(null)
          }}
          options={[
            { value: '', label: t('staffAll') },
            ...staffList.map((s) => ({ value: s.id, label: s.full_name ?? s.id })),
          ]}
        />
        <span className="inline-flex overflow-hidden rounded-lg border border-border">
          {RANGE_PRESETS.map((r, i) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                i > 0 ? 'border-l border-border' : ''
              } ${
                range === r
                  ? 'bg-primary/8 text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t(`range.${r}`)}
            </button>
          ))}
        </span>
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <FilterChip
          active={includeViews}
          onClick={() => setIncludeViews((v) => !v)}
          icon={<Eye className="size-3.5" />}
        >
          {t('includeViews')}
        </FilterChip>
        <FilterChip
          active={breakGlass}
          onClick={() => {
            // Entering break-glass view clears any severity lens by every
            // path (tile AND chip): info-severity break-glass rows would be
            // lens-filtered into a count-above-empty-feed contradiction.
            if (!breakGlass) setLens(null)
            setBreakGlass(!breakGlass)
          }}
          icon={<ShieldAlert className="size-3.5" />}
        >
          {t('breakGlass')}
        </FilterChip>
      </div>

      {/* Summary strip — 「何か問題は？」 answered before the rows. Amber and
       *  red are one-tap filters straight to those events. F3 fix: no longer
       *  hidden by targetId — same visibility rule as main e478c2500
       *  (actorId only; a person filter hides the strip everywhere, thread
       *  or not, since it never showed per-staff counts). */}
      {!error && !actorId && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-border bg-background px-3.5 py-2">
            <span className="text-lg font-semibold leading-none tabular-nums">
              {stats.changes}
              {stats.changesApprox}
            </span>
            <span className="text-xs text-muted-foreground">{t('statsChanges')}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              // Mutual exclusion with break-glass (both directions, all
              // paths): a severity lens over a break-glass feed would hide
              // its info-severity rows under a nonzero count.
              const next = lens === 'warn' ? null : 'warn'
              if (next) setBreakGlass(false)
              setLens(next)
            }}
            className={`inline-flex items-baseline gap-1.5 rounded-lg px-3.5 py-2 text-amber-700 transition-colors dark:text-amber-400 ${
              lens === 'warn' ? 'bg-amber-500/25 ring-1 ring-amber-500/40' : 'bg-amber-500/10 hover:bg-amber-500/20'
            }`}
          >
            <span className="text-lg font-semibold leading-none tabular-nums">
              {stats.warnings}
              {stats.warningsApprox}
            </span>
            <span className="text-xs">{t('statsWarnings')}</span>
          </button>
          {/* G2 (round-4 line-audit): each tile shows exactly what its tap
           *  opens — warn and critical never share a screen. Shown only when
           *  there's something to show (server-exact criticalTotal, or the
           *  client fallback count while probes are degraded), same idiom
           *  as the 警告/変更 tiles' own fallback. */}
          {stats.critical > 0 && (
            <button
              type="button"
              onClick={() => {
                const next = lens === 'critical' ? null : 'critical'
                if (next) setBreakGlass(false)
                setLens(next)
              }}
              className={`inline-flex items-baseline gap-1.5 rounded-lg px-3.5 py-2 text-red-700 transition-colors dark:text-red-400 ${
                lens === 'critical' ? 'bg-red-500/25 ring-1 ring-red-500/40' : 'bg-red-500/10 hover:bg-red-500/20'
              }`}
            >
              <span className="text-lg font-semibold leading-none tabular-nums">
                {stats.critical}
                {stats.criticalApprox}
              </span>
              <span className="text-xs">{t('statsCritical')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setLens(null)
              setBreakGlass(true)
            }}
            className="inline-flex items-baseline gap-1.5 rounded-lg bg-red-500/10 px-3.5 py-2 text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-400"
          >
            <span className="text-lg font-semibold leading-none tabular-nums">
              {breakGlassTotal ?? '–'}
            </span>
            <span className="text-xs">{t('statsBreakGlass')}</span>
          </button>
        </div>
      )}

      {/* I5 — one muted line naming the filter window, under the strip.
       *  F3/F5 fix: renders in thread mode too (LENS finding 5 — the scope
       *  line is the one honest statement of the window a recording thread
       *  is drawn from; hiding it while silently narrowing the read was the
       *  bug). Hidden only with the strip (actorId — same as main). */}
      {!error && !actorId && (
        <p className="text-xs text-muted-foreground/70">{scopeLineText()}</p>
      )}

      {error ? (
        <div className="rounded-lg border border-dashed border-border/50 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
          {t(error === 'forbidden' ? 'errorForbidden' : 'errorLoad')}
        </div>
      ) : days.length === 0 && !loading ? (
        // ④ round-2: ALWAYS shows now (not suppressed while hasMore) — a
        // filtered page that came back blank used to read as broken, with
        // only さらに読み込む on an otherwise-empty screen. hasMore picks the
        // honest wording; the load-more button (below, unconditional on
        // hasMore) stays the CTA either way.
        <div className="rounded-lg border border-dashed border-border/50 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
          {t(hasMore ? 'emptyPage' : 'empty')}
        </div>
      ) : (
        days.map((day) => (
          <div key={day.key}>
            <div className="mb-2 flex items-baseline gap-2 text-xs font-semibold text-muted-foreground">
              {dayFmt.format(day.date)}
              <span className="font-normal text-muted-foreground/60">
                {t('eventsCount', { count: day.events.length })}
              </span>
            </div>
            <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
              {foldRepeats(day.events).map((group) => renderEventGroup(group))}
            </ul>
          </div>
        ))
      )}

      {loading && (
        <div className="flex justify-center py-2">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {!loading && hasMore && !error && (
        <button
          type="button"
          onClick={() => void load(page + 1, true)}
          className="w-full rounded-lg border border-border py-2 text-sm text-muted-foreground hover:bg-muted"
        >
          {t('loadMore')}
        </button>
      )}
    </div>
  )
}

function ToolbarSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background py-1.5 pl-3 pr-7 text-xs font-medium">
      <span className="text-muted-foreground">{label}:</span>
      <span>{options.find((o) => o.value === value)?.label ?? value}</span>
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function FilterChip({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border-primary bg-primary/8 text-primary'
          : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}
