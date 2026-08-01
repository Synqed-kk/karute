'use client'

import { useState } from 'react'
import { usePathname, Link, useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Crown,
  LogOut,
  User as UserIcon,
  Check,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'
import { wipeSessionVault } from '@/lib/karute/logout-wipe'
import { useSession } from '@/providers/session-provider'
import { useSidebarStyle } from '@/lib/sidebar-style/hooks'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'

function MicIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
}
function HomeIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
}
function CalendarIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
}
function UsersIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
}
function ClipboardIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01" /></svg>
}
function GraduationCapIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" /><path d="M22 10v6" /><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5" /></svg>
}
function SparklesIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /></svg>
}
function ImportIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M8 11l4 4 4-4" /><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" /></svg>
}
function ExportIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 17V5M8 9l4-4 4 4" /><path d="M8 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4M16 19h4a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" /></svg>
}
function SettingsIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
}

type SidebarLabelKey =
  | 'recording'
  | 'dashboard'
  | 'appointments'
  | 'customers'
  | 'karute'
  | 'coaching'
  | 'askAi'
  | 'dataImport'
  | 'dataExport'
  | 'settings'

type NavRoute = {
  id: string
  href: string
  labelKey: SidebarLabelKey
  Icon: () => React.ReactElement
  /** Full prefetch (data included, not just the loading shell) for the heavy
   *  screens, so a sidebar click paints instantly EVEN on first visit — the
   *  screen is already in the router cache before the click. Verified against
   *  the installed Next 16.2.3 source: prefetch={true} → FetchStrategy.Full;
   *  the default ("auto") only prefetches up to the loading.tsx boundary,
   *  which is why prod clicks still paid the full 1.0–2.8s server wait
   *  (measured 2026-07-30) despite 20+ background prefetches per pageview.
   *  Deliberately NOT set on the light/rare screens (sessions, coaching,
   *  settings, exports) — each full prefetch is a real server render, and the
   *  five screens below are the ones the speed lane measured as the daily
   *  loop. Server-load ceiling: ≤5 extra renders per staleTimes window (300s)
   *  per tab; entries refresh via the same staleTimes/QuietRefresh envelope
   *  as clicked navigations. Web-only: this sidebar is web chrome — the
   *  native shell renders its own chrome from the thin bundle. */
  prefetch?: true
}

// /data-import stays flag-gated: ImportDropzone.tsx fires
// `console.info('[dev] Import file selected', …)` on file pick —
// no upload, no session, no progress. Owner picks a CSV and
// watches nothing happen. Nav entry hides until uploadImportCsv ships.
//
// /coaching is a first-class destination now; the page itself gates
// its content per-account on the coaching entitlement (unlimited/paid
// tiers see it, others get an upgrade prompt), so the link always shows.
//
// /data-export stays — CSV / JSON exports for customers run for
// real via the /api/export route (other combinations toast
// "coming soon" honestly via `isWired()` in DataExportView).
const NAV_ROUTES: NavRoute[] = [
  { id: 'recording', href: '/sessions', labelKey: 'recording', Icon: MicIcon },
  { id: 'dashboard', href: '/dashboard', labelKey: 'dashboard', Icon: HomeIcon, prefetch: true },
  { id: 'appointments', href: '/appointments', labelKey: 'appointments', Icon: CalendarIcon, prefetch: true },
  { id: 'customers', href: '/customers', labelKey: 'customers', Icon: UsersIcon, prefetch: true },
  { id: 'karute', href: '/karute', labelKey: 'karute', Icon: ClipboardIcon, prefetch: true },
  { id: 'coaching', href: '/coaching', labelKey: 'coaching', Icon: GraduationCapIcon },
  { id: 'askAi', href: '/ask-ai', labelKey: 'askAi', Icon: SparklesIcon, prefetch: true },
  ...(process.env.NEXT_PUBLIC_FEATURE_DATA_IMPORT === 'true'
    ? [{ id: 'dataImport' as const, href: '/data-import', labelKey: 'dataImport' as const, Icon: ImportIcon }]
    : []),
  { id: 'dataExport', href: '/data-export', labelKey: 'dataExport', Icon: ExportIcon },
  { id: 'settings', href: '/settings', labelKey: 'settings', Icon: SettingsIcon },
]

const LABEL_FALLBACKS: Record<SidebarLabelKey, string> = {
  recording: 'Record',
  dashboard: 'Dashboard',
  appointments: 'Bookings',
  customers: 'Customers',
  karute: 'Karute',
  coaching: 'Coaching',
  askAi: 'AI Assistant',
  dataImport: 'Import',
  dataExport: 'Export',
  settings: 'Settings',
}

export function Sidebar() {
  const pathname = usePathname()
  const t = useTranslations('sidebar')
  const sidebarStyle = useSidebarStyle()
  // Desktop analog of the bottom-nav center button (field bug 8/2): while a
  // session is bound, the 録音 link must carry its customer — a bare
  // /sessions re-resolves to the next scheduled booking. String href only
  // (thin-shell shim).
  const { target: recTarget } = useGlobalRecorder()
  const activeId = NAV_ROUTES.find((r) => pathname.startsWith(r.href))?.id

  function hrefFor(route: NavRoute): string {
    return route.id === 'recording' && recTarget
      ? `/sessions?customerId=${encodeURIComponent(recTarget.customerId)}`
      : route.href
  }

  function getLabel(key: SidebarLabelKey): string {
    try {
      return t(key)
    } catch {
      return LABEL_FALLBACKS[key]
    }
  }

  // Sidebar style picker (Settings → Theme) writes 'light' | 'dark' to
  // localStorage; this hook is the consumer. Earlier the picker wrote
  // the value but no surface read it — staff would tap Dark, see
  // "適用済み" badge, and notice no visible change. Now: 'dark' applies
  // the same dark-mode `.dark` token cascade the global theme uses,
  // scoped to this <aside>.
  return (
    <aside
      className={`hidden h-full w-[244px] shrink-0 flex-col border-r border-border/30 py-5 md:flex ${
        sidebarStyle === 'dark' ? 'dark bg-neutral-900' : 'bg-[var(--color-bg-card)]'
      }`}
      aria-label="Main navigation"
    >
      <div className="px-5 pb-4 border-b border-border/20">
        <div className="text-[20px] font-extrabold leading-tight tracking-tight">
          SYNQED
        </div>
        <div className="text-[11px] font-medium tracking-[0.25em] uppercase text-muted-foreground mt-0.5">
          Karute
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-0.5 px-3 py-4 overflow-y-auto">
        {NAV_ROUTES.map((route) => {
          const isActive = route.id === activeId
          const Icon = route.Icon
          return (
            <Link
              key={route.id}
              href={hrefFor(route) as Parameters<typeof Link>[0]['href']}
              prefetch={route.prefetch}
              className="relative flex items-center"
              aria-current={isActive ? 'page' : undefined}
            >
              {isActive && (
                <span
                  className="absolute left-[-12px] top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r-full bg-blue-500"
                  aria-hidden="true"
                />
              )}
              <span
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${
                  isActive
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300 font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
              >
                <Icon />
                {getLabel(route.labelKey)}
              </span>
            </Link>
          )
        })}
      </nav>

      <SidebarProfileChip />
    </aside>
  )
}

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

function SidebarProfileChip() {
  const session = useSession()
  const t = useTranslations('staff')
  const tSidebar = useTranslations('sidebar')
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const { activeStaff, orgName } = session

  async function handleLogout() {
    // Shared salon device: kill the in-memory recorder/pipeline AND the
    // stored draft + takes before leaving, or the next staff member inherits
    // this one's unsaved customer session (see lib/karute/logout-wipe).
    // Best-effort: a wipe failure (e.g. its dynamic chunk 404s after a
    // deploy) must NEVER block signOut — an active session left behind is
    // the worse privacy outcome, and post-signOut the stored vault is
    // unreadable anyway (owner gates fail closed without a session).
    await wipeSessionVault().catch(() => {})
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login' as Parameters<typeof router.push>[0])
    router.refresh()
  }

  const activeInitials = activeStaff ? getInitials(activeStaff.name) : '??'
  const activeRole =
    activeStaff?.displayRole === 'owner' ? 'Owner' : 'Stylist'
  const triggerActiveClass = open
    ? 'border-blue-500/60 bg-blue-500/5'
    : 'border-transparent hover:bg-muted/40'

  return (
    <div className="px-3 pt-4 border-t border-border/20">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${triggerActiveClass}`}
        >
            <Avatar
              name={activeStaff?.name ?? '??'}
              initials={activeInitials}
              avatarUrl={activeStaff?.avatarUrl}
              tone="active"
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold truncate">
                {activeStaff?.name ?? t('selectStaff')}
              </p>
              <p className="text-[11px] text-muted-foreground">{activeRole}</p>
            </div>
            {open ? (
              <ChevronUp className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            )}
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-[260px] p-0 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border/20 bg-muted/30">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
              <Building2 className="size-3" />
              Store
            </p>
          </div>
          <div className="py-1">
            <StoreRow name={orgName ?? 'Karute'} role="Owner" active />
          </div>

          <div className="border-t border-border/20">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                router.push('/profile' as Parameters<typeof router.push>[0])
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-[13.5px] text-foreground hover:bg-muted/50 text-left"
            >
              <UserIcon className="size-3.5 text-muted-foreground" />
              {tSidebar('profile')}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-[13.5px] text-red-500 dark:text-red-400 hover:bg-red-500/5 text-left border-t border-border/20"
            >
              <LogOut className="size-3.5" />
              {t('logOut')}
            </button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function Avatar({
  name,
  initials,
  avatarUrl,
  tone,
}: {
  name: string
  initials: string
  avatarUrl?: string
  tone: 'active' | 'muted'
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
    )
  }
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
        tone === 'active'
          ? 'bg-blue-500 text-white'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      {initials}
    </div>
  )
}

function StoreRow({
  name,
  role,
  active,
}: {
  name: string
  role: string
  active: boolean
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2 bg-muted/30">
      <Check
        className={`size-3.5 shrink-0 mt-0.5 ${
          active ? 'text-blue-500' : 'text-transparent'
        }`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold truncate">{name}</p>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Crown className="size-3" />
          {role}
        </p>
      </div>
    </div>
  )
}
