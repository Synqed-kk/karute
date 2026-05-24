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
  SAMPLE_MEMORY,
  type CustomerMemory,
  type MemoryCategory,
  type MemoryItem,
  type MemorySource,
} from './types'

interface Props {
  customerName: string
  /** Optional override; defaults to SAMPLE_MEMORY for the demo. */
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

export function CustomerMemoryCard({ customerName, memory = SAMPLE_MEMORY }: Props) {
  const t = useTranslations('karute.memorySection')
  const [stubOpen, setStubOpen] = useState(false)

  const isEmpty = memory.items.length === 0
  const talkingPoints = memory.items.filter((i) => i.suggestTalkingPoint)
  const byCategory = groupByCategory(memory.items)

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

        {/* Empty state */}
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

        {/* Categorized sections */}
        {!isEmpty && (
          <div className="mt-4 space-y-3">
            {CATEGORY_KEYS.map((cat) => {
              const items = byCategory[cat] ?? []
              if (items.length === 0) return null
              return (
                <CategorySection
                  key={cat}
                  category={cat}
                  items={items}
                  onActionStub={() => setStubOpen(true)}
                />
              )
            })}
          </div>
        )}

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
  onActionStub,
}: {
  category: MemoryCategory
  items: MemoryItem[]
  onActionStub: () => void
}) {
  const t = useTranslations('karute.memorySection')
  const visual = CATEGORY_VISUAL[category]
  const Icon = visual.icon
  const label = t(`category${categoryKeySuffix(category)}`)
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={`flex size-5 items-center justify-center rounded ${visual.tint}`}>
          <Icon className={`size-3 ${visual.accent}`} aria-hidden />
        </span>
        <h4 className={`text-[11px] font-semibold uppercase tracking-wider ${visual.accent}`}>
          {label}
        </h4>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {items.length}
        </span>
      </div>
      <ul className="space-y-1.5 pl-1">
        {items.map((item) => (
          <MemoryItemRow key={item.id} item={item} onActionStub={onActionStub} />
        ))}
      </ul>
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
      {/* Hover-revealed action buttons — stubbed for now */}
      <div className="hidden gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
        <button
          type="button"
          onClick={onActionStub}
          aria-label="pin"
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
