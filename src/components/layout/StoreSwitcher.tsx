'use client'

// ─────────────────────────────────────────────────────────────
// StoreSwitcher — global active-store pill + dropdown (header)
// ─────────────────────────────────────────────────────────────
// Renders ONLY for multi-store businesses (>= 2 stores) so single-store
// salons keep a clean header. The active store is a VIEW filter (cookie via
// setActiveStore / clearActiveStore) — never a security boundary. Picking a
// store scopes the store-filtered surfaces (顧客 list, agenda, カルテ roster,
// dashboard today-list); 全店舗 clears it for the cross-store owner view.
//
// Mobile: compact pill (icon + truncated name) beside the bell, 44px tap
// target, full names live in the dropdown. Desktop: same pill, more room.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Building2, Check, ChevronDown, Layers } from 'lucide-react'

import { setActiveStore, clearActiveStore, type StoreRow } from '@/actions/stores'

interface StoreSwitcherProps {
  stores: StoreRow[]
  activeStoreId: string | null
  variant?: 'mobile' | 'desktop'
}

export function StoreSwitcher({ stores, activeStoreId, variant = 'mobile' }: StoreSwitcherProps) {
  const t = useTranslations('settings.stores')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // The switcher only matters with 2+ stores — single-store salons get nothing.
  if (stores.length < 2) return null

  const active = activeStoreId ? (stores.find((s) => s.id === activeStoreId) ?? null) : null
  const label = active ? active.name : t('allStores')

  const choose = (id: string | null) => {
    setOpen(false)
    startTransition(async () => {
      if (id) await setActiveStore(id)
      else await clearActiveStore()
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
        {active ? (
          <Building2 className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <Layers className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-900"
        >
          <div className="border-b border-black/5 px-3 py-2 text-[11px] text-muted-foreground dark:border-white/10">
            {t('switcherTitle')}
          </div>
          <SwitcherRow
            icon={<Layers className="size-4" aria-hidden />}
            label={t('allStores')}
            sub={t('allStoresSub')}
            selected={!active}
            onClick={() => choose(null)}
          />
          {stores.map((s) => (
            <SwitcherRow
              key={s.id}
              icon={<Building2 className="size-4" aria-hidden />}
              label={s.name}
              badge={s.isPrimary ? t('primaryBadge') : undefined}
              selected={active?.id === s.id}
              onClick={() => choose(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SwitcherRow({
  icon,
  label,
  sub,
  badge,
  selected,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  sub?: string
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
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate">{label}</span>
          {badge && (
            <span className="rounded-md bg-black/5 px-1.5 text-[10px] text-muted-foreground dark:bg-white/10">
              {badge}
            </span>
          )}
        </span>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </span>
      {selected && <Check className="ml-auto size-4 shrink-0" aria-hidden />}
    </button>
  )
}
