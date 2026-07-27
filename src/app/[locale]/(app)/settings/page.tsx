import { getTranslations } from 'next-intl/server'
import { getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { listStores, getActiveStoreId } from '@/actions/stores'
import { getEntitlement } from '@/actions/entitlements'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import type { Capability } from '@/lib/auth/permissions'
import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
import { SettingsPageChrome } from '@/components/settings/SettingsPageChrome'

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ tab?: string; target?: string }>
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams])

  const [
    staffList,
    activeStaffId,
    t,
    orgSettings,
    stores,
    initialActiveStoreId,
    caps,
    entitlement,
  ] = await Promise.all([
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
    // Same treatment for the entitlement — the plan row + add-store gate paint
    // with the page instead of popping in after a client fetch.
    getEntitlement().catch(() => null),
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
  // 監査ログ: owner always; a manager only via the explicit audit.view grant.
  const canViewAudit = isOwner || caps.has('audit.view')
  // 予約同期: owner always; a manager only via the explicit sync.view grant —
  // same posture as canViewAudit (PR-M2 fix round: the tab had no filter at
  // all, so every non-owner staff could open it and hit a 403 from the
  // now-gated sync routes).
  const canViewSync = isOwner || caps.has('sync.view')

  // Deep-link support (?tab=audit&target=<customerId> from the privacy tab's
  // アクセス履歴 row). Unknown tab values — and audit links followed by staff
  // without the grant — fall through to the default view, never a blank pane.
  const initialTab: SettingsTabId | null =
    sp.tab === 'audit' && canViewAudit ? 'audit' : null
  const auditTargetId = initialTab === 'audit' && sp.target ? sp.target : null

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
        canViewAudit={canViewAudit}
        canViewSync={canViewSync}
        initialTab={initialTab}
        auditTargetId={auditTargetId}
        initialStores={canViewAllStores ? stores : []}
        initialActiveStoreId={initialActiveStoreId}
        initialEntitlement={entitlement}
      />
    </SettingsPageChrome>
  )
}
