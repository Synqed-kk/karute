import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { getOrgSettings } from '@/actions/org-settings'
import { WelcomeWizard } from '@/components/welcome/WelcomeWizard'
import { PAGE_PICKS, pickMessages } from '@/i18n/client-messages'

export default async function WelcomePage() {
  const [settings, allMessages] = await Promise.all([
    getOrgSettings(),
    getMessages(),
  ])
  return (
    <NextIntlClientProvider
      messages={pickMessages(allMessages, PAGE_PICKS.welcome)}
    >
      <WelcomeWizard
        initialBusinessName={settings?.salon_name ?? ''}
        initialBusinessType={settings?.business_type ?? ''}
        initialDisclosureMode={settings?.recording_disclosure_mode ?? null}
      />
    </NextIntlClientProvider>
  )
}
