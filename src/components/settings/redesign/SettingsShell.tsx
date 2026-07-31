'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  GraduationCap,
  Mic,
  Palette,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  type LucideIcon,
  Ticket,
} from 'lucide-react'
import type { OrgSettings } from '@/actions/org-settings'
import type { StoreRow } from '@/actions/stores'
import type { Entitlement } from '@/lib/entitlements'
import type { StaffMember } from '@/lib/staff'
import type { SyncStatusDTO } from '@/lib/app-api/settings-screen-dto'
import { visibleSettingsTabs, visibleStaffRoster } from '@/lib/auth/settings-visibility'
import { OrganizationSection } from './sections/OrganizationSection'
import { StoresSection } from './sections/StoresSection'
import { ThemeSection } from './sections/ThemeSection'
import { AISection } from './sections/AISection'
import { CoachingSection } from './sections/CoachingSection'
import { RecordingSection } from './sections/RecordingSection'
import { StaffSection } from './sections/StaffSection'
import { SyncSection } from './sections/SyncSection'
import { SyncStatusCard } from './sections/SyncStatusCard'
import { PacksSection } from './sections/PacksSection'
import { AuditLogSection } from './sections/AuditLogSection'

export type SettingsTabId =
  | 'organization'
  | 'stores'
  | 'theme'
  | 'ai'
  | 'coaching'
  | 'recording'
  | 'staff'
  | 'sync'
  | 'packs'
  | 'audit'

interface TabDef {
  id: SettingsTabId
  labelKey: string
  /** Short sub-description rendered under the label in the mobile
   *  list view (spike pattern). Examples: "事業名、業種、営業時間"
   *  for organization, "Quick Reserve 等との同期" for sync. */
  descriptionKey: string
  icon: LucideIcon
  ownerOnly?: boolean
}

// Tab label keys: some of these (`theme`, `coaching`, `packs`, `auditLog`)
// collide with nested i18n blocks of the same name that hold section
// content (e.g. settings.theme.bar.*, settings.auditLog.*). next-intl
// can't return a nested object from a `t(key)` string call, so those
// tabs were rendering as raw "settings.theme" / "settings.auditLog" —
// the bug Liam called out. Fix: reach into the `.label` sub-key on the
// colliding ones, while keeping the non-colliding tabs (organization,
// stores, aiSettings, etc.) on their existing flat string keys.
const TABS: TabDef[] = [
  {
    id: 'organization',
    labelKey: 'organization',
    descriptionKey: 'organizationDescription',
    icon: Building2,
  },
  {
    id: 'stores',
    labelKey: 'storesTab',
    descriptionKey: 'storesDescription',
    icon: Store,
  },
  {
    id: 'theme',
    labelKey: 'theme.label',
    descriptionKey: 'themeDescription',
    icon: Palette,
  },
  {
    id: 'ai',
    labelKey: 'aiSettings',
    descriptionKey: 'aiDescription',
    icon: Sparkles,
  },
  {
    // Real tab now (was previously an inline "Coming Soon" disabled
    // chip on desktop). Section content is scaffolded with interactive-
    // looking controls (sliders move, toggles flip, textarea accepts
    // input — all via local useState). One Phase-3 banner at the top
    // of the section sets expectations without per-card noise.
    //
    // labelKey is `coaching.label` (not `coaching`) because
    // `settings.coaching` is an object holding the section's nested
    // copy. Same i18n-collision pattern as theme/subscription/auditLog.
    id: 'coaching',
    labelKey: 'coaching.label',
    descriptionKey: 'coachingDescription',
    icon: GraduationCap,
  },
  {
    id: 'recording',
    labelKey: 'recordingSettings',
    descriptionKey: 'recordingDescription',
    icon: Mic,
  },
  {
    id: 'staff',
    labelKey: 'staffManagement',
    descriptionKey: 'staffDescription',
    icon: Users,
  },
  {
    id: 'sync',
    labelKey: 'bookingSync',
    descriptionKey: 'bookingSyncDescription',
    icon: RefreshCw,
  },
  {
    id: 'packs',
    labelKey: 'packs.label',
    descriptionKey: 'packsDescription',
    icon: Ticket,
    ownerOnly: true,
  },
  // No standalone subscription / 契約 tab — the plan & paywall live inside
  // 店舗 (StoresSection → PlanComparisonDialog), per Liam's IA, gated
  // per-account off the real entitlement. The old tab rendered the
  // misleading trial-countdown mock (tier: 'trial', ended 2026-06-15);
  // retired here. Payment method / invoices land in 店舗 too once Stripe
  // (task #14) is wired — SubscriptionSection stays on disk as scaffold.
  {
    // Not ownerOnly: gated on canViewAudit (owner OR explicit audit.view
    // grant) in settings-visibility, per the 7/17 per-manager-toggle ruling.
    id: 'audit',
    labelKey: 'auditLog.label',
    descriptionKey: 'auditLogDescription',
    icon: ShieldCheck,
  },
]

interface SettingsShellProps {
  orgSettings: OrgSettings | null
  staffList: StaffMember[]
  activeStaffId: string | null
  locale: string
  isOwner: boolean
  /** Capability flags resolved server-side (settings/page.tsx). These gate
   *  what the settings UI OFFERS; the server actions enforce the same
   *  capabilities regardless. */
  canViewAllStores: boolean
  canManageStaff: boolean
  canInviteStaff: boolean
  /** owner OR explicit audit.view grant — gates the 監査ログ tab. */
  canViewAudit: boolean
  /** owner OR explicit sync.view grant — gates the 予約同期 tab (PR-M2 fix
   *  round). Same idiom as canViewAudit. */
  canViewSync: boolean
  /** Deep-link tab (?tab=…): opens drilled-in on mobile, selected on desktop. */
  initialTab?: SettingsTabId | null
  /** Customer id for the 監査ログ dispute view (?tab=audit&target=…). */
  auditTargetId?: string | null
  /** Stores fetched on the server, passed straight to StoresSection so its
   *  list renders complete on first paint instead of fetching on mount. */
  initialStores: StoreRow[]
  initialActiveStoreId: string | null
  /** Entitlement fetched on the server — plan row + add-store gate paint with
   *  the page. Null on fetch failure → StoresSection falls back to its client
   *  fetch. */
  initialEntitlement: Entitlement | null
  /** Tab ids that render an in-shell 準備中 (pending) panel instead of their
   *  real section — the thin bundle's per-tab rollout lever (design-parity
   *  packet 12 §S1). OPTIONAL; default/omitted = every tab renders its real
   *  section, i.e. WEB IS UNTOUCHED (only the thin caller ever passes this).
   *  The tab itself stays fully visible/selectable, subject to the SAME
   *  visibleSettingsTabs capability gates as any other tab — only its
   *  CONTENT is replaced. Shrinks to empty as later parity slices land. */
  pendingTabIds?: readonly SettingsTabId[]
  /** Tab ids that render an in-shell "web-only" panel instead of their real
   *  section — for tabs that stay permanently web-only (design-parity
   *  packet 20 §S5, e.g. 同期). OPTIONAL; default/omitted = every tab
   *  renders its real section, i.e. WEB IS UNTOUCHED (only the thin caller
   *  ever passes this). Checked BEFORE pendingTabIds in renderSection, so a
   *  tab in both takes the web-only panel. */
  webOnlyTabIds?: readonly SettingsTabId[]
  /** 予約同期 read-only status (packet 31). OPTIONAL; omitted/null on web
   *  (the sync tab renders SyncSection exactly as today — the shell keys off
   *  this value's PRESENCE, not a separate boolean, so undefined behaves
   *  the same as null). Non-null → SyncStatusCard, checked before
   *  webOnlyTabIds so a grant-holding viewer sees the card instead of the
   *  "manage on web" panel. */
  syncStatus?: SyncStatusDTO | null
  /** 今すぐ同期 (packet 32). OPTIONAL; omitted on web (SyncStatusCard renders
   *  zero interactive elements, same PRESENCE-gates-the-button idiom as
   *  syncStatus above) — only the thin caller (sync.view/owner grant) passes
   *  it, threaded straight to the card. */
  onRunNow?: () => Promise<{ ok: boolean; message?: string }>
  /** Server-truth feature flags (design-parity packet 12 §S4a). OPTIONAL;
   *  omitted on web (StaffSection/StaffForm fall back to reading the env var
   *  directly, today's behavior, byte-for-byte) — only the thin caller
   *  passes these (its process.env is {}, so the env fallback alone would
   *  always read false). */
  featureStaffInvites?: boolean
  featureMultiStore?: boolean
}

export function SettingsShell({
  orgSettings,
  staffList,
  activeStaffId,
  locale,
  isOwner,
  canViewAllStores,
  canManageStaff,
  canInviteStaff,
  canViewAudit,
  canViewSync,
  initialTab,
  auditTargetId,
  initialStores,
  initialActiveStoreId,
  initialEntitlement,
  pendingTabIds,
  webOnlyTabIds,
  syncStatus,
  onRunNow,
  featureStaffInvites,
  featureMultiStore,
}: SettingsShellProps) {
  const t = useTranslations('settings')
  // null = mobile list view (no section drilled into).
  // On desktop, `null` resolves to the first visible tab so the tab
  // strip always has something selected.
  const [activeTab, setActiveTab] = useState<SettingsTabId | null>(initialTab ?? null)

  // 店舗 hidden from branch-restricted staff; staff roster clamped to self for
  // non-managers. Pure, unit-tested rules (see lib/auth/settings-visibility) —
  // this is UI exposure reduction; server actions enforce the real boundary.
  const visibleTabs = visibleSettingsTabs(TABS, { isOwner, canViewAllStores, canViewAudit, canViewSync })
  const visibleStaff = visibleStaffRoster(staffList, activeStaffId, canManageStaff)

  const desktopActiveTab = activeTab ?? visibleTabs[0]?.id ?? null
  const drilledTab = activeTab
    ? visibleTabs.find((x) => x.id === activeTab) ?? null
    : null

  function renderSection(id: SettingsTabId | null): ReactNode {
    // Sync status card intercept (Liam ruling 7/24, packet 31) — BEFORE the
    // web-only intercept below, so a sync.view/owner grant renders the
    // read-only card instead of the "manage on web" panel. Web never passes
    // syncStatus (undefined) — falls straight through to that panel/section.
    if (id === 'sync' && syncStatus) return <SyncStatusCard status={syncStatus} onRunNow={onRunNow} />
    // Web-only intercept (design-parity packet 20 §S5) — BEFORE pendingTabIds,
    // so a tab in both takes the web-only panel over the generic pending one.
    if (id && webOnlyTabIds?.includes(id)) return <WebOnlyTabPanel />
    // Pending-tab intercept (design-parity packet 12 §S1) — BEFORE the real
    // switch, so a pending tab never reaches (and never needs) its section's
    // own defense-in-depth capability check below.
    if (id && pendingTabIds?.includes(id)) return <PendingTabPanel />
    switch (id) {
      case 'organization':
        return <OrganizationSection orgSettings={orgSettings} locale={locale} />
      case 'stores':
        // Defense in depth alongside the tab filter above (same idiom as the
        // ownerOnly sections below).
        return canViewAllStores ? (
          <StoresSection
            orgSettings={orgSettings}
            isOwner={isOwner}
            initialStores={initialStores}
            initialActiveStoreId={initialActiveStoreId}
            initialEntitlement={initialEntitlement}
          />
        ) : null
      case 'theme':
        return <ThemeSection orgSettings={orgSettings} locale={locale} />
      case 'ai':
        return <AISection orgSettings={orgSettings} />
      case 'coaching':
        return <CoachingSection />
      case 'recording':
        return <RecordingSection orgSettings={orgSettings} />
      case 'staff':
        return (
          <StaffSection
            staffList={visibleStaff}
            activeStaffId={activeStaffId}
            canManageStaff={canManageStaff}
            canInviteStaff={canInviteStaff}
            entitlement={initialEntitlement}
            voiceEnrollments={Object.fromEntries(
              Object.entries(orgSettings?.voice_enrollments ?? {}).map(
                ([id, v]) => [id, v.status === 'saved' ? v.consent_at : null],
              ),
            )}
            businessType={orgSettings?.business_type}
            stores={initialStores}
            featureStaffInvites={featureStaffInvites}
            featureMultiStore={featureMultiStore}
          />
        )
      case 'sync':
        // Defense in depth alongside the tab filter above (same idiom as the
        // audit/stores sections) — the server routes enforce sync.view
        // regardless; this only stops a stray render.
        return canViewSync ? <SyncSection /> : null
      case 'packs':
        return isOwner ? <PacksSection orgSettings={orgSettings} /> : null
      case 'audit':
        // Defense in depth alongside the tab filter (server action enforces
        // audit.view regardless — this only stops a stray render).
        return canViewAudit ? (
          <AuditLogSection staffList={staffList} initialTargetId={auditTargetId} />
        ) : null
      default:
        return null
    }
  }

  return (
    // NO own px-4 — the parent SettingsPageChrome already provides
    // `p-4 md:p-6` (per-page wrapper owns horizontal padding under
    // the system rule).
    <div className="space-y-4">
      {/* Page subtitle — small descriptor line under the "設定"
       *  title (rendered by SettingsPageChrome above). Matches the
       *  spike's pattern of explaining what the page contains
       *  before diving into tabs/list. */}
      <p className="-mt-2 text-sm leading-relaxed text-muted-foreground">
        {t('subtitle')}
      </p>

      {/* ─────────────────────────────────────────────────────────
       *  MOBILE — vertical list-drill pattern (matches spike).
       *  When activeTab === null, render the list of section cards.
       *  When activeTab is set, render a back button + section title
       *  + the section content (drill-in view).
       *  Hidden on md+ in favor of the tab strip below.
       *  ───────────────────────────────────────────────────────── */}
      <div className="md:hidden">
        {activeTab === null ? (
          <ListView
            tabs={visibleTabs}
            onSelect={(id) => setActiveTab(id)}
            t={t}
          />
        ) : (
          <DrillInView
            tab={drilledTab}
            onBack={() => setActiveTab(null)}
            backLabel={t('backToList')}
          >
            {renderSection(activeTab)}
          </DrillInView>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────
       *  DESKTOP — tab strip + section panel (existing pattern).
       *  Coaching slotted between AI and post-AI tabs as a disabled
       *  chip. activeTab defaults to first visible tab when null.
       *  Hidden below md so mobile only sees the list/drill.
       *  ───────────────────────────────────────────────────────── */}
      <div className="hidden md:block">
        <div className="flex items-center gap-1 rounded-xl border border-border/30 bg-muted/30 p-1 overflow-x-auto whitespace-nowrap [scrollbar-width:thin]">
          {visibleTabs.map((tab) => (
            <TabButton
              key={tab.id}
              tab={tab}
              active={desktopActiveTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              label={t(tab.labelKey)}
            />
          ))}
        </div>

        <div className="mt-6">
          <SectionPanel>{renderSection(desktopActiveTab)}</SectionPanel>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Mobile list view — vertical card list with icon + title +
// sub-description + chevron. Same visual as the spike.
// ─────────────────────────────────────────────────────────────
function ListView({
  tabs,
  onSelect,
  t,
}: {
  tabs: TabDef[]
  onSelect: (id: SettingsTabId) => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/5 dark:ring-white/5">
      <div className="divide-y divide-black/5 dark:divide-white/5">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-black/[0.02] dark:active:bg-white/[0.03]"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70">
                <Icon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium text-foreground">
                  {t(tab.labelKey)}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {t(tab.descriptionKey)}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Mobile drill-in view — back button + icon + title + section.
// Matches the spike's "← 設定に戻る" pattern.
// ─────────────────────────────────────────────────────────────
function DrillInView({
  tab,
  onBack,
  backLabel,
  children,
}: {
  tab: TabDef | null
  onBack: () => void
  backLabel: string
  children: ReactNode
}) {
  const Icon = tab?.icon
  const rootRef = useRef<HTMLDivElement>(null)
  // The scroll container (thin shell's <main>, or the web (app) layout's
  // clamped scroll region) is a PERSISTENT element — the list's scroll offset
  // survives the list→drill content swap, so tapping a card low in the list
  // opened the section mid-scroll with 設定に戻る parked above the fold (read
  // in the field as "the back button is gone"). Open every section at the top:
  // zeroing each ancestor is a no-op on containers that aren't scrolled.
  // Keyed on `tab` (not mount-only): on mobile list⇄drill remounts this
  // component anyway, but on desktop this instance stays mounted (CSS-hidden)
  // across tab switches — the reset must re-run per section change so no
  // section inherits the previous one's offset. Layout effect, not effect:
  // the reset lands BEFORE paint, so the old offset never flashes.
  useLayoutEffect(() => {
    if (!tab) return
    for (let el = rootRef.current?.parentElement ?? null; el; el = el.parentElement) {
      el.scrollTop = 0
    }
  }, [tab])
  return (
    <div ref={rootRef} className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {backLabel}
      </button>

      {tab && (
        <div className="flex items-center gap-2">
          {Icon && <Icon className="size-5 text-foreground/80" />}
          <h2 className="text-[22px] font-semibold tracking-tight text-foreground">
            <SectionTitleLabel labelKey={tab.labelKey} />
          </h2>
        </div>
      )}

      {children}
    </div>
  )
}

// Tiny helper so we can call useTranslations inline at the title
// position without restructuring DrillInView's prop signature.
// next-intl handles the dot-path lookup (e.g. "theme.label").
function SectionTitleLabel({ labelKey }: { labelKey: string }) {
  const t = useTranslations('settings')
  return <>{t(labelKey)}</>
}

function TabButton({
  tab,
  active,
  onClick,
  label,
}: {
  tab: TabDef
  active: boolean
  onClick: () => void
  label: string
}) {
  const Icon = tab.icon
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 h-9 text-xs font-medium transition-colors ${
        active
          ? 'bg-foreground text-background shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}

// CoachingDisabledTab removed — coaching is now a real tab with its own
// scaffolded section (see CoachingSection.tsx). The inline "Coming Soon"
// chip was a placeholder for the disabled state; the new section
// renders Phase-3 pills on each control inside, making the status
// clearer than a single disabled tab chip ever could.

function SectionPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/30 bg-card/50 p-6">
      {children}
    </div>
  )
}

// 準備中 (pending) panel — the thin bundle's per-tab rollout lever
// (design-parity packet 12 §S1). Rendered ONLY when the caller opts a tab
// into pendingTabIds; web's default omits the prop, so this branch never
// executes there. Same copy as the router's top-level PendingScreen
// (thin/router.tsx) for a consistent "not built yet" message across the app.
// ponytail: hardcoded ja, matching the router placeholder's own reasoning —
// pendingTabIds is thin-only in practice, and this panel retires tab-by-tab
// as later parity slices land the real section.
function PendingTabPanel() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-sm font-medium text-foreground">この画面は準備中です</p>
      <p className="text-xs text-muted-foreground">
        次のアップデートでご利用いただけます
      </p>
    </div>
  )
}

// Web-only panel — the thin bundle's per-tab carve-out lever (design-parity
// packet 20 §S5). Rendered ONLY when the caller opts a tab into
// webOnlyTabIds; web's default omits the prop, so this branch never executes
// there. Unlike PendingTabPanel this copy is real (not "coming soon") — the
// tab stays web-only by design (see packet 20), so it goes through i18n
// rather than the hardcoded ja PendingTabPanel uses.
// ponytail: webOnlyTabIds is thin-only in practice, same as pendingTabIds.
function WebOnlyTabPanel() {
  const t = useTranslations('settings.sync')
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-sm font-medium text-foreground">{t('webOnly')}</p>
    </div>
  )
}
