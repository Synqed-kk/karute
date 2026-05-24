'use client'

import { Users, User } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { getStaffColor } from '@/lib/staff/colors'

/**
 * Staff filter row — mirrors the design-spike's staff-picker. Lets the
 * viewer scope the customer list to one staff member (or back to
 * everyone / themselves).
 *
 * Two visual tiers:
 *   1. Scope toggle:   [Self] [All staff]   ← always visible
 *   2. Staff pills:    [JC Jon Chan] [佐 佐藤] [中 中村] ...
 *                      colored avatar with initials uses
 *                      `getStaffColor(staffId)` (same deterministic
 *                      palette as the customer-row left-edge stripe,
 *                      so a stylist's color stays consistent
 *                      everywhere they appear).
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
    <div className="flex flex-col gap-2">
      {/* Row 1: scope toggle — bound segment, mirrors the spike */}
      <ScopeToggle
        selfStaffId={selfStaffId}
        selected={selected}
        onChange={onChange}
        selfLabel={t('self')}
        allLabel={t('all')}
      />

      {/* Row 2: per-staff pills with deterministic colors */}
      {staffList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {staffList.map((s) => (
            <StaffPill
              key={s.id}
              staff={s}
              active={selected === s.id}
              onClick={() =>
                onChange(selected === s.id ? 'all' : s.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Two adjacent scope pills (Self / All staff). Each pill has its own
 * rounded outline, sitting close together with a small gap — matches
 * the design spike's `自分` / `全スタッフ` controls. Earlier version
 * was a bound segment with internal divider + harsh foreground/
 * background swap; that didn't match the spike's softer look.
 *
 * Self pill hides when the viewer has no staff profile.
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
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      {selfStaffId && (
        <ScopePill
          active={selected === 'self'}
          onClick={() => onChange('self')}
          icon={<User size={13} />}
          label={selfLabel}
        />
      )}
      <ScopePill
        active={selected === 'all'}
        onClick={() => onChange('all')}
        icon={<Users size={13} />}
        label={allLabel}
      />
    </div>
  )
}

function ScopePill({
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
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
        active
          ? 'border-foreground/30 bg-muted text-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function StaffPill({
  staff,
  active,
  onClick,
}: {
  staff: StaffFilterEntry
  active: boolean
  onClick: () => void
}) {
  const color = getStaffColor(staff.id)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-2 rounded-full border pl-1 pr-3 text-xs font-medium transition-colors ${
        active
          ? 'border-foreground/40 bg-muted text-foreground'
          : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
      aria-pressed={active}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-1 ring-black/5"
        style={{ background: color ?? 'var(--muted)' }}
        aria-hidden
      >
        {staff.initials}
      </span>
      <span className="truncate max-w-[120px]">{staff.name}</span>
    </button>
  )
}
