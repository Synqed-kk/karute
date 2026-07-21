'use client'

import { useTranslations } from 'next-intl'
import type { StaffMember } from '@/lib/staff'
import type { Entitlement } from '@/lib/entitlements'
import type { StoreRow } from '@/actions/stores'
import { StaffList } from '@/components/staff/StaffList'
import { InviteStaffDialog } from './staff/InviteStaffDialog'

interface StaffSectionProps {
  staffList: StaffMember[]
  voiceEnrollments?: Record<string, string | null>
  activeStaffId: string | null
  /** staff.manage capability — add/edit/delete rows (owner + manager, or
   *  anyone the owner toggled it onto, e.g. an SV). */
  canManageStaff: boolean
  /** staff.invite capability — generate /join links. */
  canInviteStaff: boolean
  /** Live plan (server-loaded, same object StoresSection gets) — drives the
   *  staff-cap meter + add/invite lock. Null / disarmed / degraded /
   *  unlimited → no cap UI at all (today's look, byte-for-byte). */
  entitlement?: Entitlement | null
  /** The salon's business_type — threaded from orgSettings (server-fetched
   *  by the caller) instead of StaffForm fetching it itself client-side
   *  (design-parity packet 12 §S4a, T3: kills a client re-fetch). */
  businessType?: string
  /** The business's stores — threaded from the caller's own fetch (same
   *  data StoresSection gets) instead of StaffForm fetching it itself
   *  client-side (T3). */
  stores?: StoreRow[]
  /** Server-truth override for NEXT_PUBLIC_FEATURE_STAFF_INVITES (T3) —
   *  `prop ?? env` so web (which never passes this) is unchanged. */
  featureStaffInvites?: boolean
  /** Same, for NEXT_PUBLIC_FEATURE_MULTI_STORE — threaded through to
   *  StaffForm's store-assignment UI. */
  featureMultiStore?: boolean
}

export function StaffSection({
  staffList,
  voiceEnrollments,
  activeStaffId,
  canManageStaff,
  canInviteStaff,
  entitlement,
  businessType,
  stores,
  featureStaffInvites,
  featureMultiStore,
}: StaffSectionProps) {
  const t = useTranslations('settings')
  const invitesEnabled =
    featureStaffInvites ?? process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES === 'true'

  // Cap UI only when the walls are ARMED and the plan really is finite —
  // mirrors the server's staffAddAllowed. (The server also counts pending
  // brand-new invites, so a 1-off between this meter and the server verdict
  // is possible; the server wins and the dialog surfaces its copy.)
  const staffCap =
    entitlement &&
    entitlement.enforced &&
    !entitlement.degraded &&
    !entitlement.isUnlimited &&
    typeof entitlement.staffLimit === 'number'
      ? {
          limit: entitlement.staffLimit,
          atLimit: staffList.length >= entitlement.staffLimit,
        }
      : null

  // No own `<h3>スタッフ管理</h3>` title — the SettingsShell's DrillInView
  // (mobile) and SectionPanel (desktop) already render the section
  // heading with icon. Adding another here is what caused the triple
  // "スタッフ管理" / "スタッフ管理" / "スタッフメンバー" stack Liam called out.
  // StaffList owns its own "スタッフメンバー" header row (with the +追加
  // button on the right, matching the spike's pattern).
  return (
    <div className="space-y-6">
      <StaffList
        staffList={staffList}
        voiceEnrollments={voiceEnrollments}
        activeStaffId={activeStaffId}
        currentUserId={activeStaffId}
        canManageStaff={canManageStaff}
        staffCap={staffCap}
        businessType={businessType}
        stores={stores}
        featureMultiStore={featureMultiStore}
      />

      {/* Invite staff — capability-gated (staff.invite: owner + manager + any
          custom role the owner toggles it onto), behind the staff-invites flag.
          Generates a /join link so a teammate logs into THIS salon instead of
          creating their own. Was owner-only; the UI now matches the server gate
          (createInvite enforces the same capability). The dialog stays
          reachable at the cap — RE-invites to existing staff are always
          allowed (they add nobody); the server rejects only brand-new people
          and the dialog shows the plan copy. */}
      {canInviteStaff && invitesEnabled && (
        <div className="flex flex-col items-end gap-1.5">
          {staffCap?.atLimit && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('staffLimitInviteHint')}
            </p>
          )}
          <InviteStaffDialog
            staff={staffList.map((s) => ({ id: s.id, full_name: s.full_name, email: s.email }))}
          />
        </div>
      )}

    </div>
  )
}
