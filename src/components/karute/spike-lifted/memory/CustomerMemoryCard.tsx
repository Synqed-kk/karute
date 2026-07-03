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

import { useState, useTransition } from 'react'
import {
  Activity,
  Brain,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Heart,
  History,
  Leaf,
  Loader2,
  MessageCircle,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
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
import { toast } from 'sonner'
import { useRouter } from '@/i18n/navigation'
import {
  addMemoryItemAction,
  deleteMemoryItemAction,
  toggleMemoryPinAction,
  updateMemoryItemAction,
  relearnCustomerMemoryAction,
  upsertPassportFieldAction,
} from '@/actions/memory'
import {
  EMPTY_MEMORY,
  type CustomerIntake,
  type CustomerMemory,
  type MemoryCategory,
  type MemoryItem,
  type MemorySource,
} from './types'

interface Props {
  customerName: string
  /** Required for mutations (pin/edit/delete/add write to
   *  customer_memory_items). Optional so read-only mounts keep compiling —
   *  without it the add action no-ops with an error toast. */
  customerId?: string
  /**
   * Customer memory data. Defaults to an empty memory shell — the
   * empty-state UI renders ("まだメモリーがありません" / equivalent)
   * until Anthony wires the real `customer_memory_items` table read
   * here. NEVER ship a default with seed content — that would
   * pretend the AI analyzed sessions that never happened.
   */
  memory?: CustomerMemory
  /**
   * Total past session recordings for this customer — drives the
   * data-depth trust badge in the header. Decoupled from `memory`
   * because session count comes from `karute_records.count`, a
   * different data source than `customer_memory_items` — Anthony can
   * wire them independently.
   *
   * Badge resolves in this order:
   *   1. memory.updatedThisVisit > 0 → "今日のセッションで{n}件更新"
   *      (post-session "what just changed" signal — brightest)
   *   2. pastSessionCount > 0       → "{n}件のセッション記録から学習"
   *      (data-depth trust signal — staff knows memory is grounded)
   *   3. otherwise                  → "セッション記録なし"
   *      (brand-new customer — set expectations, don't read as failure)
   *
   * Strategic rationale: stylists need a trust signal before acting on
   * memory items. "Memory from 12 sessions" reads reliable; "from 1"
   * reads tentative; "no sessions" tells staff to treat memory as
   * coming purely from intake form. Mirrors the AI_PROMPTS.md §2
   * prediction-confidence rule in the spike ("output confidence > 0.85
   * only when pattern is clear across 3+ sessions").
   */
  pastSessionCount?: number
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

export function CustomerMemoryCard({
  customerName,
  customerId,
  memory = EMPTY_MEMORY,
  pastSessionCount = 0,
}: Props) {
  const t = useTranslations('karute.memorySection')
  const router = useRouter()
  // Editor (add + edit modes) and delete-confirm — the real mutations the
  // stub dialog used to block on "Anthony" (stale: the schema shipped with
  // source='staff', pinned, and soft deleted_at from day one).
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorItem, setEditorItem] = useState<MemoryItem | null>(null)
  const [editorCategory, setEditorCategory] = useState<MemoryCategory>('personal')
  const [label, setLabel] = useState('')
  const [detail, setDetail] = useState('')
  const [confirmItem, setConfirmItem] = useState<MemoryItem | null>(null)
  const [busy, setBusy] = useState(false)

  const openAdd = () => {
    setEditorItem(null)
    setEditorCategory('personal')
    setLabel('')
    setDetail('')
    setEditorOpen(true)
  }
  const openEdit = (item: MemoryItem) => {
    setEditorItem(item)
    setEditorCategory(item.category)
    setLabel(item.label)
    setDetail(item.body ?? '')
    setEditorOpen(true)
  }
  const saveEditor = async () => {
    if (!label.trim()) return
    setBusy(true)
    const res = editorItem
      ? await updateMemoryItemAction({ id: editorItem.id, label, detail })
      : await addMemoryItemAction({
          customerId: customerId ?? '',
          category: editorCategory,
          label,
          detail,
        })
    setBusy(false)
    if (res.ok) {
      toast.success(t('saved'))
      setEditorOpen(false)
      router.refresh()
    } else {
      toast.error(t('actionFailed'))
    }
  }
  const onItemAction = (item: MemoryItem, kind: 'pin' | 'edit' | 'delete') => {
    if (kind === 'edit') return openEdit(item)
    if (kind === 'delete') return setConfirmItem(item)
    void toggleMemoryPinAction(item.id, !item.pinned).then((res) => {
      if (res.ok) {
        toast.success(item.pinned ? t('unpinned') : t('pinnedToast'))
        router.refresh()
      } else toast.error(t('actionFailed'))
    })
  }
  const confirmDelete = async () => {
    if (!confirmItem) return
    setBusy(true)
    const res = await deleteMemoryItemAction(confirmItem.id)
    setBusy(false)
    if (res.ok) {
      toast.success(t('deleted'))
      setConfirmItem(null)
      router.refresh()
    } else toast.error(t('actionFailed'))
  }
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
          <MemoryTrustBadge
            updatedThisVisit={memory.updatedThisVisit}
            pastSessionCount={pastSessionCount}
            customerId={memory.customerId}
          />
        </div>

        {/* Intake block — ALWAYS renders as a structured 2-col grid
         *  of fields (初診 / 職業 / メンテナンス希望 / 来店きっかけ).
         *  Empty fields show "—" so the scaffold is visible from
         *  day-one. ANTHONY: these fields come from the intake form
         *  (a future flow — see docs/SPIKE_ROADMAP.md). For now they
         *  fall back to whatever's stored on `memory.intake`. */}
        <IntakeBlock intake={memory.intake} customerId={memory.customerId} />

        {/* Talking points block — ALWAYS renders. When AI hasn't
         *  extracted any points yet, shows an inline placeholder
         *  explaining what'll go here. Once `suggestTalkingPoint`
         *  items appear, the placeholder is replaced by the list. */}
        <div className="mt-3 rounded-lg border border-blue-200/70 bg-blue-50/50 p-3 dark:border-blue-500/20 dark:bg-blue-500/[0.05]">
          <div className="mb-2 flex items-center gap-1.5">
            <MessageCircle className="size-3.5 text-blue-700 dark:text-blue-300" />
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
              {t('talkingPoints')}
            </h4>
          </div>
          {talkingPoints.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t('talkingPointsEmpty')}
            </p>
          ) : (
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
          )}
        </div>

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
                onItemAction={onItemAction}
              />
            )
          })}
        </div>

        {/* Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-3 dark:border-white/5">
          <button
            type="button"
            onClick={openAdd}
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

      {/* Editor — add + edit modes, writes source='staff' rows. */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editorItem ? t('editItem') : t('addManually')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {!editorItem && (
              <label className="block text-[12px] text-muted-foreground">
                {t('fieldCategory')}
                <select
                  value={editorCategory}
                  onChange={(e) => setEditorCategory(e.target.value as MemoryCategory)}
                  className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground"
                >
                  {CATEGORY_KEYS.map((c) => (
                    <option key={c} value={c}>
                      {t(`category${categoryKeySuffix(c)}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-[12px] text-muted-foreground">
              {t('fieldLabel')}
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground"
              />
            </label>
            <label className="block text-[12px] text-muted-foreground">
              {t('fieldDetail')}
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={3}
                maxLength={300}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-foreground"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button onClick={saveEditor} disabled={busy || !label.trim()}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Soft-delete confirm — deleted_at, reversible at the data layer. */}
      <Dialog open={!!confirmItem} onOpenChange={(o) => !o && setConfirmItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>
              {confirmItem ? t('deleteBody', { label: confirmItem.label }) : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmItem(null)} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {t('delete')}
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

// ─────────────────────────────────────────────────────────────
// MemoryTrustBadge — three-state header chip telling staff how to
// calibrate trust in the memory items. See the `pastSessionCount`
// prop doc above for the full strategy. Each state has its own
// visual weight (saturated → muted → neutral) so staff can read
// the trust signal at a glance without reading the label.
// ─────────────────────────────────────────────────────────────
function MemoryTrustBadge({
  updatedThisVisit,
  pastSessionCount,
  customerId,
}: {
  updatedThisVisit: number
  pastSessionCount: number
  customerId: string
}) {
  const t = useTranslations('karute.memorySection')
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const relearn = () => {
    setConfirming(false)
    startTransition(async () => {
      const res = await relearnCustomerMemoryAction(customerId)
      if (!res.ok) {
        toast.error(t('relearnFailed'))
        return
      }
      toast.success(t('relearnDone', { n: res.items }))
      router.refresh()
    })
  }

  // State 1 — post-session: items were just added in today's session.
  // Brightest signal (saturated blue + Sparkles) because this is the
  // staff's "look, the AI captured something new" moment.
  if (updatedThisVisit > 0) {
    return (
      <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-blue-50 px-2 text-[10px] font-medium tabular-nums text-blue-800 ring-1 ring-blue-200/70 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/20">
        <Sparkles className="size-2.5" aria-hidden />
        {t('updatedBadge', { n: updatedThisVisit })}
      </span>
    )
  }

  // State 2 — data-depth trust signal: memory is grounded in N past
  // sessions. Helps staff calibrate how much to trust the items
  // before acting on them. Muted blue (≠ post-session bright blue)
  // so staff can distinguish "fresh from today" vs "long-standing".
  // State 2 doubles as the 再学習 trigger (Liam, 2026-07-03): the trust chip
  // names the data source, so tapping it re-learns from that source with the
  // CURRENT prompt. Two-tap confirm — it discards the AI's unpinned items
  // (staff-added / pinned / staff-edited always survive).
  if (pastSessionCount > 0) {
    // Scaffold shells pass customerId='' — render the plain trust chip; the
    // relearn trigger only exists for a real customer.
    if (!customerId) {
      return (
        <span
          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-blue-50/60 px-2 text-[10px] font-medium tabular-nums text-blue-700/90 ring-1 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-300/90 dark:ring-blue-500/15"
          title={t('sessionsBadgeTooltip')}
        >
          <History className="size-2.5" aria-hidden />
          {t('sessionsBadge', { n: pastSessionCount })}
        </span>
      )
    }
    if (pending) {
      return (
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-blue-50/60 px-2 text-[10px] font-medium text-blue-700/90 ring-1 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-300/90 dark:ring-blue-500/15">
          <Loader2 className="size-2.5 animate-spin" aria-hidden />
          {t('relearnRunning')}
        </span>
      )
    }
    return (
      <button
        type="button"
        onClick={() => (confirming ? relearn() : setConfirming(true))}
        onBlur={() => setConfirming(false)}
        title={confirming ? t('relearnConfirmTooltip') : t('sessionsBadgeTooltip')}
        className={
          confirming
            ? 'inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 text-[10px] font-semibold tabular-nums text-amber-800 ring-1 ring-amber-300/70 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25'
            : 'inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-blue-50/60 px-2 text-[10px] font-medium tabular-nums text-blue-700/90 ring-1 ring-blue-200/60 transition-colors hover:bg-blue-100/70 dark:bg-blue-500/10 dark:text-blue-300/90 dark:ring-blue-500/15'
        }
      >
        {confirming ? (
          <RefreshCw className="size-2.5" aria-hidden />
        ) : (
          <History className="size-2.5" aria-hidden />
        )}
        {confirming
          ? t('relearnConfirm')
          : t('sessionsBadge', { n: pastSessionCount })}
      </button>
    )
  }

  // State 3 — no recordings yet. Neutral gray so brand-new customers
  // don't read as "AI failed" but rather "memory will accumulate as
  // you record sessions". Sets expectations without overpromising.
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-muted/60 px-2 text-[10px] font-medium tabular-nums text-muted-foreground ring-1 ring-border"
      title={t('noSessionsBadgeTooltip')}
    >
      <CircleDashed className="size-2.5" aria-hidden />
      {t('noSessionsBadge')}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// Intake block — structured 2-col grid of intake fields. Always
// renders; empty fields show "—" so the scaffold is visible from
// the moment the customer is created.
// ─────────────────────────────────────────────────────────────
function IntakeBlock({
  intake,
  customerId,
}: {
  intake: CustomerIntake | null
  customerId: string
}) {
  const t = useTranslations('karute.memorySection.intakeFields')
  const tCard = useTranslations('karute.memorySection')

  // Token-driven passport (2026-07-03): business-type field list, grounded
  // values with tap-to-see-the-quote, inline staff edit (human overrides are
  // locked truth). Falls back to the legacy fixed grid for pre-passport data.
  if (intake?.fields?.length) {
    return (
      <div className="mt-2 rounded-lg border border-border/40 bg-muted/20 p-3">
        <div className="grid grid-cols-1 gap-1.5 text-[11px]">
          <IntakeField label={t('firstVisit')} value={intake.firstVisitAt} />
          {intake.fields.map((f) => (
            <PassportFieldRow key={f.key} field={f} customerId={customerId} />
          ))}
        </div>
        <p className="mt-2 text-[10px] italic text-muted-foreground/70">
          {tCard('passportHint')}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-lg border border-border/40 bg-muted/20 p-3">
      <div className="grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
        <IntakeField label={t('firstVisit')} value={intake?.firstVisitAt} />
        <IntakeField label={t('occupation')} value={intake?.occupation} />
        <IntakeField label={t('maintenance')} value={intake?.maintenanceFreq} />
        <IntakeField label={t('referral')} value={intake?.referralSource} />
      </div>
      {!intake && (
        <p className="mt-2 text-[10px] italic text-muted-foreground/70">
          {tCard('intakeEmpty')}
        </p>
      )}
    </div>
  )
}

// One passport row: label / value (or honest dash) / quote toggle when the AI
// grounded it / inline pencil edit writing a staff override (locked truth).
function PassportFieldRow({
  field,
  customerId,
}: {
  field: NonNullable<CustomerIntake['fields']>[number]
  customerId: string
}) {
  const t = useTranslations('karute.memorySection')
  const router = useRouter()
  const [showQuote, setShowQuote] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(field.value ?? '')
  const [pending, startTransition] = useTransition()

  const save = () => {
    const value = draft.trim()
    if (!value) {
      setEditing(false)
      return
    }
    startTransition(async () => {
      const res = await upsertPassportFieldAction({
        customerId,
        fieldKey: field.key,
        value,
      })
      setEditing(false)
      if (res.ok) router.refresh()
      else toast.error(t('passportSaveFailed'))
    })
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-muted-foreground">{field.label}</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={60}
          autoFocus
          className="min-w-0 flex-1 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="shrink-0 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background disabled:opacity-50"
        >
          {pending ? '…' : t('passportSave')}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="shrink-0 text-[10px] text-muted-foreground"
        >
          {t('passportCancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-muted-foreground">{field.label}</span>
        {field.value ? (
          <button
            type="button"
            onClick={() => field.quote && setShowQuote((v) => !v)}
            className={`min-w-0 truncate text-left text-foreground/90 ${field.quote ? 'underline decoration-dotted underline-offset-2' : ''}`}
            title={field.quote ? t('passportQuoteHint') : undefined}
          >
            {field.value}
          </button>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
        {field.source === 'staff' && (
          <Pin className="size-2.5 shrink-0 text-amber-500" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(field.value ?? '')
            setEditing(true)
          }}
          aria-label={t('passportEdit', { field: field.label })}
          className="ml-auto shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <Pencil className="size-3" aria-hidden />
        </button>
      </div>
      {showQuote && field.quote && (
        <p className="mt-0.5 pl-1 text-[10px] text-muted-foreground">
          「{field.quote}」
        </p>
      )}
    </div>
  )
}

function IntakeField({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-foreground">{value ?? '—'}</span>
    </div>
  )
}

function CategorySection({
  category,
  items,
  isCollapsed,
  onToggleCollapse,
  onItemAction,
}: {
  category: MemoryCategory
  items: MemoryItem[]
  isCollapsed: boolean
  onToggleCollapse: () => void
  onItemAction: (item: MemoryItem, kind: 'pin' | 'edit' | 'delete') => void
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
                onItemAction={onItemAction}
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
  onItemAction,
}: {
  item: MemoryItem
  onItemAction: (item: MemoryItem, kind: 'pin' | 'edit' | 'delete') => void
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
          {t(`source${sourceKeySuffix(item.source)}`)}
          {item.capturedAt ? ` · ${item.capturedAt}` : ''}
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
          onClick={() => onItemAction(item, 'pin')}
          aria-label={item.pinned ? 'unpin' : 'pin'}
          className={`inline-flex size-6 items-center justify-center rounded hover:bg-muted ${
            item.pinned
              ? 'text-amber-600 dark:text-amber-300'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Pin className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => onItemAction(item, 'edit')}
          aria-label="edit"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => onItemAction(item, 'delete')}
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
