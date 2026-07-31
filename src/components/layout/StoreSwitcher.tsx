'use client'

// ─────────────────────────────────────────────────────────────
// StoreSwitcher — global active-store pill + dropdown (header)
// ─────────────────────────────────────────────────────────────
// Renders ONLY for multi-store businesses (>= 2 stores) so single-store
// salons keep a clean header. The active store is a VIEW filter (cookie via
// setActiveStore) — never a security boundary. Picking a store scopes the
// store-filtered surfaces (顧客 list, agenda, カルテ roster, dashboard
// today-list). There is no "all stores" view: it defaults to the business's
// primary store when the cookie hasn't pinned one yet.
//
// Mobile: compact pill (store icon + branch name) beside the bell, 44px tap
// target. The brand prefix shared by every store is dropped so BOTH the pill
// and the dropdown rows lead with the BRANCH (代官山, not "La Estro 代官山").

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Building2, Check, ChevronDown } from 'lucide-react'

import { setActiveStore, type StoreRow } from '@/actions/stores'

interface StoreSwitcherProps {
  stores: StoreRow[]
  activeStoreId: string | null
  variant?: 'mobile' | 'desktop'
}

export function StoreSwitcher({ stores, activeStoreId, variant = 'mobile' }: StoreSwitcherProps) {
  const t = useTranslations('settings.stores')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // The switcher only matters with 2+ stores — single-store salons get nothing.
  if (stores.length < 2) return null

  // No "all stores" view → there is always an active store. Fall back to the
  // primary store (then the first) when the cookie hasn't pinned one yet.
  const active =
    stores.find((s) => s.id === activeStoreId) ??
    stores.find((s) => s.isPrimary) ??
    stores[0]
  if (!active) return null

  const names = stores.map((s) => s.name)

  const choose = (id: string) => {
    setErr(null)
    startTransition(async () => {
      const res = await setActiveStore(id)
      // On failure (e.g. the store was deleted, or auth lapsed) keep the menu
      // open and surface the error instead of closing + refreshing as if the
      // switch took — otherwise the pill silently snaps back to the old store.
      if ('error' in res) {
        setErr(res.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex h-9 items-center gap-1 rounded-full bg-blue-50 px-2.5 text-[13px] font-medium text-blue-800 ring-1 ring-blue-200/70 transition active:bg-blue-100 disabled:opacity-60 dark:bg-blue-500/10 dark:text-blue-200 dark:ring-blue-500/20 ${variant === 'mobile' ? 'max-w-[112px]' : 'max-w-[200px]'}`}
      >
        <Building2 className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{branchLabel(active.name, names)}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          // Open overlay: the shell's tab-swipe must not change the screen
          // under it (thin/gestures.ts walks for this tag).
          data-gesture-inert=""
          className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-900"
        >
          <div className="border-b border-black/5 px-3 py-2 text-[11px] text-muted-foreground dark:border-white/10">
            {t('switcherTitle')}
          </div>
          {err && (
            <div
              role="alert"
              className="border-b border-red-200/60 bg-red-50 px-3 py-2 text-[11px] text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
            >
              {err}
            </div>
          )}
          {stores.map((s) => (
            <SwitcherRow
              key={s.id}
              icon={<Building2 className="size-4" aria-hidden />}
              label={branchLabel(s.name, names)}
              badge={s.isPrimary ? t('primaryBadge') : undefined}
              selected={active.id === s.id}
              onClick={() => choose(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Drop the brand prefix a store shares with a SIBLING so labels lead with the
// BRANCH (代官山) not the redundant company ("La Estro 代官山"). Each store
// strips its LONGEST leading-word prefix shared with at least one other store
// — pairwise max, never a minimum over the whole set, so no single unrelated
// name ("Test Gym", "La Belle 渋谷") can poison the group (the set-min was the
// 7/26 pill regression, in both its original and first-fix forms). A prefix
// must be ≥2 words to count as a brand — one coincidental shared word ("La")
// never strips. Never strips a store's last word — a shared location word
// (代官山 in 代官山一丁目 / 代官山二丁目) survives and a label never renders
// blank. No qualifying sibling → full name.
function branchLabel(name: string, allNames: string[]): string {
  const words = name.split(' ')
  let best = 0
  let skippedSelf = false
  for (const other of allNames) {
    if (!skippedSelf && other === name) {
      skippedSelf = true
      continue
    }
    const otherWords = other.split(' ')
    let i = 0
    while (i < words.length && i < otherWords.length && otherWords[i] === words[i]) i++
    if (i > best) best = i
  }
  if (best < 2) return name
  return words.slice(Math.min(best, words.length - 1)).join(' ')
}

function SwitcherRow({
  icon,
  label,
  badge,
  selected,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  badge?: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
        selected
          ? 'bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200'
          : 'text-foreground active:bg-black/[0.03] dark:active:bg-white/[0.04]'
      }`}
    >
      <span className={selected ? 'text-blue-700 dark:text-blue-300' : 'text-muted-foreground'}>
        {icon}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{label}</span>
        {badge && (
          <span className="rounded-md bg-black/5 px-1.5 text-[10px] text-muted-foreground dark:bg-white/10">
            {badge}
          </span>
        )}
      </span>
      {selected && <Check className="ml-auto size-4 shrink-0" aria-hidden />}
    </button>
  )
}
