'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  CreditCard,
  GraduationCap,
  Mic,
  Palette,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { OrgSettings } from '@/actions/org-settings'
import type { StaffMember } from '@/lib/staff'
import { OrganizationSection } from './sections/OrganizationSection'
import { StoresSection } from './sections/StoresSection'
import { ThemeSection } from './sections/ThemeSection'
import { AISection } from './sections/AISection'
import { CoachingSection } from './sections/CoachingSection'
import { RecordingSection } from './sections/RecordingSection'
import { StaffSection } from './sections/StaffSection'
import { SyncSection } from './sections/SyncSection'
import { SubscriptionSection } from './sections/SubscriptionSection'
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
  | 'subscription'
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

// Tab label keys: 3 of these (`theme`, `subscription`, `auditLog`) collide
// with nested i18n blocks of the same name that hold section content
// (e.g. settings.theme.bar.*, settings.subscription.plan.*). next-intl
// can't return a nested object from a `t(key)` string call, so those
// tabs were rendering as raw "settings.theme" / "settings.subscription"
// / "settings.auditLog" — exactly the bug Liam called out. Fix:
// reach into the `.label` sub-key on the colliding ones, while keeping
// the non-colliding tabs (organization, stores, aiSettings, etc.) on
// their existing flat string keys.
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
    id: 'subscription',
    labelKey: 'subscription.label',
    descriptionKey: 'subscriptionDescription',
    icon: CreditCard,
    ownerOnly: true,
  },
  {
    id: 'audit',
    labelKey: 'auditLog.label',
    descriptionKey: 'auditLogDescription',
    icon: ShieldCheck,
    ownerOnly: true,
  },
]

interface SettingsShellProps {
  orgSettings: OrgSettings | null
  staffList: StaffMember[]
  activeStaffId: string | null
  locale: string
  isOwner: boolean
}

export function SettingsShell({
  orgSettings,
  staffList,
  activeStaffId,
  locale,
  isOwner,
}: SettingsShellProps) {
  const t = useTranslations('settings')
  // null = mobile list view (no section drilled into).
  // On desktop, `null` resolves to the first visible tab so the tab
  // strip always has something selected.
  const [activeTab, setActiveTab] = useState<SettingsTabId | null>(null)

  const visibleTabs = TABS.filter((tab) => !tab.ownerOnly || isOwner)

  const desktopActiveTab = activeTab ?? visibleTabs[0]?.id ?? null
  const drilledTab = activeTab
    ? visibleTabs.find((x) => x.id === activeTab) ?? null
    : null

  function renderSection(id: SettingsTabId | null): ReactNode {
    switch (id) {
      case 'organization':
        return <OrganizationSection orgSettings={orgSettings} locale={locale} />
      case 'stores':
        return <StoresSection orgSettings={orgSettings} isOwner={isOwner} />
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
            staffList={staffList}
            activeStaffId={activeStaffId}
            isOwner={isOwner}
          />
        )
      case 'sync':
        return <SyncSection />
      case 'subscription':
        return isOwner ? <SubscriptionSection /> : null
      case 'audit':
        return isOwner ? <AuditLogSection /> : null
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
  return (
    <div className="space-y-4">
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
