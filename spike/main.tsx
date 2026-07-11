import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import messages from '../messages/ja.json'
import { CustomerProfileView } from '@/components/customers/redesign/profile/CustomerProfileView'
import '../src/app/globals.css'
import { fetchProfileData } from './data'

// Approach B render: the REAL CustomerProfileView client component tree,
// mounted outside Next, fed data client-side. The data layer (./data) attempts
// a live cross-origin fetch and falls back to a representative fixture so the
// UI still renders — the fetch outcome is logged for the CORS/auth findings.
async function main() {
  const { profile, sessions, photos } = await fetchProfileData()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <NextIntlClientProvider locale="ja" messages={messages} timeZone="Asia/Tokyo">
        <CustomerProfileView
          customer={profile}
          sessions={sessions}
          photos={photos}
          customerMemory={undefined}
          packs={[]}
          lifecycle={null}
          hasNextBooking={false}
          ticketsEnabled={true}
          consentGranted={true}
          consentGrantedAtLabel="2026年4月1日"
        />
      </NextIntlClientProvider>
    </StrictMode>,
  )
}

main()
