'use client'

// 監査ログ viewer (AUDIT-LOG-DESIGN.md §11). Default feed = changes + notice/
// warning only — view events outnumber changes ~10:1 and would bury edits; the
// 「閲覧を含む」 toggle opts them in. The per-customer deep-link
// (/settings?tab=audit&target=<id>) INVERTS that default: it IS the dispute
// view, so every access to that person's record shows.
// I7 (hard invariant): this surface never renders per-staff aggregation —
// counts, rates, rankings. Raw events only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Eye, Loader2, ShieldAlert, X } from 'lucide-react'
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

const RANGE_PRESETS = ['7d', '30d', '90d', 'all'] as const
type RangePreset = (typeof RANGE_PRESETS)[number]

function presetFrom(preset: RangePreset): string | undefined {
  if (preset === 'all') return undefined
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

interface AuditLogSectionProps {
  staffList: StaffMember[]
  /** Customer id from the privacy-tab deep-link (?tab=audit&target=…). */
  initialTargetId?: string | null
}

export function AuditLogSection({ staffList, initialTargetId }: AuditLogSectionProps) {
  const t = useTranslations('settings.auditLog')
  const locale = useLocale()

  const [category, setCategory] = useState<string | null>(null)
  const [range, setRange] = useState<RangePreset>('30d')
  // Deep-link opens the dispute view: views INCLUDED (§11 inversion).
  const [targetId, setTargetId] = useState(initialTargetId ?? null)
  const [includeViews, setIncludeViews] = useState(Boolean(initialTargetId))
  const [breakGlass, setBreakGlass] = useState(false)

  const [events, setEvents] = useState<AuditLogEvent[]>([])
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
      const res = await listAuditLog({
        category: category ?? undefined,
        from: presetFrom(range),
        targetId: targetId ?? undefined,
        includeViews,
        breakGlass: breakGlass || undefined,
        page: nextPage,
        logOpen,
      })
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
      setPage(res.page)
      setHasMore(res.hasMore)
      setLoading(false)
    },
    [category, range, targetId, includeViews, breakGlass],
  )

  useEffect(() => {
    void load(1, false)
  }, [load])

  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  )

  function actionLabel(action: string): string {
    // Known actions get a JP label; anything new renders as its raw key so a
    // fresh writer never blanks the feed.
    return t.has(`actions.${action}`) ? t(`actions.${action}`) : action
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

      {/* Filter row: category chips + 期間 + toggles (§11). */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={category === null} onClick={() => setCategory(null)}>
          {t('allCategories')}
        </FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
            {t(`categories.${c}`)}
          </FilterChip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGE_PRESETS.map((r) => (
          <FilterChip key={r} active={range === r} onClick={() => setRange(r)}>
            {t(`range.${r}`)}
          </FilterChip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <FilterChip active={includeViews} onClick={() => setIncludeViews((v) => !v)}>
          {t('includeViews')}
        </FilterChip>
        <FilterChip active={breakGlass} onClick={() => setBreakGlass((v) => !v)}>
          {t('breakGlass')}
        </FilterChip>
      </div>

      {error ? (
        <div className="rounded-lg border border-dashed border-border/50 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
          {t(error === 'forbidden' ? 'errorForbidden' : 'errorLoad')}
        </div>
      ) : events.length === 0 && !loading && !hasMore ? (
        // Suppressed while hasMore: a page can view-filter to empty though
        // older non-view rows remain — the load-more button stays the CTA.
        <div className="rounded-lg border border-dashed border-border/50 bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-4 py-3">
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${
                  e.severity === 'critical'
                    ? 'bg-red-500'
                    : e.severity === 'warn'
                      ? 'bg-amber-500'
                      : 'bg-muted-foreground/40'
                }`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {actionLabel(e.action)}
                  </span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t.has(`categories.${e.category}`) ? t(`categories.${e.category}`) : e.category}
                  </span>
                  {e.break_glass && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
                      <ShieldAlert className="size-3" />
                      {t('breakGlassChip')}
                    </span>
                  )}
                </div>
                {e.target_id && (
                  <p className="truncate text-xs text-muted-foreground">
                    {e.target_type ?? ''} {e.target_label ?? e.target_id}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-foreground">
                  {e.actor_type === 'system'
                    ? t('systemActor')
                    : (e.actor_id && staffNames.get(e.actor_id)) || t('unknownActor')}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {timeFmt.format(new Date(e.at))}
                </div>
              </div>
            </li>
          ))}
        </ul>
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

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  )
}
