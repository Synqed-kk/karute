'use client'

import { useState, useCallback } from 'react'
import { useLocale } from 'next-intl'
import { Link } from '@/i18n/navigation'
import {
  FileText,
  Clock,
  Camera,
  User,
  Sparkles,
  ChevronRight,
  Gift,
  Lightbulb,
  Check,
  X,
  Upload,
  Image as ImageIcon,
  Calendar,
  BarChart3,
  RefreshCw,
  MessageSquare,
  Star,
  Flag,
  Filter,
  Save,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCategoryConfig } from '@/lib/karute/categories'
import type { CustomerRow } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntryData = {
  id: string
  category: string
  content: string
  source_quote: string | null
  confidence_score: number | null
  is_manual: boolean
  created_at: string
}

type KaruteRecordWithEntries = {
  id: string
  created_at: string
  session_date: string
  summary: string | null
  transcript: string | null
  staff_profile_id: string | null
  profiles: { full_name: string } | null
  entries: EntryData[]
}

interface CustomerDetailTabsProps {
  customer: CustomerRow
  karuteRecords: KaruteRecordWithEntries[]
  totalVisitCount: number
  locale: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'ai-history', label: 'AI History', icon: Sparkles },
  { key: 'karute', label: 'Karute', icon: FileText },
  { key: 'photos', label: 'Photos', icon: Camera },
] as const

type TabKey = (typeof TABS)[number]['key']

const PROFESSIONAL_CATEGORIES = new Set([
  'treatment',
  'symptom',
  'body_area',
  'product',
])
const PERSONAL_CATEGORIES = new Set([
  'preference',
  'lifestyle',
  'next_visit',
  'other',
])

const TIMELINE_FILTER_OPTIONS = [
  'Visit',
  'Treatment',
  'Notes',
  'Photos',
  'Contact',
  'Import',
  'Milestone',
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string, locale: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(dateStr: string, locale: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function daysSince(dateStr: string): number {
  const date = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
}

function groupEntriesByType(entries: EntryData[]) {
  const professional: EntryData[] = []
  const personal: EntryData[] = []

  for (const entry of entries) {
    if (PROFESSIONAL_CATEGORIES.has(entry.category)) {
      professional.push(entry)
    } else if (PERSONAL_CATEGORIES.has(entry.category)) {
      personal.push(entry)
    } else {
      // Default to personal for unknown categories
      personal.push(entry)
    }
  }

  return { professional, personal }
}

function getTopTopics(
  entries: EntryData[],
  categorySet: Set<string>,
  limit = 5,
): { category: string; count: number }[] {
  const counts: Record<string, number> = {}
  for (const entry of entries) {
    if (categorySet.has(entry.category)) {
      counts[entry.category] = (counts[entry.category] || 0) + 1
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([category, count]) => ({ category, count }))
}

// ---------------------------------------------------------------------------
// Category Badge
// ---------------------------------------------------------------------------

function CategoryBadge({ category }: { category: string }) {
  const config = getCategoryConfig(category)
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${config.color}`}
    >
      {config.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function CustomerDetailTabs({
  customer,
  karuteRecords,
  totalVisitCount,
}: CustomerDetailTabsProps) {
  const locale = useLocale()
  const [activeTab, setActiveTab] = useState<TabKey>('ai-history')

  return (
    <div>
      {/* Sticky Tab Navigation */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm pb-4 pt-2">
        <div className="flex items-center gap-1.5 rounded-xl bg-muted/50 p-1.5">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                }`}
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="mt-2">
        {activeTab === 'karute' && (
          <KaruteTab
            karuteRecords={karuteRecords}
            locale={locale}
          />
        )}
        {activeTab === 'photos' && <PhotosTab />}
        {activeTab === 'ai-history' && (
          <AIHistoryTab karuteRecords={karuteRecords} locale={locale} />
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// Tab 1: Karute
// ===========================================================================

function KaruteTab({
  karuteRecords,
  locale,
}: {
  karuteRecords: KaruteRecordWithEntries[]
  locale: string
}) {
  if (karuteRecords.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Karute History</h2>
        <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <FileText className="size-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No karute records yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Records will appear here after recording a session
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Advice for Next Visit */}
      <AdviceCard karuteRecords={karuteRecords} locale={locale} />

      {/* AI Recommended Actions */}
      <RecommendedActionsCard karuteRecords={karuteRecords} />

      <h2 className="text-lg font-semibold">Karute History</h2>

      {/* Karute Records */}
      <div className="space-y-4">
        {karuteRecords.map((record) => (
          <KaruteRecordCard key={record.id} record={record} locale={locale} />
        ))}
      </div>
    </div>
  )
}

function KaruteRecordCard({
  record,
  locale,
}: {
  record: KaruteRecordWithEntries
  locale: string
}) {
  const { professional, personal } = groupEntriesByType(record.entries)

  return (
    <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
      {/* Header row: date, badges, status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {formatDateTime(record.session_date, locale)}
          </span>
          <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">
            Salon
          </span>
          <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
            Approved
          </span>
        </div>
        {record.profiles?.full_name && (
          <span className="text-xs text-muted-foreground">
            {record.profiles.full_name}
          </span>
        )}
      </div>

      {/* AI Summary */}
      {record.summary && (
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          {record.summary}
        </p>
      )}

      {/* Entries grouped by Professional / Personal */}
      {record.entries.length > 0 && (
        <div className="space-y-3 mb-4">
          {professional.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Professional
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {professional.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted/30 px-2.5 py-1.5"
                  >
                    <CategoryBadge category={entry.category} />
                    <span className="text-xs text-foreground/80 line-clamp-1">
                      {entry.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {personal.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Personal
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {personal.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted/30 px-2.5 py-1.5"
                  >
                    <CategoryBadge category={entry.category} />
                    <span className="text-xs text-foreground/80 line-clamp-1">
                      {entry.content}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* View Details link */}
      <Link
        href={`/karute/${record.id}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
      >
        View Details
        <ChevronRight className="size-3.5" />
      </Link>
    </div>
  )
}

function AdviceCard({
  karuteRecords,
  locale,
}: {
  karuteRecords: KaruteRecordWithEntries[]
  locale: string
}) {
  const [advice, setAdvice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetched, setFetched] = useState(false)

  const latestRecord = karuteRecords[0]

  const fetchAdvice = useCallback(async () => {
    if (!latestRecord) {
      setLoading(false)
      return
    }

    const entries = latestRecord.entries.map((e) => ({
      category: e.category,
      title: e.content,
    }))

    const cacheKey = `ai_advice_customer_${btoa(
      JSON.stringify({
        s: latestRecord.summary?.slice(0, 100),
        e: entries.length,
      }),
    ).slice(0, 32)}`

    // Check localStorage
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const { advice: a, ts } = JSON.parse(cached)
        if (Date.now() - ts < 7 * 24 * 60 * 60 * 1000) {
          setAdvice(a)
          setLoading(false)
          setFetched(true)
          return
        }
      }
    } catch {
      // ignore
    }

    try {
      const res = await fetch('/api/ai/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: latestRecord.summary,
          entries,
          locale,
        }),
      })
      const data = await res.json()
      const a = data.advice || null
      setAdvice(a)

      if (a) {
        try {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({ advice: a, ts: Date.now() }),
          )
        } catch {
          // ignore
        }
      }
    } catch {
      setAdvice(null)
    } finally {
      setLoading(false)
      setFetched(true)
    }
  }, [latestRecord, locale])

  // Fetch on mount
  useState(() => {
    fetchAdvice()
  })

  if (!latestRecord) return null

  return (
    <div className="rounded-2xl border border-border/30 bg-gradient-to-r from-amber-500/5 to-transparent p-6">
      <div className="flex items-center gap-2 mb-3">
        <Gift className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold">Advice for Next Visit</h3>
      </div>
      {loading && !fetched ? (
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      ) : advice ? (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {advice}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          No advice available yet
        </p>
      )}
    </div>
  )
}

function RecommendedActionsCard({
  karuteRecords,
}: {
  karuteRecords: KaruteRecordWithEntries[]
}) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())

  // Generate simple recommended actions from entry data
  const actions = karuteRecords
    .slice(0, 3)
    .flatMap((record) =>
      record.entries
        .filter((e) => e.category === 'next_visit' || e.category === 'treatment')
        .slice(0, 2)
        .map((e) => ({
          title:
            e.category === 'next_visit'
              ? 'Follow Up'
              : 'Treatment Recommendation',
          body: e.content,
          type: e.category,
        })),
    )
    .slice(0, 5)

  if (actions.length === 0) return null

  const visibleActions = actions.filter((_, i) => !dismissed.has(i))
  if (visibleActions.length === 0) {
    return (
      <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">AI Recommended Actions</h3>
        </div>
        <p className="text-sm text-muted-foreground text-center py-4">
          All actions handled
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold">AI Recommended Actions</h3>
      </div>
      <div className="space-y-3">
        {visibleActions.map((action) => {
          const realIdx = actions.indexOf(action)
          return (
            <div
              key={realIdx}
              className="flex items-start gap-3 py-3 border-b border-border/20 last:border-0"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                {action.type === 'next_visit' ? (
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Star className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{action.title}</span>
                <p className="text-sm text-muted-foreground leading-relaxed mt-0.5">
                  {action.body}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    setDismissed((s) => new Set(s).add(realIdx))
                  }
                  className="p-1.5 rounded-md text-green-500 hover:bg-green-500/10 transition-colors"
                  title="Mark as done"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDismissed((s) => new Set(s).add(realIdx))
                  }
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors"
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ===========================================================================
// Tab 2: Timeline
// ===========================================================================

function TimelineTab({
  karuteRecords,
  totalVisitCount,
  locale,
}: {
  karuteRecords: KaruteRecordWithEntries[]
  totalVisitCount: number
  locale: string
}) {
  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    new Set(['Visit']),
  )

  const lastVisitDate = karuteRecords[0]?.session_date ?? null
  const daysSinceLastVisit = lastVisitDate ? daysSince(lastVisitDate) : null

  function toggleFilter(filter: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(filter)) {
        next.delete(filter)
      } else {
        next.add(filter)
      }
      return next
    })
  }

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border/30 bg-card/50 p-4 text-center">
          <p className="text-2xl font-bold">{totalVisitCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Visits</p>
        </div>
        <div className="rounded-2xl border border-border/30 bg-card/50 p-4 text-center">
          <p className="text-2xl font-bold">{karuteRecords.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Records</p>
        </div>
        <div className="rounded-2xl border border-border/30 bg-card/50 p-4 text-center">
          <p className="text-2xl font-bold">
            {daysSinceLastVisit !== null ? daysSinceLastVisit : '--'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Days Since Last</p>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="size-3.5 text-muted-foreground" />
        {TIMELINE_FILTER_OPTIONS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => toggleFilter(filter)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              activeFilters.has(filter)
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border/50 text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Timeline Feed */}
      <div className="space-y-3">
        {karuteRecords.length === 0 ? (
          <div className="rounded-2xl border border-border/30 bg-card/50 p-6 text-center">
            <Clock className="size-8 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No timeline events yet
            </p>
          </div>
        ) : (
          karuteRecords.map((record) => (
            <div
              key={record.id}
              className="rounded-2xl border border-border/30 bg-card/50 p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 mt-0.5">
                  <FileText className="h-4 w-4 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">Karute Session</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(record.session_date, locale)}
                    </span>
                  </div>
                  {record.summary && (
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                      {record.summary}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-muted-foreground">
                      {record.entries.length} entries
                    </span>
                    <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
                      Has karute record
                    </span>
                    {record.profiles?.full_name && (
                      <span className="text-xs text-muted-foreground">
                        by {record.profiles.full_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// Tab 3: Photos
// ===========================================================================

function PhotosTab() {
  const [categoryFilter, setCategoryFilter] = useState('all')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Photo Gallery</h2>
          <p className="text-xs text-muted-foreground mt-0.5">0 photos</p>
        </div>
        <Button variant="outline" size="sm">
          <Upload className="size-3.5 mr-1.5" />
          Add Photo
        </Button>
      </div>

      {/* Category Filter */}
      <div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
        >
          <option value="all">All Categories</option>
          <option value="general">General</option>
          <option value="before">Before</option>
          <option value="after">After</option>
        </select>
      </div>

      {/* Empty State */}
      <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/50 mb-4">
            <ImageIcon className="size-8 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-medium text-muted-foreground mb-1">
            No photos yet
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Upload photos to track visual progress over time
          </p>
          <Button variant="outline" size="sm">
            <Upload className="size-3.5 mr-1.5" />
            Upload First Photo
          </Button>
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// Tab 4: Details
// ===========================================================================

function DetailsTab({
  customer,
  karuteRecords,
  totalVisitCount,
  locale,
}: {
  customer: CustomerRow
  karuteRecords: KaruteRecordWithEntries[]
  totalVisitCount: number
  locale: string
}) {
  const [staffNotes, setStaffNotes] = useState(customer.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Gather all entries for insights
  const allEntries = karuteRecords.flatMap((r) => r.entries)
  const recentEntries = karuteRecords
    .slice(0, 3)
    .flatMap((r) => r.entries)

  const topProfessional = getTopTopics(allEntries, PROFESSIONAL_CATEGORIES)
  const topPersonal = getTopTopics(allEntries, PERSONAL_CATEGORIES)

  // Emerging topics: categories that appear in recent records but not much in older ones
  const olderEntries = karuteRecords.slice(3).flatMap((r) => r.entries)
  const recentCategoryCounts: Record<string, number> = {}
  const olderCategoryCounts: Record<string, number> = {}
  for (const e of recentEntries) {
    recentCategoryCounts[e.category] =
      (recentCategoryCounts[e.category] || 0) + 1
  }
  for (const e of olderEntries) {
    olderCategoryCounts[e.category] =
      (olderCategoryCounts[e.category] || 0) + 1
  }
  const emergingTopics = Object.entries(recentCategoryCounts)
    .filter(
      ([cat, count]) => count >= 2 && (olderCategoryCounts[cat] || 0) < count,
    )
    .slice(0, 3)
    .map(([category]) => category)

  async function handleSaveNotes() {
    setSaving(true)
    setSaved(false)
    try {
      const { updateCustomer } = await import('@/actions/customers')
      await updateCustomer(customer.id, { notes: staffNotes })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Customer Details */}
      <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
        <h3 className="text-sm font-semibold mb-4">Customer Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Registered</p>
            <p className="text-sm font-medium mt-0.5">
              {formatDate(customer.created_at, locale)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Visits</p>
            <p className="text-sm font-medium mt-0.5">{totalVisitCount}</p>
          </div>
          {customer.phone && (
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="text-sm font-medium mt-0.5">{customer.phone}</p>
            </div>
          )}
          {customer.email && (
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-sm font-medium mt-0.5">{customer.email}</p>
            </div>
          )}
        </div>
      </div>

      {/* Staff Notes */}
      <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Staff Notes</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveNotes}
            disabled={saving}
          >
            {saving ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted border-t-foreground mr-1.5" />
            ) : (
              <Save className="size-3.5 mr-1.5" />
            )}
            {saved ? 'Saved' : 'Save'}
          </Button>
        </div>
        <textarea
          value={staffNotes}
          onChange={(e) => setStaffNotes(e.target.value)}
          placeholder="Add notes about this customer..."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 resize-y min-h-[100px]"
          rows={4}
        />
      </div>

      {/* Customer Insights */}
      <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">Customer Insights</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Analytics from karute data
            </p>
          </div>
          <Button variant="outline" size="sm">
            <RefreshCw className="size-3.5 mr-1.5" />
            Recalculate
          </Button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-xl border border-border/20 bg-muted/30 p-3 text-center">
            <p className="text-lg font-bold">{totalVisitCount}</p>
            <p className="text-[10px] text-muted-foreground">Visits</p>
          </div>
          <div className="rounded-xl border border-border/20 bg-muted/30 p-3 text-center">
            <p className="text-lg font-bold">--</p>
            <p className="text-[10px] text-muted-foreground">Total Revenue</p>
          </div>
          <div className="rounded-xl border border-border/20 bg-muted/30 p-3 text-center">
            <p className="text-lg font-bold">--</p>
            <p className="text-[10px] text-muted-foreground">LTV</p>
          </div>
        </div>

        {/* Top Professional Topics */}
        {topProfessional.length > 0 && (
          <div className="mb-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Top Professional Topics
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {topProfessional.map(({ category, count }) => (
                <div
                  key={category}
                  className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted/30 px-2.5 py-1"
                >
                  <CategoryBadge category={category} />
                  <span className="text-xs text-muted-foreground">
                    ({count})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top Personal Topics */}
        {topPersonal.length > 0 && (
          <div className="mb-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Top Personal Topics
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {topPersonal.map(({ category, count }) => (
                <div
                  key={category}
                  className="flex items-center gap-1.5 rounded-lg border border-border/30 bg-muted/30 px-2.5 py-1"
                >
                  <CategoryBadge category={category} />
                  <span className="text-xs text-muted-foreground">
                    ({count})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Emerging Topics */}
        {emergingTopics.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Emerging Topics
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {emergingTopics.map((category) => (
                <div
                  key={category}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1"
                >
                  <Flag className="size-3 text-amber-500" />
                  <CategoryBadge category={category} />
                </div>
              ))}
            </div>
          </div>
        )}

        {allEntries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <BarChart3 className="size-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              No data to analyze yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Insights will appear after recording sessions
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// Tab 5: AI History
// ===========================================================================

function AIHistoryTab({
  karuteRecords,
  locale,
}: {
  karuteRecords: KaruteRecordWithEntries[]
  locale: string
}) {
  const recordsWithSummary = karuteRecords.filter(
    (r) => r.summary,
  )

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">AI History</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Past AI summaries and advice
        </p>
      </div>

      {recordsWithSummary.length === 0 ? (
        <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Sparkles className="size-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No AI history yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              AI summaries will appear here after recording sessions
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {recordsWithSummary.map((record) => (
            <AIHistoryCard key={record.id} record={record} locale={locale} />
          ))}
        </div>
      )}
    </div>
  )
}

function AIHistoryCard({
  record,
  locale,
}: {
  record: KaruteRecordWithEntries
  locale: string
}) {
  const [advice, setAdvice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Fetch advice for this record
  useState(() => {
    const entries = record.entries.map((e) => ({
      category: e.category,
      title: e.content,
    }))

    const cacheKey = `ai_advice_history_${record.id}`

    // Check cache
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const { advice: a, ts } = JSON.parse(cached)
        if (Date.now() - ts < 7 * 24 * 60 * 60 * 1000) {
          setAdvice(a)
          setLoading(false)
          return
        }
      }
    } catch {
      // ignore
    }

    async function fetchAdvice() {
      try {
        const res = await fetch('/api/ai/advice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: record.summary,
            entries,
            locale,
          }),
        })
        const data = await res.json()
        const a = data.advice || null
        setAdvice(a)

        if (a) {
          try {
            localStorage.setItem(
              cacheKey,
              JSON.stringify({ advice: a, ts: Date.now() }),
            )
          } catch {
            // ignore
          }
        }
      } catch {
        setAdvice(null)
      } finally {
        setLoading(false)
      }
    }
    fetchAdvice()
  })

  return (
    <div className="rounded-2xl border border-border/30 bg-card/50 p-6">
      {/* Date header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium">
          {formatDateTime(record.session_date, locale)}
        </span>
        {record.profiles?.full_name && (
          <span className="text-xs text-muted-foreground">
            {record.profiles.full_name}
          </span>
        )}
      </div>

      {/* AI Summary */}
      <div className="mb-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <MessageSquare className="size-3" />
          AI Summary
        </h4>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {record.summary}
        </p>
      </div>

      {/* Advice */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Gift className="size-3 text-amber-500" />
          Advice for Next Visit
        </h4>
        {loading ? (
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        ) : advice ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {advice}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No advice generated
          </p>
        )}
      </div>
    </div>
  )
}
