'use client'

// LIFTED FROM SPIKE (pattern: same as CustomersStaffFilter)
//   spike src: /Users/liam/Documents/synqed-karute-design-spike/src/components/shared/ViewModeSelector.tsx
//
// Self / All / per-staff filter for the 予約 tab. Same control as the 顧客
// list — ONE two-segment 自分 | 全スタッフ ⌄ (StaffScopeSegment, ⚖ STAFF
// CONTROL LOCKED 04:5x); the separate 担当 chip is gone from this row. Different
// prop shape because:
//   - reservation page is server-rendered and uses URL state (?staff=…)
//   - customer list is client-side controlled state
//
// Selection model: a single string — 'all' | 'self' | <staffId>. The Self
// segment hides when the viewer has no staff identity (e.g. owner with no
// `staff_profile`).

import { useEffect, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { useLocale } from 'next-intl'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { StaffScopeSegment } from '@/components/staff/StaffScopeSegment'
import {
  rememberStaffScope,
  resolveStaffScope,
  useRestoreStaffScope,
} from '@/components/staff/staff-scope'

export interface ReservationStaffEntry {
  id: string
  name: string
  initials: string
  /** 経営メンバー — carried through so the shared StaffSelector can hide them
   *  from its default list (⚖ 2026-09-01 overturn of ruling Ⓒ). */
  isManagement?: boolean
}

interface Props {
  staffList: ReservationStaffEntry[]
  selfStaffId: string | null
  /** Active filter key from the URL — 'all' | 'self' | <staffId>. */
  selected: string
  /** The viewer's own id — keys the remembered pick (staff-scope.ts). null =
   *  nothing remembered, nothing written. */
  operatorId?: string | null
  /** Optional content rendered BEFORE the staff control in the same row —
   *  the reservation page's Day/Week/Month toggle. */
  prependSlot?: React.ReactNode
}

export function ReservationStaffFilter({
  staffList,
  selfStaffId,
  selected,
  operatorId = null,
  prependSlot,
}: Props) {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const rosterIds = staffList.map((s) => s.id)
  // ⚖ 退職スタッフのリンク = 全員を表示 — the one lens (staff-scope.ts).
  const effective = resolveStaffScope(selected, { selfStaffId, rosterIds })

  function go(next: string, mode: 'push' | 'replace') {
    const params = new URLSearchParams(search?.toString() ?? '')
    if (next === 'all') params.delete('staff')
    else params.set('staff', next)
    const qs = params.toString()
    const href = qs ? `${pathname}?${qs}` : pathname
    startTransition(() => (mode === 'push' ? router.push(href) : router.replace(href)))
  }

  function setStaff(next: string) {
    rememberStaffScope('appointments', operatorId, next)
    go(next, 'push')
  }

  // The fetch is the server's (`?staff=`), so a param the roster cannot place
  // is made to AGREE with the control: the control already reads 全スタッフ,
  // and the URL drops the param so the list reads everyone too (one quiet
  // replace, the row dims while it lands). Never an empty list under a label
  // that says 全スタッフ.
  useEffect(() => {
    if (selected !== 'all' && effective === 'all') go('all', 'replace')
    // go() closes over the latest params; the pair above is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, effective])

  // The remembered pick (no `?staff=` on this visit): URL > remembered > 全スタッフ.
  useRestoreStaffScope({
    tab: 'appointments',
    operatorId,
    urlParam: search?.get('staff') ?? null,
    apply: (remembered) => {
      const next = resolveStaffScope(remembered, { selfStaffId, rosterIds })
      if (next !== 'all') go(next, 'replace')
    },
  })

  // Empty when there's no staff to filter AND no self identity — nothing to
  // pick. Avoids rendering an empty row.
  if (staffList.length === 0 && !selfStaffId) return null

  return (
    // ⚖ FIT BY DESIGN (04:2x) + the lead's English width step (shown to Liam,
    // stands): NO wrap, NO scroll, NO shrinking. Japanese: 日/週/月 and the
    // staff control share ONE row at every width. English below 430px: the
    // English 日/週/月 (Day · Week · Month) is ~70px wider than the Japanese,
    // so the staff control sits on its OWN row directly under it — a defined
    // layout keyed on the rendered locale and the width, never on measured
    // overflow. gap-2 = the header-row gap of every list tab (SPACING scale).
    <div
      data-staff-row={locale === 'en' ? 'en' : 'ja'}
      className={cn(
        'flex gap-2',
        locale === 'en'
          ? 'flex-col items-start min-[430px]:flex-row min-[430px]:items-center'
          : 'flex-row flex-nowrap items-center',
        isPending && 'opacity-60',
      )}
    >
      {prependSlot}
      <StaffScopeSegment
        staffList={staffList}
        selfStaffId={selfStaffId}
        selected={effective}
        onChange={setStaff}
      />
    </div>
  )
}
