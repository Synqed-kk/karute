// Sessions-list (カルテ tab) screen in the thin bundle (packet 05, inventory #3).
// Fetches the screen-shaped DTO through the DataPort and renders the existing
// KaruteRecordListView subtree AS-IS through the boundary plugin. READ-ONLY this
// batch — the New カルテ dialog's create (createManualKaruteRecord) and every
// other mutation stay behind the loud notWired() actions port.
//
// Nav parity note: KaruteRecordListView keeps its own client-side filters +
// in-memory pagination + URL-backed list state (via the nav port's
// usePathname/useRouter/useSearchParams); the DTO ships ALL records exactly
// like the web page, so the view filters over the full set.

import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import {
  SessionsScreenDTO,
  type SessionsScreenDTOType,
} from '@/lib/app-api/sessions-screen-dto'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): SessionsScreenDTOType => SessionsScreenDTO.parse(raw)

export function SessionsScreen() {
  const { state, retry } = useScreenDto('/api/app/v1/screens/sessions', parse)
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => (
        <KaruteRecordListView
          items={dto.items}
          monthCount={dto.monthCount}
          staffList={dto.staffList}
          currentStaffId={dto.currentStaffId}
          customerOptions={dto.customerOptions}
        />
      )}
    </ScreenStates>
  )
}
