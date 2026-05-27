import { getOrgSettings } from '@/actions/org-settings'
import { WelcomeWizard } from '@/components/welcome/WelcomeWizard'

export default async function WelcomePage() {
  const settings = await getOrgSettings()
  return (
    <WelcomeWizard
      initialBusinessName={settings?.salon_name ?? ''}
      initialBusinessType={settings?.business_type ?? ''}
      initialDisclosureMode={settings?.recording_disclosure_mode ?? null}
    />
  )
}
