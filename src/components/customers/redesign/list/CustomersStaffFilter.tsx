'use client'

import { StaffScopeSegment } from '@/components/staff/StaffScopeSegment'

/**
 * Staff filter row on the 顧客 list — ⚖ STAFF CONTROL LOCKED 04:5x (Liam): ONE
 * two-segment control 自分 | 全スタッフ ⌄ (StaffScopeSegment). The separate 担当
 * chip that sat beside the old segment is gone (it was the S43 overflow's
 * cause); its list opens from the segment's chevron instead — the same
 * StaffSelector panel, never a fork.
 *
 * Selection model: a single string — 'all' | 'self' | <staffId>. The caller
 * passes the RESOLVED value (staff-scope.ts: a staff id off the roster reads
 * 全スタッフ, ⚖ 退職スタッフのリンク = 全員を表示). 自分 is hidden when the
 * viewer has no staff profile.
 */
export type StaffFilterKey = 'all' | 'self' | (string & {})

export interface StaffFilterEntry {
  id: string
  name: string
  initials: string
  /** 経営メンバー — carried for the assignment pickers fed from this same
   *  roster, and for the shared StaffSelector's own default-list hiding
   *  (⚖ 2026-09-01 overturn of ruling Ⓒ: the filter's default list now
   *  hides them too; typing in its search box reveals them again). The
   *  ARRAY passed to this component still stays complete — narrowing what's
   *  offered is StaffSelector's job, not this component's. */
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
  return (
    <StaffScopeSegment
      staffList={staffList}
      selfStaffId={selfStaffId}
      selected={selected}
      onChange={(next) => onChange(next as StaffFilterKey)}
    />
  )
}
