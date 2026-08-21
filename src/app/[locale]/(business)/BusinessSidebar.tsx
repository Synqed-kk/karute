'use client'

// The Business rail — LIFTED from the canon mock's inline sidebar (verified
// identical across fable-store-today / -customers / -reservations). Markup,
// class names, glyphs and Japanese wording are canon's; the mock-harness parts
// are stripped per ⚖ L-4: no role-lens machinery, no data-w2-* attributes, no
// 表示プレビュー picker, and no 「事業切替はモック対象外です」 refusal toast.
//
// NAV LAW (⚖ Liam 8/19, L-5): all TWELVE items render, always, in canon's three
// groups. An item whose screen does not exist yet is greyed exactly like
// canon's コーチング treatment — aria-disabled, a 準備中 flag badge, and no
// navigation — never trimmed and never a dead link. Flipping a screen live is
// one `live: true` here.
//
// STORE ISOLATION (⚖ L-4 #14): the business card renders in the play phase
// because the viewer is an admitted owner-equivalent. A clamped lens hides it
// AT THIS SOURCE at reconnect, so a branch viewer never learns another store
// exists.
//
// Rail open/closed is client state, persisted to localStorage exactly as canon
// does. It reads AFTER mount (there is no root-layout script to set the class
// pre-paint — <body> is phone-owned), so a collapsed rail shows one open frame
// on a hard reload. Accepted: it is a display preference, not data.

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface ShellStore { id: string; name: string }

export interface SidebarProps {
  locale: string
  businessName: string
  storeCount: number
  operatorName: string
  operatorMark: string
  operatorRole: string
  stores: ShellStore[]
  /** 今日の運営 badge (Today A6). One count per store plus the business-wide
   *  total: the rail renders above the store lens, so it picks the number the
   *  lens is standing on and the badge always equals the cards the board under
   *  it is showing. */
  unresolved: { byStore: Record<string, number>; all: number }
}

/** Canon's rail glyphs, lifted verbatim. */
const GLYPH: Record<string, ReactNode> = {
  today: (<svg viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="14" rx="2.5" /><path d="M8 3.5v4M16 3.5v4M4 10h16" /><circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" /></svg>),
  reservations: (<svg viewBox="0 0 24 24"><path d="M8 6.5h11M8 12h11M8 17.5h11" /><circle cx="4.6" cy="6.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.6" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.6" cy="17.5" r="1.1" fill="currentColor" stroke="none" /></svg>),
  customers: (<svg viewBox="0 0 24 24"><circle cx="12" cy="8.4" r="3.4" /><path d="M5.5 19.5c.8-3.6 3.4-5.4 6.5-5.4s5.7 1.8 6.5 5.4" /></svg>),
  inbox: (<svg viewBox="0 0 24 24"><path d="M4 13.5 6.5 5.8A1.8 1.8 0 0 1 8.2 4.6h7.6a1.8 1.8 0 0 1 1.7 1.2L20 13.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><path d="M4 13.5h5l1.4 2h3.2l1.4-2h5" /></svg>),
  shifts: (<svg viewBox="0 0 24 24"><circle cx="9" cy="8.8" r="2.9" /><path d="M3.6 19c.7-3 2.8-4.6 5.4-4.6s4.7 1.6 5.4 4.6" /><circle cx="16.6" cy="8.2" r="2.4" /><path d="M15.9 13.9c2.3.2 4 1.7 4.6 4.4" /></svg>),
  register: (<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.4" /><path d="M8.8 8l3.2 4.4L15.2 8M12 12.4V17M9.4 13.4h5.2M9.4 15.6h5.2" /></svg>),
  analytics: (<svg viewBox="0 0 24 24"><path d="M5 19V11M12 19V5M19 19v-8" /><path d="M3 19h18" /></svg>),
  recording: (<svg viewBox="0 0 24 24"><rect x="9.3" y="3.5" width="5.4" height="10.5" rx="2.7" /><path d="M6.2 11a5.8 5.8 0 0 0 11.6 0M12 16.8v3.2M9.2 20h5.6" /></svg>),
  karute: (<svg viewBox="0 0 24 24"><path d="M7.5 3.5h6l4 4v12.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" /><path d="M13.5 3.5V8h4M9 12.2h6M9 15.6h6M9 19h3.5" /></svg>),
  askAi: (<svg viewBox="0 0 24 24"><path d="M4.5 6.8a2.3 2.3 0 0 1 2.3-2.3h10.4a2.3 2.3 0 0 1 2.3 2.3v7.4a2.3 2.3 0 0 1-2.3 2.3H10l-3.8 3v-3H6.8a2.3 2.3 0 0 1-2.3-2.3Z" /><path d="M9.3 10.3 10.6 8.6l1 1.7 1.5-2.2 1.4 2.8" /></svg>),
  coaching: (<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="4.4" /><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none" /></svg>),
  settings: (<svg viewBox="0 0 24 24"><path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15" /><circle cx="9.5" cy="7.5" r="1.9" fill="#fff" /><circle cx="14.5" cy="12" r="1.9" fill="#fff" /><circle cx="8" cy="16.5" r="1.9" fill="#fff" /></svg>),
}

interface NavItem {
  key: string
  /** Route segment under /{locale}/business, or null while the screen is 準備中. */
  segment: string | null
  label: string
  mini: string
  /** WO-2 flips today, WO-3 flips reservations. Everything else stays false
   *  until its own screen is built — never a dead link. */
  live: boolean
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: '店舗フロア',
    items: [
      { key: 'today', segment: 'today', label: '今日の運営', mini: '今日', live: true },
      { key: 'reservations', segment: 'reservations', label: '予約', mini: '予約', live: true },
      { key: 'customers', segment: 'customers', label: '顧客', mini: '顧客', live: true },
      { key: 'inbox', segment: null, label: '受信トレイ', mini: '受信', live: false },
      { key: 'shifts', segment: null, label: 'スタッフ・シフト', mini: 'シフト', live: false },
      { key: 'register', segment: null, label: '売上・レジ', mini: '売上', live: false },
      { key: 'analytics', segment: null, label: '売上分析', mini: '分析', live: false },
    ],
  },
  {
    group: '記録・AI',
    items: [
      { key: 'recording', segment: null, label: '録音', mini: '録音', live: false },
      { key: 'karute', segment: null, label: 'カルテ', mini: 'カルテ', live: false },
      { key: 'askAi', segment: null, label: 'AI相談', mini: 'AI相談', live: false },
      { key: 'coaching', segment: null, label: 'コーチング', mini: 'コーチ', live: false },
    ],
  },
  { group: '設定', items: [{ key: 'settings', segment: null, label: '設定', mini: '設定', live: false }] },
]

const RAIL_KEY = 'synqedBizRail'

/** 店舗切替 panel behavior, the family's own (fable-shared.js:216-244, the
 *  表示する列 popover): the current row takes focus on open, Escape and a click
 *  outside both close it and hand focus back to the card. Returns the cleanup,
 *  so the caller's effect is a thin `return wireStorePicker(...)`.
 *
 *  A near-twin of CustomersScreen's `wireColumnsPopover` and deliberately NOT
 *  shared with it: the shell must not import a screen, and territory pins every
 *  import specifier per file (foundation.test.ts INVENTORY). Twenty lines of
 *  canon behavior beat a cross-layer dependency.
 *
 *  Exported (like `wireColumnsPopover`) because the same fence keeps react-dom
 *  and @testing-library out of territory — the handler is unit-tested on real
 *  jsdom nodes instead of through a renderer. */
export function wireStorePicker(pop: HTMLElement, trigger: HTMLElement, onClose: () => void): () => void {
  const focusable =
    pop.querySelector<HTMLElement>('[aria-current="true"]') ?? pop.querySelector<HTMLElement>('a')
  focusable?.focus()
  const close = () => {
    onClose()
    trigger.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    close()
  }
  // The card is excluded so its own click stays a toggle rather than being
  // closed here and reopened by the click handler.
  const onDown = (e: MouseEvent) => {
    const target = e.target as Node
    if (pop.contains(target) || trigger.contains(target)) return
    close()
  }
  document.addEventListener('keydown', onKey)
  document.addEventListener('mousedown', onDown)
  return () => {
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('mousedown', onDown)
  }
}

export function BusinessSidebar(props: SidebarProps) {
  const { locale, businessName, storeCount, operatorName, operatorMark, operatorRole, stores, unresolved } = props
  const pathname = usePathname()
  const search = useSearchParams()
  const [open, setOpen] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const cardRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      if (window.localStorage.getItem(RAIL_KEY) === 'closed') setOpen(false)
    } catch {
      // Private-mode storage refusal is not a reason to break the rail.
    }
  }, [])

  // The shell root carries the rail class (canon puts it on <body>, which the
  // root layout owns). One effect, one class, removed on unmount.
  useEffect(() => {
    const root = document.querySelector('.biz')
    if (!root) return
    root.classList.toggle('sidebar-open', open)
    return () => root.classList.remove('sidebar-open')
  }, [open])

  function toggle() {
    setOpen((was) => {
      const next = !was
      try {
        window.localStorage.setItem(RAIL_KEY, next ? 'open' : 'closed')
      } catch {
        // see above
      }
      return next
    })
  }

  // 店舗切替 popover — wiring lives in wireStorePicker (unit-tested directly on
  // real DOM nodes; see its comment for why this effect is a thin caller).
  useEffect(() => {
    if (!pickerOpen || !popRef.current || !cardRef.current) return
    return wireStorePicker(popRef.current, cardRef.current, () => setPickerOpen(false))
  }, [pickerOpen])

  // ⚖ Liam 2026-08-20: すべての店舗 left the switcher, so a request WITHOUT
  // ?store= opens on the operator's own store — the first option — never the
  // business-wide merge. The no-store fallback below is unreachable depth.
  const storeParam = search.get('store')
  const current = stores.find((s) => s.id === storeParam) ?? stores[0] ?? null
  const currentIndex = current ? stores.findIndex((s) => s.id === current.id) + 1 : 0
  const lensLabel = current ? current.name : 'すべての店舗'

  return (
    <aside className="sidebar" aria-label="メインナビゲーション">
      <div className="brand">
        <strong>
          <span className="mark" aria-hidden="true">S</span>
          <span className="word">SYNQED</span>
        </strong>
        <span>BUSINESS</span>
      </div>

      <button className="rail-toggle" type="button" onClick={toggle} aria-label="メニューを開閉" aria-expanded={open}>
        {open ? '«' : '»'}
      </button>

      <div className="store-chip" title={`${businessName} / ${lensLabel}`}>
        <b>{lensLabel.slice(0, 1)}</b>
        <span className="mini">{lensLabel}</span>
      </div>

      {/* Business card (L-4 #14). 事業切替 has no screen and no client
          transition, so it sits disabled with the standing hint rather than
          pretending (L-7). */}
      <button className="business" type="button" disabled title="見本データのため実行できません">
        <span>
          <strong>{businessName}</strong>
          <small>{storeCount}店舗を運営</small>
        </span>
        <span aria-hidden="true">⌄</span>
      </button>

      {/* Store lens. The card itself is the switcher (⚖ Liam 8/20). On 顧客 the
          lens cannot filter the rows — customers carry no store_id (CM-9) — so
          it changes the booking-derived columns and the store labels only. That
          honest limit is the #723 behavior, kept. */}
      {/* ⚖ Liam flag 25 — this card is OURS, not canon's, so it registers itself
          into 画面の説明 the way canon's own sections do: one `data-guide` pair,
          picked up by the tour's DOM registry (today-interactions `spotTargets`)
          with no list anywhere to keep in sync. LANE RULE: every new section in
          any future round does the same. */}
      <div
        className="store-picker"
        data-guide-title="店舗の切替"
        data-guide="いま見ている店舗。押すと店舗を切り替えられ、ボードも数字もその店舗のものに変わります。"
      >
        <button
          ref={cardRef}
          className="store-context"
          type="button"
          aria-haspopup="true"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((was) => !was)}
        >
          {lensLabel}
          <span>{current ? `${currentIndex}店舗目 / 現在の店舗` : `${storeCount}店舗すべてを表示中`}</span>
          <span className="chev" aria-hidden="true">⌄</span>
        </button>
        {pickerOpen && (
          <div className="store-pop" ref={popRef} aria-label="店舗を切り替え">
            {stores.map((s, i) => (
              <Link
                key={s.id}
                className="store-opt"
                href={`${pathname}?store=${s.id}`}
                aria-current={current?.id === s.id ? 'true' : undefined}
                onClick={() => setPickerOpen(false)}
              >
                <span>
                  <strong>{s.name}</strong>
                  <small>{i + 1}店舗目</small>
                </span>
                {current?.id === s.id && (
                  <span className="tick" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {NAV.map((section) => (
        <div key={section.group}>
          <div className="nav-label">{section.group}</div>
          <nav className="nav" aria-label={`${section.group}メニュー`}>
            {section.items.map((item) => {
              const href = item.segment ? `/${locale}/business/${item.segment}` : ''
              const active = Boolean(item.segment) && pathname.endsWith(`/business/${item.segment}`)
              if (!item.live) {
                return (
                  <a
                    key={item.key}
                    aria-disabled="true"
                    title={`${item.label}（準備中）`}
                    onClick={(e) => e.preventDefault()}
                  >
                    <span className="glyph" aria-hidden="true">{GLYPH[item.key]}</span>
                    <span className="mini" aria-hidden="true">{item.mini}</span>
                    <span className="lbl">{item.label}</span>{' '}
                    <span className="badge flag">準備中</span>
                  </a>
                )
              }
              const badge = item.key === 'today' ? (current ? (unresolved.byStore[current.id] ?? 0) : unresolved.all) : 0
              return (
                <Link
                  key={item.key}
                  href={href}
                  title={item.label}
                  className={active ? 'active' : undefined}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="glyph" aria-hidden="true">{GLYPH[item.key]}</span>
                  <span className="mini" aria-hidden="true">{item.mini}</span>
                  <span className="lbl">{item.label}</span>
                  {badge > 0 && <span className="badge" aria-label={`未解決 ${badge}件`}>{badge}</span>}
                </Link>
              )
            })}
          </nav>
        </div>
      ))}

      <div className="operator">
        <span className="avatar">{operatorMark}</span>
        <span>
          <strong>{operatorName}</strong>
          <span>{operatorRole} / {lensLabel}</span>
        </span>
      </div>
    </aside>
  )
}
