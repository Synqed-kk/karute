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
//
// 今すぐ同期 (packet 32): onRunNow POSTs the facade run-now trigger directly
// via the DataPort (same idiom RecordScreen's screen-local fetch uses — no
// new client) and, on any 2xx (a real run OR the friendly not-configured
// message — both mean the request landed), calls emitRefresh() so the
// screen re-fetches and the card picks up the new lastRunAt/status.

import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
import { SettingsScreenDTO, type SettingsScreenDTOType } from '@/lib/app-api/settings-screen-dto'
import { getDataPort } from '@/lib/ports/data-port'
import { emitRefresh, useSearchParams } from '../ports/nav.vite'
import { ScreenStates, useScreenDto } from './ScreenBoundary'
import { getThinLocale } from '../locale'

const parse = (raw: unknown): SettingsScreenDTOType => SettingsScreenDTO.parse(raw)

// Tabs not yet ported to the shell this slice — the mechanism stays for
// future tabs even though it's empty now. 監査ログ moved OUT at packet 17
// §S3, スタッフ at packet 12 §B-3 S4b — both tabs are now live.
const PENDING_TAB_IDS: readonly SettingsTabId[] = []

// Tabs that stay permanently web-only (design-parity packet 20 §S5) — 同期
// is La-Estro-specific and structurally unreachable from the Bearer-only
// thin shell (see packet 20 for the full ruling). Distinct from
// PENDING_TAB_IDS: this isn't "not built yet", it's "never coming to app".
// メニュー joins it at the menu-catalog lane PR-2: the catalog is edited on
// the computer (plan §8, fork A) and MenusSection is cut from this bundle.
const WEB_ONLY_TAB_IDS: readonly SettingsTabId[] = ['sync', 'menus']

/** 今すぐ同期 (packet 32). Any 2xx (a real run OR the facade's friendly
 *  not-configured message) reads as "the request landed" — the card's own
 *  onRunNow contract folds both into `ok: true`, differing only in whether
 *  `message` is set. A non-2xx (403/502) surfaces the facade's error message. */
async function runSyncNow(): Promise<{ ok: boolean; message?: string; code?: string }> {
  try {
    const res = await getDataPort().apiFetch('/api/app/v1/sync/run', { method: 'POST' })
    const body = (await res.json().catch(() => null)) as
      | { code?: string; message?: string; error?: { message?: string } }
      | null
    if (!res.ok) {
      return { ok: false, message: body?.error?.message ?? `Request failed (${res.status})` }
    }
    emitRefresh()
    return { ok: true, message: body?.message, code: body?.code }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' }
  }
}

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
        locale={getThinLocale()}
        isOwner={dto.isOwner}
        canViewAllStores={dto.canViewAllStores}
        canManageStaff={dto.canManageStaff}
        canInviteStaff={dto.canInviteStaff}
        canViewAudit={dto.canViewAudit}
        canViewSync={dto.canViewSync}
        // The settings DTO carries no menus.manage flag, so the メニュー tab
        // stays hidden on the phone this slice — honest for fork A (the
        // catalog is edited on the computer; the phone gets the booking
        // picker in PR-4b). The WEB_ONLY_TAB_IDS entry above is what keeps
        // MenusSection out of this bundle either way. Flip to the DTO flag
        // the day the phone should show the "manage on web" signpost.
        canManageMenus={false}
        initialMenus={[]}
        syncStatus={dto.syncStatus}
        onRunNow={runSyncNow}
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
