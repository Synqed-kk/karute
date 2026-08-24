// Customers-list screen in the thin bundle (packet 04, inventory #2). Fetches
// the screen-shaped DTO through the DataPort and renders the existing
// CustomersListView. READ-ONLY this batch — list-page mutations stay behind
// the loud notWired() actions port.
//
// Search parity note: the web page reruns the search server-side via the
// ?query= URL param — the view's own search box has no client-side filter of
// its own, it only writes ?query= (debounced) and relies on the server
// re-rendering with `search` applied. URL = single source of truth (web
// parity, same AppointmentsScreen L112-122 pattern): read the param via the
// thin useSearchParams port, put it on the fetch path; useScreenDto re-fetches
// on path change.

import { CustomersListView } from '@/components/customers/redesign/list/CustomersListView'
import {
  CustomersScreenDTO,
  type CustomersScreenDTOType,
} from '@/lib/app-api/customers-screen-dto'
import { getThinLocale } from '../locale'
import { useSearchParams } from '../ports/nav.vite'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): CustomersScreenDTOType => CustomersScreenDTO.parse(raw)

export function CustomersScreen() {
  const search = useSearchParams()
  // Clamp to the facade's QuerySchema max(200) — an overlong deep-link query must not 400 into the error frame.
  const query = (search.get('query')?.trim() ?? '').slice(0, 200)
  const qs = new URLSearchParams()
  if (query) qs.set('query', query)
  qs.set('locale', getThinLocale())
  const { state, retry } = useScreenDto(
    `/api/app/v1/screens/customers?${qs.toString()}`,
    parse,
  )
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => (
        <CustomersListView
          rows={dto.rows}
          totalRegistered={dto.totalRegistered}
          query={query}
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
