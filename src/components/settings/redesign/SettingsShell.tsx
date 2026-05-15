'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import {
  Building2,
  Store,
  Palette,
  Sparkles,
  GraduationCap,
  Mic,
  Users,
  RefreshCw,
  CreditCard,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import type { OrgSettings } from '@/actions/org-settings'
import type { StaffMember } from '@/lib/staff'
import { OrganizationSection } from './sections/OrganizationSection'
import { StoresSection } from './sections/StoresSection'
import { ThemeSection } from './sections/ThemeSection'
import { AISection } from './sections/AISection'
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
  | 'recording'
  | 'staff'
  | 'sync'
  | 'subscription'
  | 'audit'

interface TabDef {
  id: SettingsTabId
  labelKey: string
  icon: LucideIcon
  ownerOnly?: boolean
}

const TABS: TabDef[] = [
  { id: 'organization', labelKey: 'organization', icon: Building2 },
  { id: 'stores', labelKey: 'stores', icon: Store },
  { id: 'theme', labelKey: 'theme', icon: Palette },
  { id: 'ai', labelKey: 'aiSettings', icon: Sparkles },
  // Coaching is rendered inline (disabled) — not in this array.
  { id: 'recording', labelKey: 'recordingSettings', icon: Mic },
  { id: 'staff', labelKey: 'staffManagement', icon: Users },
  { id: 'sync', labelKey: 'bookingSync', icon: RefreshCw },
  { id: 'subscription', labelKey: 'subscription', icon: CreditCard, ownerOnly: true },
  { id: 'audit', labelKey: 'auditLog', icon: ShieldCheck, ownerOnly: true },
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
  const [activeTab, setActiveTab] = useState<SettingsTabId>('organization')

  const visibleTabs = TABS.filter((tab) => !tab.ownerOnly || isOwner)

  // Tab strip with Coaching slotted between AI (index 3) and Recording.
  const tabsBeforeCoaching = visibleTabs.slice(0, 4)
  const tabsAfterCoaching = visibleTabs.slice(4)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/30 bg-muted/30 p-1">
        {tabsBeforeCoaching.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            label={t(tab.labelKey)}
          />
        ))}
        <CoachingDisabledTab title={t('coachingComingSoon')} label={t('coaching')} />
        {tabsAfterCoaching.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            label={t(tab.labelKey)}
          />
        ))}
      </div>

      <SectionPanel>
        {activeTab === 'organization' && (
          <OrganizationSection orgSettings={orgSettings} locale={locale} />
        )}
        {activeTab === 'stores' && (
          <StoresSection orgSettings={orgSettings} />
        )}
        {activeTab === 'theme' && (
          <ThemeSection orgSettings={orgSettings} locale={locale} />
        )}
        {activeTab === 'ai' && <AISection orgSettings={orgSettings} />}
        {activeTab === 'recording' && (
          <RecordingSection orgSettings={orgSettings} />
        )}
        {activeTab === 'staff' && (
          <StaffSection
            staffList={staffList}
            activeStaffId={activeStaffId}
            isOwner={isOwner}
          />
        )}
        {activeTab === 'sync' && <SyncSection />}
        {activeTab === 'subscription' && isOwner && <SubscriptionSection />}
        {activeTab === 'audit' && isOwner && <AuditLogSection />}
      </SectionPanel>
    </div>
  )
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
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 h-9 text-xs font-medium transition-colors ${
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

function CoachingDisabledTab({ title, label }: { title: string; label: string }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={title}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 h-9 text-xs font-medium text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50"
    >
      <GraduationCap className="size-3.5" />
      {label}
      <span className="ml-1 rounded-full bg-gray-200 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
        Soon
      </span>
    </button>
  )
}

function SectionPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/30 bg-card/50 p-6">
      {children}
    </div>
  )
}
