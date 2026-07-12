// The packet-02 probe screen, moved verbatim out of thin/main.tsx when the
// router seed landed (packet 04). Still fixture-fed: the customer-profile
// facade GET exists, but converting this screen to live data is batch 3
// (profile completion) — out of scope here.

import { CustomerProfileView } from '@/components/customers/redesign/profile/CustomerProfileView'
import { profile, sessions, photos } from '../probe/fixture'

export function ProfileProbeScreen() {
  return (
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
  )
}
