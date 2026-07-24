// 設定 (settings) screen in the thin bundle (design-parity packet 12 §S1) —
// retires its 準備中 placeholder. Fetches the screen-shaped DTO through the
// DataPort and renders the REAL SettingsShell — the same leaf component tree
// the web page renders — with organization/theme/ai/recording/packs/coaching/
// 店舗/staff LIVE. 同期 credentials/controls stay permanently web-only
// (webOnlyTabIds, packet 20 §S5); a sync.view/owner grant now renders the
// read-only SyncStatusCard instead (syncStatus prop, packet 31) — the
// web-only panel is the fallback when the grant/config is absent (null).
//
// initialStores/initialEntitlement now thread the real DTO fields (packet 12
// §B-3 S2 — the 店舗 tab going live).

import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
import { SettingsScreenDTO, type SettingsScreenDTOType } from '@/lib/app-api/settings-screen-dto'
import { useSearchParams } from '../ports/nav.vite'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): SettingsScreenDTOType => SettingsScreenDTO.parse(raw)

// Tabs not yet ported to the shell this slice — the mechanism stays for
// future tabs even though it's empty now. 監査ログ moved OUT at packet 17
// §S3, スタッフ at packet 12 §B-3 S4b — both tabs are now live.
const PENDING_TAB_IDS: readonly SettingsTabId[] = []

// Tabs that stay permanently web-only (design-parity packet 20 §S5) — 同期
// is La-Estro-specific and structurally unreachable from the Bearer-only
// thin shell (see packet 20 for the full ruling). Distinct from
// PENDING_TAB_IDS: this isn't "not built yet", it's "never coming to app".
const WEB_ONLY_TAB_IDS: readonly SettingsTabId[] = ['sync']

// Exported for the real-render prop-mapping smoke test (same idiom as
// DashboardScreenInner) — this passthrough has its own coverage beyond the
// DTO shape.
export function SettingsScreenInner({ dto }: { dto: SettingsScreenDTOType }) {
  // SettingsShell carries NO horizontal padding of its own — on web the
  // parent SettingsPageChrome provides the page frame (mx-auto max-w-5xl
  // space-y-6 p-4 md:p-6, src/components/settings/SettingsPageChrome.tsx).
  // Mounting the shell bare shipped the binary's settings edge-to-edge
  // (Liam field report 7/24: "zoomed in, touching the corners"). Same
  // container geometry, minus PageHeader: the app's top bar already titles
  // the page 設定 — a second h1 would double it (profile precedent:
  // PageView owns its container, no duplicated page title).
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
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
        syncStatus={dto.syncStatus}
        initialTab={dto.initialTab}
        auditTargetId={dto.auditTargetId}
        initialStores={dto.initialStores}
        initialActiveStoreId={dto.initialActiveStoreId}
        initialEntitlement={dto.initialEntitlement}
        pendingTabIds={PENDING_TAB_IDS}
        webOnlyTabIds={WEB_ONLY_TAB_IDS}
        featureStaffInvites={dto.featureStaffInvites}
        featureMultiStore={dto.featureMultiStore}
      />
    </div>
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
