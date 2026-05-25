'use client'

// LIFTED FROM SPIKE (simplified)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute/CustomerMemoryCard.tsx
//
// Spike component is 675 lines + 759 lines of mock data + a separate
// MemoryItemDialog + mutation hooks (pin/edit/delete). This lift is a
// VISUAL port — same rendered structure (header, intake row, talking
// points, 5 categorized sections, footer) using inline sample data.
// Mutation buttons (pin/edit/delete/add) are present but stubbed to
// keep the surface area within ~300 lines.
//
// Adaptations from spike:
//   useT() / useTheme()         → useTranslations() / useLocale()
//   useCustomerDeletionStatus   → assumed not-deleted (no-op)
//   useMemoryMutations          → stub no-op handlers
//   MemoryItemDialog            → not lifted; "manual add" button
//                                  opens a Coming-Soon dialog
//   MemoryCardActionsContext    → not needed since mutations stubbed
//
// ANTHONY: when you wire the real `customer_memory_items` table:
//   1. Drop SAMPLE_MEMORY from ./types.ts
//   2. Add a `memory` prop to this component (CustomerMemory)
//   3. Wire pin/edit/delete handlers to togglePin / updateItem /
//      deleteItem mutations
//   4. Replace the Coming-Soon dialog with the lifted MemoryItemDialog
//      (separate lift task, ~150 lines)

import { useState } from 'react'
import {
  Activity,
  Brain,
  ChevronDown,
  ChevronRight,
  Heart,
  Leaf,
  MessageCircle,
  Pencil,
  Pin,
  Plus,
  Sparkles,
  Target,
  X,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  EMPTY_MEMORY,
  type CustomerMemory,
  type MemoryCategory,
  type MemoryItem,
  type MemorySource,
} from './types'

interface Props {
  customerName: string
  /**
   * Customer memory data. Defaults to an empty memory shell — the
   * empty-state UI renders ("まだメモリーがありません" / equivalent)
   * until Anthony wires the real `customer_memory_items` table read
   * here. NEVER ship a default with seed content — that would
   * pretend the AI analyzed sessions that never happened.
   */
  memory?: CustomerMemory
}

// Per-category presentation (icon + color tokens). Single source of
// truth so categories render consistently across talking-points +
// grouped sections.
const CATEGORY_VISUAL: Record<
  MemoryCategory,
  { icon: typeof Heart; accent: string; tint: string }
> = {
  personal: {
    icon: Heart,
    accent: 'text-rose-700 dark:text-rose-300',
    tint: 'bg-rose-50 dark:bg-rose-500/10',
  },
  body: {
    icon: Activity,
    accent: 'text-sky-700 dark:text-sky-300',
    tint: 'bg-sky-50 dark:bg-sky-500/10',
  },
  preference: {
    icon: Sparkles,
    accent: 'text-violet-700 dark:text-violet-300',
    tint: 'bg-violet-50 dark:bg-violet-500/10',
  },
  goal: {
    icon: Target,
    accent: 'text-amber-700 dark:text-amber-300',
    tint: 'bg-amber-50 dark:bg-amber-500/10',
  },
  lifestyle: {
    icon: Leaf,
    accent: 'text-emerald-700 dark:text-emerald-300',
    tint: 'bg-emerald-50 dark:bg-emerald-500/10',
  },
}

const CATEGORY_KEYS: MemoryCategory[] = [
  'personal',
  'body',
  'preference',
  'goal',
  'lifestyle',
]

export function CustomerMemoryCard({ customerName, memory = EMPTY_MEMORY }: Props) {
  const t = useTranslations('karute.memorySection')
  const [stubOpen, setStubOpen] = useState(false)
  const isEmpty = memory.items.length === 0
  const talkingPoints = memory.items.filter((i) => i.suggestTalkingPoint)
  const byCategory = groupByCategory(memory.items)

  // Collapsed sections live in local state — Set keyed by category.
  // Default behavior: sections with 0 items start collapsed (just
  // their header is visible as a structure preview); sections with
  // items start expanded so staff sees content immediately. Refresh
  // resets to this default; no backend persistence yet.
  // ANTHONY: if salon staff want their collapse preferences to stick
  // across sessions, persist into localStorage or a per-staff
  // settings table.
  const [collapsed, setCollapsed] = useState<Set<MemoryCategory>>(
    () => new Set(CATEGORY_KEYS.filter((c) => (byCategory[c] ?? []).length === 0)),
  )
  const toggleCollapsed = (cat: MemoryCategory) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <>
      <section
        className="bg-card p-4 border-b border-black/5 dark:border-white/5 md:p-5 md:border-0 md:rounded-xl md:ring-1 md:ring-black/5 md:dark:ring-white/5 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:dark:shadow-none"
        aria-labelledby="customer-memory-heading"
      >
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
              <Brain className="size-3.5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3
                id="customer-memory-heading"
                className="text-sm font-semibold text-foreground"
              >
                {t('title')}
              </h3>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {t('subtitle', { name: customerName })}
              </p>
            </div>
          </div>
          {memory.updatedThisVisit > 0 && (
            <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-blue-50 px-2 text-[10px] font-medium tabular-nums text-blue-800 ring-1 ring-blue-200/70 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/20">
              <Sparkles className="size-2.5" aria-hidden />
              {t('updatedBadge', { n: memory.updatedThisVisit })}
            </span>
          )}
        </div>

        {/* Intake summary line */}
        {memory.intake && (
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{t('intakePrefix')}</span>{' '}
            {memory.intake.firstVisitAt}
            {memory.intake.highlights.length > 0 && (
              <>
                {memory.intake.highlights.map((h, i) => (
                  <span key={i}>
                    <span aria-hidden> · </span>
                    {h}
                  </span>
                ))}
              </>
            )}
          </p>
        )}

        {/* Overall empty state — shown when the customer has no memory
         *  items yet. The 5 category sections below ALSO render in
         *  this case (as a structure preview with "対応予定" indicators)
         *  so staff sees what'll populate over time. */}
        {isEmpty && (
          <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center dark:border-white/10 dark:bg-white/[0.03]">
            <Brain className="mx-auto mb-1.5 size-5 text-gray-400 dark:text-gray-500" />
            <div className="text-[13px] font-medium text-foreground">
              {t('emptyTitle')}
            </div>
            <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
              {t('emptyBody')}
            </p>
          </div>
        )}

        {/* Talking points block */}
        {!isEmpty && talkingPoints.length > 0 && (
          <div className="mt-3 rounded-lg border border-blue-200/70 bg-blue-50/50 p-3 dark:border-blue-500/20 dark:bg-blue-500/[0.05]">
            <div className="mb-2 flex items-center gap-1.5">
              <MessageCircle className="size-3.5 text-blue-700 dark:text-blue-300" />
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                {t('talkingPoints')}
              </h4>
            </div>
            <ul className="space-y-1.5">
              {talkingPoints.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 text-[12px] leading-relaxed text-foreground"
                >
                  <span
                    className={`mt-1.5 inline-block size-1 shrink-0 rounded-full ${
                      CATEGORY_VISUAL[item.category].accent
                    } bg-current`}
                  />
                  <span>
                    <span className="font-medium">{item.label}</span>
                    {item.body && (
                      <span className="text-muted-foreground"> — {item.body}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Categorized sections — ALWAYS render all 5 categories, even
         *  when empty. Empty sections show a "対応予定" indicator in
         *  the header + a small "nothing here yet" body when expanded.
         *  This gives staff a structural preview of what AI will
         *  populate over time, instead of hiding the layout when
         *  there's no data. */}
        <div className="mt-4 space-y-3">
          {CATEGORY_KEYS.map((cat) => {
            const items = byCategory[cat] ?? []
            return (
              <CategorySection
                key={cat}
                category={cat}
                items={items}
                isCollapsed={collapsed.has(cat)}
                onToggleCollapse={() => toggleCollapsed(cat)}
                onActionStub={() => setStubOpen(true)}
              />
            )
          })}
        </div>

        {/* Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-3 dark:border-white/5">
          <button
            type="button"
            onClick={() => setStubOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-[13px] font-medium text-background transition-opacity hover:opacity-90"
          >
            <Plus className="size-3.5" />
            {t('addManually')}
          </button>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {t('lastUpdated', { date: memory.lastUpdatedAt.slice(0, 10) })}
          </span>
        </div>
      </section>

      {/* Stub dialog for mutations (pin/edit/delete/add). Replace
       *  with the lifted MemoryItemDialog when Anthony wires real
       *  mutations. */}
      <Dialog open={stubOpen} onOpenChange={setStubOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('addManually')}</DialogTitle>
            <DialogDescription>{t('comingSoonEdit')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStubOpen(false)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// Subcomponents — kept file-local since they're not reused
// ─────────────────────────────────────────────────────────────

function CategorySection({
  category,
  items,
  isCollapsed,
  onToggleCollapse,
  onActionStub,
}: {
  category: MemoryCategory
  items: MemoryItem[]
  isCollapsed: boolean
  onToggleCollapse: () => void
  onActionStub: () => void
}) {
  const t = useTranslations('karute.memorySection')
  const visual = CATEGORY_VISUAL[category]
  const Icon = visual.icon
  const ChevronIcon = isCollapsed ? ChevronRight : ChevronDown
  const label = t(`category${categoryKeySuffix(category)}`)
  const isCategoryEmpty = items.length === 0
  return (
    <div>
      {/* Header is a button — entire row toggles collapse on tap.
       *  Empty categories get a "対応予定" pill in the header so the
       *  scaffold reads as "future structure" rather than just "0
       *  things". */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!isCollapsed}
        className="mb-1.5 flex w-full items-center gap-1.5 rounded-md py-0.5 text-left transition-colors hover:bg-muted/30"
      >
        <span className={`flex size-5 items-center justify-center rounded ${visual.tint}`}>
          <Icon className={`size-3 ${visual.accent}`} aria-hidden />
        </span>
        <h4 className={`text-[11px] font-semibold uppercase tracking-wider ${visual.accent}`}>
          {label}
        </h4>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {items.length}
        </span>
        {isCategoryEmpty && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
            {t('comingSoonPill')}
          </span>
        )}
        <ChevronIcon
          size={14}
          className="ml-auto text-muted-foreground/60"
          aria-hidden
        />
      </button>
      {!isCollapsed && (
        isCategoryEmpty ? (
          <p className="pl-1 text-[11px] italic text-muted-foreground/70">
            {t('sectionEmpty')}
          </p>
        ) : (
          <ul className="space-y-1.5 pl-1">
            {items.map((item) => (
              <MemoryItemRow
                key={item.id}
                item={item}
                onActionStub={onActionStub}
              />
            ))}
          </ul>
        )
      )}
    </div>
  )
}

function MemoryItemRow({
  item,
  onActionStub,
}: {
  item: MemoryItem
  onActionStub: () => void
}) {
  const t = useTranslations('karute.memorySection')
  return (
    <li className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <span className="mt-1.5 inline-block size-1 shrink-0 rounded-full bg-muted-foreground/40" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-foreground">
            {item.label}
          </span>
          {item.pinned && (
            <Pin className="size-3 text-amber-600 dark:text-amber-300" aria-hidden />
          )}
        </div>
        {item.body && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {item.body}
          </p>
        )}
        <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground/70">
          {t(`source${sourceKeySuffix(item.source)}`)} · {item.capturedAt}
        </p>
      </div>
      {/* Action buttons — ALWAYS visible (no hover gate). Previous
       *  version hid them behind hover, which made them invisible on
       *  mobile (no hover). Spike + Liam's expectation = always
       *  reachable. opacity-60 default, opacity-100 on hover/focus.
       *
       *  ANTHONY: all three are stubs. Real wiring needs:
       *    - togglePin(itemId)   → flip item.pinned in DB
       *    - editItem(itemId)    → open MemoryItemDialog (lift from
       *                            spike when ready) + persist diff
       *    - deleteItem(itemId)  → soft-delete via deleted_at column */}
      <div className="flex gap-0.5 opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={onActionStub}
          aria-label={item.pinned ? 'unpin' : 'pin'}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pin className="size-3" />
        </button>
        <button
          type="button"
          onClick={onActionStub}
          aria-label="edit"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          onClick={onActionStub}
          aria-label="remove"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
    </li>
  )
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function groupByCategory(items: MemoryItem[]): Record<MemoryCategory, MemoryItem[]> {
  const out: Record<MemoryCategory, MemoryItem[]> = {
    personal: [],
    body: [],
    preference: [],
    goal: [],
    lifestyle: [],
  }
  for (const item of items) out[item.category].push(item)
  return out
}

function categoryKeySuffix(category: MemoryCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function sourceKeySuffix(source: MemorySource): string {
  return source.charAt(0).toUpperCase() + source.slice(1)
}
