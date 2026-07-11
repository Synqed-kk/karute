import { getTranslations } from 'next-intl/server'
import { getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { listStores, getActiveStoreId } from '@/actions/stores'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import type { Capability } from '@/lib/auth/permissions'
import { SettingsShell } from '@/components/settings/redesign/SettingsShell'
import { SettingsPageChrome } from '@/components/settings/SettingsPageChrome'

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  const [staffList, activeStaffId, t, orgSettings, stores, initialActiveStoreId, caps] =
    await Promise.all([
      getStaffList(),
      getCurrentUserStaffId(),
      getTranslations('settings'),
      getOrgSettings(),
      // Server-fetch the store list (+ active store) so the 店舗 settings section
      // paints complete — no placeholder-then-pop-in when the second store loads.
      // Guarded: a synqed-core hiccup here must NOT 500 the whole settings page —
      // degrade to [] and let StoresSection fall back to its client fetch.
      listStores().catch(() => []),
      getActiveStoreId().catch(() => null),
      getMyCapabilities().catch(() => new Set<Capability>()),
    ])

  const isOwner = staffList.some(
    (s) => s.id === activeStaffId && s.display_role === 'owner',
  )

  // Capability-driven settings exposure (not role names): what a manager/SV can
  // do here is whatever the owner toggled onto them, enforced server-side by the
  // same capabilities. A branch-restricted staff (no stores.viewAll) gets NO
  // store data at all — the 店舗 section leaked the other branch's existence +
  // customer counts to the first real restricted login.
  const canViewAllStores = caps.has('stores.viewAll')
  const canManageStaff = caps.has('staff.manage')
  const canInviteStaff = caps.has('staff.invite')

  return (
    <SettingsPageChrome title={t('title')}>
      <SettingsShell
        orgSettings={orgSettings}
        staffList={staffList}
        activeStaffId={activeStaffId}
        locale={locale}
        isOwner={isOwner}
        canViewAllStores={canViewAllStores}
        canManageStaff={canManageStaff}
        canInviteStaff={canInviteStaff}
        initialStores={canViewAllStores ? stores : []}
        initialActiveStoreId={initialActiveStoreId}
      />
    </SettingsPageChrome>
  )
}
