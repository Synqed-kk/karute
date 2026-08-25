// Sessions-list (カルテ tab) screen in the thin bundle (packet 05, inventory #3).
// Fetches the screen-shaped DTO through the DataPort and renders the existing
// KaruteRecordListView subtree AS-IS through the boundary plugin. READ-ONLY this
// batch — the New カルテ dialog's create (createManualKaruteRecord) and every
// other mutation stay behind the loud notWired() actions port.
//
// Nav parity note: KaruteRecordListView keeps its own client-side filters +
// URL-backed list state (via the nav port's usePathname/useRouter/
// useSearchParams). PR-2a retired the in-memory pager: the DTO now ships the
// first DATE WINDOW plus its boundary, exactly like the web page, and さらに表示
// walks further back through the facade — so the view filters over whatever the
// walk has accumulated, not over a preloaded full set.

import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import {
  SessionsScreenWindowedDTO,
  type SessionsScreenWindowedDTOType,
} from '@/lib/app-api/sessions-screen-dto'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): SessionsScreenWindowedDTOType =>
  SessionsScreenWindowedDTO.parse(raw)

export function SessionsScreen() {
  // ?window=1 (PR-2a 日付チャンク読み込み): THIS bundle opts in to the windowed
  // read. Release-17 bundles in the field keep sending the bare call and keep
  // getting the legacy shape, byte-identical — the param is the whole version
  // negotiation (see the route's header comment).
  const { state, retry } = useScreenDto('/api/app/v1/screens/sessions?window=1', parse)
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => (
        <KaruteRecordListView
          items={dto.items}
          monthCount={dto.monthCount}
          total={dto.total}
          initialWindowStart={dto.windowStart}
          initialHasMore={dto.hasMore}
          staffList={dto.staffList}
          currentStaffId={dto.currentStaffId}
          customerOptions={dto.customerOptions}
        />
      )}
    </ScreenStates>
  )
}
