'use client'

import { Users, User } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { StaffSelector } from '@/components/staff/StaffSelector'

/**
 * Staff filter row — mirrors the design-spike's staff-picker. Lets the
 * viewer scope the customer list to one staff member (or back to
 * everyone / themselves).
 *
 * Two visual tiers:
 *   1. Scope toggle:   [Self] [All staff]   ← always visible
 *   2. Staff pills:    [JC Jon Chan] [佐 佐藤] [中 中村] ...
 *                      colored avatar with initials uses the subtle
 *                      `bg` + `text` from `assignStaffColors` (the same
 *                      DISTINCT, collision-free palette mapping as the
 *                      customer-row left-edge stripe, so a stylist's
 *                      color stays consistent everywhere they appear).
 *
 * Selection model: a single string — 'all' | 'self' | <staffId>.
 * Mutually exclusive; clicking an already-active staff pill snaps back
 * to 'all'. Self pill is hidden when the viewer has no staff profile.
 *
 * NOTE for Anthony: there's intentional overlap with the existing
 * `CustomersStatusFilters` "Preferred Staff" filter — both scope to
 * the viewer's own customers. Once you're happy with this picker we
 * should deprecate that status-filter pill so there's a single source
 * of truth for "show me my customers."
 */
export type StaffFilterKey = 'all' | 'self' | (string & {})

export interface StaffFilterEntry {
  id: string
  name: string
  initials: string
  /** 経営メンバー — carried for the assignment pickers fed from this same
   *  roster. The FILTER itself never hides them (Liam ruling Ⓒ: narrowing the
   *  view is not assigning work). */
  isManagement?: boolean
}

interface CustomersStaffFilterProps {
  staffList: StaffFilterEntry[]
  selfStaffId: string | null
  selected: StaffFilterKey
  onChange: (next: StaffFilterKey) => void
}

export function CustomersStaffFilter({
  staffList,
  selfStaffId,
  selected,
  onChange,
}: CustomersStaffFilterProps) {
  const t = useTranslations('customers.list.staffFilter')

  // If there are no staff at all (and no self), the picker has nothing
  // to offer — render nothing rather than a useless empty row.
  if (staffList.length === 0 && !selfStaffId) return null

  return (
    // ONE chrome line (Liam-approved D): segment + 担当 trigger. The pill
    // rows are gone — the roster lives in the StaffSelector bottom sheet,
    // constant height from 9 staff to 200.
    <div className="flex flex-wrap items-center gap-2">
      <ScopeToggle
        selfStaffId={selfStaffId}
        selected={selected}
        onChange={onChange}
        selfLabel={t('self')}
        allLabel={t('all')}
      />
      <StaffSelector
        staffList={staffList}
        selected={selected}
        onChange={(next) => onChange(next as StaffFilterKey)}
      />
    </div>
  )
}

/**
 * Bound segmented toggle (Self ｜ All staff). iOS-style: the outer
 * container has a muted gray fill, the ACTIVE segment renders as a
 * white pill inside it with a subtle shadow. Inactive segments are
 * transparent (showing the container's gray through) with muted
 * text. Mirrors the design spike's `自分 / 全スタッフ` control.
 *
 * Earlier misses:
 *   - two separate pills (no shared container)
 *   - bound segment but with bg-foreground/text-background swap on
 *     active (too aggressive, dark fill instead of white pill)
 *
 * Self half hides when the viewer has no staff profile — "All staff"
 * then occupies the full segment.
 */
function ScopeToggle({
  selfStaffId,
  selected,
  onChange,
  selfLabel,
  allLabel,
}: {
  selfStaffId: string | null
  selected: StaffFilterKey
  onChange: (next: StaffFilterKey) => void
  selfLabel: string
  allLabel: string
}) {
  const hasSelf = !!selfStaffId
  return (
    <div className="inline-flex h-9 w-fit items-stretch rounded-full border border-border bg-muted/50 p-0.5 text-xs font-medium">
      {hasSelf && (
        <SegmentButton
          active={selected === 'self'}
          onClick={() => onChange('self')}
          icon={<User size={13} />}
          label={selfLabel}
        />
      )}
      <SegmentButton
        active={selected === 'all'}
        onClick={() => onChange('all')}
        icon={<Users size={13} />}
        label={allLabel}
      />
    </div>
  )
}

function SegmentButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 transition-all ${
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

