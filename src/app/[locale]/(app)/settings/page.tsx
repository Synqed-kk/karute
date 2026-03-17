import { getTranslations } from 'next-intl/server'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { SettingsTabs } from '@/components/settings/SettingsTabs'

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      <SettingsTabs
        orgSettings={orgSettings}
        staffList={staffList}
        activeStaffId={activeStaffId}
        locale={locale}
      />
    </div>
  )
}
