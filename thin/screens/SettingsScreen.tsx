// 設定 (settings) screen in the thin bundle (design-parity packet 12 §S1) —
// retires its 準備中 placeholder. Fetches the screen-shaped DTO through the
// DataPort and renders the REAL SettingsShell — the same leaf component tree
// the web page renders — with organization/theme/ai/recording/packs/coaching/
// 店舗 LIVE and staff/sync/audit routed to SettingsShell's own in-shell
// 準備中 panel via the pendingTabIds prop.
//
// initialStores/initialEntitlement now thread the real DTO fields (packet 12
// §B-3 S2 — the 店舗 tab going live).

import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
import { SettingsScreenDTO, type SettingsScreenDTOType } from '@/lib/app-api/settings-screen-dto'
import { useSearchParams } from '../ports/nav.vite'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): SettingsScreenDTOType => SettingsScreenDTO.parse(raw)

// Tabs not yet ported to the shell this slice — shrinks to empty as later
// design-parity packets land the real 同期 section. 監査ログ moved OUT at
// packet 17 §S3, スタッフ at packet 12 §B-3 S4b — both tabs are now live.
const PENDING_TAB_IDS: readonly SettingsTabId[] = ['sync']

// Exported for the real-render prop-mapping smoke test (same idiom as
// DashboardScreenInner) — this passthrough has its own coverage beyond the
// DTO shape.
export function SettingsScreenInner({ dto }: { dto: SettingsScreenDTOType }) {
  return (
    <SettingsShell
      orgSettings={dto.orgSettings}
      staffList={dto.staffList}
      activeStaffId={dto.activeStaffId}
      locale="ja"
      isOwner={dto.isOwner}
      canViewAllStores={dto.canViewAllStores}
      canManageStaff={dto.canManageStaff}
      canInviteStaff={dto.canInviteStaff}
      canViewAudit={dto.canViewAudit}
      initialTab={dto.initialTab}
      auditTargetId={dto.auditTargetId}
      initialStores={dto.initialStores}
      initialActiveStoreId={dto.initialActiveStoreId}
      initialEntitlement={dto.initialEntitlement}
      pendingTabIds={PENDING_TAB_IDS}
      featureStaffInvites={dto.featureStaffInvites}
      featureMultiStore={dto.featureMultiStore}
    />
  )
}

export function SettingsScreen() {
  // ?tab=/&target= passthrough — the URL stays the single source of truth
  // (web parity: the server reads the same params), same pattern as the
  // appointments screen's date/view/staff passthrough.
  const search = useSearchParams()
  const qs = new URLSearchParams()
  for (const key of ['tab', 'target'] as const) {
    const v = search.get(key)
    if (v) qs.set(key, v)
  }
  const query = qs.toString()
  const { state, retry } = useScreenDto(
    `/api/app/v1/screens/settings${query ? `?${query}` : ''}`,
    parse,
  )
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => <SettingsScreenInner dto={dto} />}
    </ScreenStates>
  )
}
