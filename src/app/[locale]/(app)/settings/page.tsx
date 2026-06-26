import { getTranslations } from 'next-intl/server'
import { getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { listStores, getActiveStoreId } from '@/actions/stores'
import { SettingsShell } from '@/components/settings/redesign/SettingsShell'
import { SettingsPageChrome } from '@/components/settings/SettingsPageChrome'

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  const [staffList, activeStaffId, t, orgSettings, initialStores, initialActiveStoreId] =
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
      getActiveStoreId(),
    ])

  const isOwner = staffList.some(
    (s) => s.id === activeStaffId && s.display_role === 'owner',
  )

  return (
    <SettingsPageChrome title={t('title')}>
      <SettingsShell
        orgSettings={orgSettings}
        staffList={staffList}
        activeStaffId={activeStaffId}
        locale={locale}
        isOwner={isOwner}
        initialStores={initialStores}
        initialActiveStoreId={initialActiveStoreId}
      />
    </SettingsPageChrome>
  )
}
