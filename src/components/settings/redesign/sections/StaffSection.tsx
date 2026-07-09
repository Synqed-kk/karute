'use client'

import { useTranslations } from 'next-intl'
import { Mic } from 'lucide-react'
import type { StaffMember } from '@/lib/staff'
import type { Entitlement } from '@/lib/entitlements'
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
}

export function StaffSection({
  staffList,
  voiceEnrollments,
  activeStaffId,
  canManageStaff,
  canInviteStaff,
  entitlement,
}: StaffSectionProps) {
  const t = useTranslations('settings')

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
      />

      {/* Invite staff — capability-gated (staff.invite: owner + manager + any
          custom role the owner toggles it onto), behind the staff-invites flag.
          Generates a /join link so a teammate logs into THIS salon instead of
          creating their own. Was owner-only; the UI now matches the server gate
          (createInvite enforces the same capability). The dialog stays
          reachable at the cap — RE-invites to existing staff are always
          allowed (they add nobody); the server rejects only brand-new people
          and the dialog shows the plan copy. */}
      {canInviteStaff && process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES === 'true' && (
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

      <div className="border-t border-border/30 pt-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border/50 bg-card/40 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Mic className="size-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('enrollVoice')}</p>
              <p className="text-xs text-muted-foreground">
                {t('voiceEnrollmentSoon')}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled
            title={t('voiceEnrollmentSoon')}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-50 cursor-not-allowed"
          >
            {t('enrollVoice')}
          </button>
        </div>
      </div>
    </div>
  )
}
