'use client'

// MATCHES SPIKE'S tab nav from src/app/[locale]/(app)/customers/[id]/page.tsx
// Horizontal-scroll on mobile, static on desktop. Active tab: no fill,
// blue underline + blue icon. Inactive: muted text, no underline.
// Count badge sits inline next to the label (same as spike).

import { Brain, ClipboardList, Images, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type CustomerProfileTab = 'memory' | 'sessions' | 'photos' | 'privacy'

interface CustomerTabBarProps {
  active: CustomerProfileTab
  onChange: (tab: CustomerProfileTab) => void
  counts: { memory: number; sessions: number; photos: number }
}

const TABS: Array<{
  id: CustomerProfileTab
  labelKey: string
  icon: typeof Brain
}> = [
  { id: 'memory', labelKey: 'memory', icon: Brain },
  { id: 'sessions', labelKey: 'sessions', icon: ClipboardList },
  { id: 'photos', labelKey: 'photos', icon: Images },
  { id: 'privacy', labelKey: 'privacy', icon: ShieldCheck },
]

export function CustomerTabBar({ active, onChange, counts }: CustomerTabBarProps) {
  const t = useTranslations('customers.profile.tabs')
  const navRef = useRef<HTMLElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [underline, setUnderline] = useState({ x: 0, width: 0 })
  const [hasMeasured, setHasMeasured] = useState(false)
  const [transitionOn, setTransitionOn] = useState(false)

  function measureUnderline() {
    const el = tabRefs.current[TABS.findIndex((tab) => tab.id === active)]
    if (!el) return
    setUnderline((prev) =>
      prev.x === el.offsetLeft && prev.width === el.offsetWidth
        ? prev
        : { x: el.offsetLeft, width: el.offsetWidth },
    )
    setHasMeasured(true)
  }
  const measureRef = useRef(measureUnderline)
  measureRef.current = measureUnderline

  useLayoutEffect(() => {
    measureUnderline()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!hasMeasured || transitionOn) return
    const id = requestAnimationFrame(() => setTransitionOn(true))
    return () => cancelAnimationFrame(id)
  }, [hasMeasured, transitionOn])

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    // jsdom has no ResizeObserver — measurement still happens via the layout
    // effect above, this observer only covers post-mount geometry changes.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measureRef.current())
    observer.observe(nav)
    // Also watch each tab button: the nav's own border-box doesn't change
    // when a tab's content grows (count badge 9→10, label swap) because of
    // overflow-x-auto, so the underline would otherwise go stale.
    tabRefs.current.forEach((el) => {
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  return (
    <nav
      ref={navRef}
      aria-label={t('aria')}
      className="relative -mx-4 flex items-center gap-1 overflow-x-auto border-b border-black/5 px-4 dark:border-white/5 md:mx-0 md:overflow-visible md:px-0"
    >
      <span
        aria-hidden
        className={`absolute bottom-0 left-0 h-0.5 rounded-full bg-blue-600 dark:bg-blue-300 ${
          transitionOn ? 'transition-[transform,width] duration-(--duration-base) ease-(--ease-out)' : ''
        }`}
        style={{ transform: `translateX(${underline.x}px)`, width: `${underline.width}px` }}
      />
      {TABS.map((tab, index) => {
        const Icon = tab.icon
        const isActive = tab.id === active
        const count =
          tab.id === 'memory'
            ? counts.memory
            : tab.id === 'sessions'
              ? counts.sessions
              : tab.id === 'photos'
                ? counts.photos
                : undefined
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[index] = el
            }}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative inline-flex h-10 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] font-medium transition-colors ${
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon
              size={14}
              className={
                isActive ? 'text-blue-600 dark:text-blue-300' : undefined
              }
              aria-hidden
            />
            <span>{t(tab.labelKey)}</span>
            {count !== undefined && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
