import { getTranslations } from 'next-intl/server'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { SettingsShell } from '@/components/settings/redesign/SettingsShell'
import { SettingsPageChrome } from '@/components/settings/SettingsPageChrome'

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  const [staffList, activeStaffId, t, orgSettings] = await Promise.all([
    getStaffList(),
    getActiveStaffId(),
    getTranslations('settings'),
    getOrgSettings(),
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
      />
    </SettingsPageChrome>
  )
}
