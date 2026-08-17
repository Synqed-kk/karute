// Customers-list screen in the thin bundle (packet 04, inventory #2). Fetches
// the screen-shaped DTO through the DataPort and renders the existing
// CustomersListView. READ-ONLY this batch — list-page mutations stay behind
// the loud notWired() actions port.
//
// Search parity note: the web page reruns the search server-side via the
// ?query= URL param; the view's own search box already filters client-side
// over the loaded rows, which this batch relies on. Server-side search rides
// the DTO's ?query= param when a later batch wires the input through.

import { CustomersListView } from '@/components/customers/redesign/list/CustomersListView'
import {
  CustomersScreenDTO,
  type CustomersScreenDTOType,
} from '@/lib/app-api/customers-screen-dto'
import { getThinLocale } from '../locale'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): CustomersScreenDTOType => CustomersScreenDTO.parse(raw)

export function CustomersScreen() {
  const { state, retry } = useScreenDto(
    `/api/app/v1/screens/customers?locale=${getThinLocale()}`,
    parse,
  )
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => (
        <CustomersListView
          rows={dto.rows}
          totalRegistered={dto.totalRegistered}
          query=""
          selfStaffId={dto.selfStaffId}
          bookingDataAvailable={dto.bookingDataAvailable}
          staffList={dto.staffList}
          // dto.staffList (filter pills) is scoped to the active store (fix 1,
          // 2026-08-17). dto.assignableStaff is the SEPARATE business-wide
          // roster the DTO ships for 指名: 指名 stays tenant-wide, pending the
          // owner's ruling on whether it should also scope to store.
          assignableStaff={dto.assignableStaff}
          burnByCustomer={dto.burnByCustomer}
          burnUnpricedIds={dto.burnUnpricedIds}
        />
      )}
    </ScreenStates>
  )
}
