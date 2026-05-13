import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { SettingsTabs } from '@/components/settings/SettingsTabs'
import { SettingsPageChrome } from '@/components/settings/SettingsPageChrome'

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [staffList, activeStaffId, t, orgSettings] = await Promise.all([
    getStaffList(),
    getActiveStaffId(),
    getTranslations('settings'),
    getOrgSettings(),
  ])

  return (
    <SettingsPageChrome title={t('title')}>
      <SettingsTabs
        orgSettings={orgSettings}
        staffList={staffList}
        activeStaffId={activeStaffId}
        locale={locale}
        authProfileId={user?.id ?? null}
      />
    </SettingsPageChrome>
  )
}
