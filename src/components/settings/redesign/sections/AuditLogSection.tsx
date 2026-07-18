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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Activity,
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
  X,
} from 'lucide-react'
import type { StaffMember } from '@/lib/staff'
import { listAuditLog, type AuditLogEvent } from '@/actions/audit-log'

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
}

const RANGE_PRESETS = ['7d', '30d', '90d', 'all'] as const
type RangePreset = (typeof RANGE_PRESETS)[number]

function presetFrom(preset: RangePreset): string | undefined {
  if (preset === 'all') return undefined
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function isViewEvent(action: string): boolean {
  return action.endsWith('.view') || action.endsWith('_view')
}

interface AuditLogSectionProps {
  staffList: StaffMember[]
  /** Customer id from the privacy-tab deep-link (?tab=audit&target=…). */
  initialTargetId?: string | null
}

export function AuditLogSection({ staffList, initialTargetId }: AuditLogSectionProps) {
  const t = useTranslations('settings.auditLog')
  const tRole = useTranslations('settings.permissions')
  const locale = useLocale()

  const [category, setCategory] = useState<string | null>(null)
  const [actorId, setActorId] = useState<string | null>(null)
  const [range, setRange] = useState<RangePreset>('30d')
  // Deep-link opens the dispute view: views INCLUDED (§11 inversion).
  const [targetId, setTargetId] = useState(initialTargetId ?? null)
  const [includeViews, setIncludeViews] = useState(Boolean(initialTargetId))
  const [breakGlass, setBreakGlass] = useState(false)
  // Display-side lens from tapping the 警告 stat (core has no severity filter
  // yet — Anthony ask; until then this narrows the loaded window client-side).
  const [warnOnly, setWarnOnly] = useState(false)

  const [events, setEvents] = useState<AuditLogEvent[]>([])
  const [breakGlassTotal, setBreakGlassTotal] = useState(0)
  const [targetLabels, setTargetLabels] = useState<Record<string, string>>({})
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'forbidden' | 'failed' | null>(null)

  const staffNames = useMemo(
    () => new Map(staffList.map((s) => [s.id, s.full_name])),
    [staffList],
  )

  // Stale-response guard: filter changes and load-more can overlap; only the
  // newest request may write state, or page-2 of an OLD filter set would
  // append onto a different filter's page-1.
  const generation = useRef(0)
  // One privacy.audit_log_view row per section open — not per filter click.
  // Two refs close both race directions: logged-after-success means a failed
  // first fetch retries the row; pending-while-in-flight means an overlapping
  // filter click can't send a duplicate.
  const openLogged = useRef(false)
  const openLogPending = useRef(false)

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      const myGeneration = ++generation.current
      setLoading(true)
      const logOpen = !openLogged.current && !openLogPending.current
      if (logOpen) openLogPending.current = true
      let res: Awaited<ReturnType<typeof listAuditLog>>
      try {
        res = await listAuditLog({
          category: category ?? undefined,
          actorId: actorId ?? undefined,
          from: presetFrom(range),
          targetId: targetId ?? undefined,
          includeViews,
          breakGlass: breakGlass || undefined,
          page: nextPage,
          logOpen,
        })
      } catch {
        // Network-level rejection (offline, mid-deploy): release the pending
        // flag so the retry re-sends logOpen, and surface the error state
        // instead of an unhandled rejection.
        if (logOpen) openLogPending.current = false
        if (myGeneration === generation.current) {
          setError('failed')
          setLoading(false)
        }
        return
      }
      // Settle the open-log state BEFORE the stale-response return: even a
      // superseded request wrote the row server-side iff it succeeded.
      if (logOpen) {
        openLogPending.current = false
        if (res.ok) openLogged.current = true
      }
      if (myGeneration !== generation.current) return
      if (!res.ok) {
        setError(res.error)
        setLoading(false)
        return
      }
      setError(null)
      setEvents((prev) => (append ? [...prev, ...res.events] : res.events))
      setBreakGlassTotal(res.breakGlassTotal)
      setTargetLabels((prev) => (append ? { ...prev, ...res.targetLabels } : res.targetLabels))
      setPage(res.page)
      setHasMore(res.hasMore)
      setLoading(false)
    },
    [category, actorId, range, targetId, includeViews, breakGlass],
  )

  useEffect(() => {
    void load(1, false)
  }, [load])

  const dayFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short' }),
    [locale],
  )
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  )

  // Summary strip. 緊急アクセス is server-exact for the whole filter window;
  // 変更/警告 count the loaded window — the + marks "more pages exist", which
  // upgrades to exact totals when core grows a severity filter (Anthony ask).
  const stats = useMemo(() => {
    let changes = 0
    let warnings = 0
    for (const e of events) {
      if (e.severity === 'warn' || e.severity === 'critical') warnings++
      else if (!isViewEvent(e.action)) changes++
    }
    return { changes, warnings }
  }, [events])
  const approx = hasMore ? '+' : ''

  // Day-grouped feed (device-local dates, same zone the timestamps render in).
  const days = useMemo(() => {
    const visible = warnOnly
      ? events.filter((e) => e.severity === 'warn' || e.severity === 'critical')
      : events
    const groups: { key: string; date: Date; events: AuditLogEvent[] }[] = []
    const byKey = new Map<string, { key: string; date: Date; events: AuditLogEvent[] }>()
    for (const e of visible) {
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
  }, [events, warnOnly])

  function actionLabel(action: string): string {
    // Known actions get a JP label; anything new renders as its raw key so a
    // fresh writer never blanks the feed.
    return t.has(`actions.${action}`) ? t(`actions.${action}`) : action
  }

  function roleLabel(role: string): string {
    return tRole.has(`role_${role}`) ? tRole(`role_${role}`) : role
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
    if (typeof detail.before_role === 'string' && typeof detail.after_role === 'string') {
      const change = `${roleLabel(detail.before_role)} → ${roleLabel(detail.after_role)}`
      return targetName ? `${targetName} · ${change}` : change
    }
    if (e.action === 'settings.staff_stores_change' && typeof detail.count === 'number') {
      const stores = t('storesCount', { count: detail.count })
      return targetName ? `${targetName} · ${stores}` : stores
    }
    return targetName
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{t('label')}</h3>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {/* Dispute-view chip — present only via the per-customer deep-link. */}
      {targetId && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sm text-sky-700 dark:text-sky-300">
          <Eye className="size-4 shrink-0" />
          <span className="flex-1">{t('targetFilter')}</span>
          <button
            type="button"
            onClick={() => {
              setTargetId(null)
              setIncludeViews(false)
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium hover:bg-sky-500/10"
          >
            <X className="size-3.5" />
            {t('clearTarget')}
          </button>
        </div>
      )}

      {/* Toolbar (§11 filters, owner-vocabulary form): category + person
       *  dropdowns, 期間 segments, the two on/off filters as icon chips. */}
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
          onChange={(v) => setActorId(v || null)}
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
                  ? 'bg-foreground text-background'
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
          onClick={() => setBreakGlass((v) => !v)}
          icon={<ShieldAlert className="size-3.5" />}
        >
          {t('breakGlass')}
        </FilterChip>
      </div>

      {/* Summary strip — 「何か問題は？」 answered before the rows. Amber and
       *  red are one-tap filters straight to those events. */}
      {!error && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-border bg-background px-3.5 py-2">
            <span className="text-lg font-semibold leading-none tabular-nums">
              {stats.changes}
              {approx}
            </span>
            <span className="text-xs text-muted-foreground">{t('statsChanges')}</span>
          </span>
          <button
            type="button"
            onClick={() => setWarnOnly((v) => !v)}
            className={`inline-flex items-baseline gap-1.5 rounded-lg px-3.5 py-2 text-amber-700 transition-colors dark:text-amber-400 ${
              warnOnly ? 'bg-amber-500/25 ring-1 ring-amber-500/40' : 'bg-amber-500/10 hover:bg-amber-500/20'
            }`}
          >
            <span className="text-lg font-semibold leading-none tabular-nums">
              {stats.warnings}
              {approx}
            </span>
            <span className="text-xs">{t('statsWarnings')}</span>
          </button>
          <button
            type="button"
            onClick={() => setBreakGlass(true)}
            className="inline-flex items-baseline gap-1.5 rounded-lg bg-red-500/10 px-3.5 py-2 text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-400"
          >
            <span className="text-lg font-semibold leading-none tabular-nums">
              {breakGlassTotal}
            </span>
            <span className="text-xs">{t('statsBreakGlass')}</span>
          </button>
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-dashed border-border/50 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
          {t(error === 'forbidden' ? 'errorForbidden' : 'errorLoad')}
        </div>
      ) : days.length === 0 && !loading && !hasMore ? (
        // Suppressed while hasMore: a page can view-filter to empty though
        // older non-view rows remain — the load-more button stays the CTA.
        <div className="rounded-lg border border-dashed border-border/50 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
          {t('empty')}
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
              {day.events.map((e) => {
                const Icon = CATEGORY_ICONS[e.category] ?? Activity
                const sub = eventSub(e)
                const actorName =
                  e.actor_type === 'system'
                    ? t('systemActor')
                    : (e.actor_id && staffNames.get(e.actor_id)) || t('unknownActor')
                return (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
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
                        <span className="text-sm font-medium text-foreground">
                          {actionLabel(e.action)}
                        </span>
                        {e.break_glass && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                            <ShieldAlert className="size-3" />
                            {t('breakGlassChip')}
                          </span>
                        )}
                      </div>
                      {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      {e.actor_type === 'system' || !e.actor_id ? (
                        <div className="text-xs text-foreground">{actorName}</div>
                      ) : (
                        // §10 cause-based investigation: an actor name is a
                        // one-tap person filter. Raw events only — never stats.
                        <button
                          type="button"
                          onClick={() => setActorId(e.actor_id)}
                          className="border-b border-dotted border-muted-foreground/50 text-xs text-foreground hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400"
                        >
                          {actorName}
                        </button>
                      )}
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {timeFmt.format(new Date(e.at))}
                      </div>
                    </div>
                  </li>
                )
              })}
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
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}
