// Customer-profile screen in the thin bundle (packet 06 §Build 3, inventory #4).
// Fetches the FULL screen-shaped DTO through the DataPort on mount and renders
// the existing CustomerProfileView subtree AS-IS through the boundary plugin.
// The id comes from the router's param matcher (/customers/[id]) — never client
// state. Mutations in the subtree (photos/memory/packs/consent) route through
// the actions port; they are wired to their facade endpoints in -03d/-03e.

import { CustomerProfileView } from '@/components/customers/redesign/profile/CustomerProfileView'
import {
  CustomerProfileScreenDTO,
  type CustomerProfileScreenDTOType,
} from '@/lib/app-api/customer-profile-screen-dto'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): CustomerProfileScreenDTOType =>
  CustomerProfileScreenDTO.parse(raw)

export function CustomerProfileScreen({ id }: { id: string }) {
  const { state, retry } = useScreenDto(
    `/api/app/v1/customers/${encodeURIComponent(id)}`,
    parse,
  )
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => (
        <CustomerProfileView
          customer={dto.profile}
          sessions={dto.sessions}
          photos={dto.photos}
          customerMemory={dto.customerMemory}
          packs={dto.packs}
          lifecycle={dto.lifecycle}
          hasNextBooking={dto.hasNextBooking}
          ticketsEnabled={dto.ticketsEnabled}
          consentGranted={dto.consentGranted}
          consentGrantedAtLabel={dto.consentGrantedAtLabel}
          assignableStaff={dto.assignableStaff}
        />
      )}
    </ScreenStates>
  )
}
