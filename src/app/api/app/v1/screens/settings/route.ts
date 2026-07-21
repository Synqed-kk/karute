// Settings screen facade GET (design-parity packet 12 §S1). Mirrors the web
// page's server-side assembly (src/app/[locale]/(app)/settings/page.tsx):
// staff roster + org settings + the capability-driven exposure flags the page
// derives from getMyCapabilities(), threaded onto the Bearer-resolved
// ctx.identity.capabilities instead.
//
// Standing recipe (#565/#566/#570/#571/#572): facadeHandler + ensureCapability
// + the store clamp BEFORE any read + a zod DTO in src/lib/app-api/.
//
// SCOPE NOTE (judgment call, flagged for review): the web page ALSO fans out
// listStores()/getActiveStoreId()/getEntitlement() for StoresSection/
// StaffSection. This slice ships those two tabs PENDING (in-shell 準備中 via
// pendingTabIds) — neither ever reaches a real section this PR — so this
// route does NOT build listStores/getEntitlement WithClient twins; the thin
// screen passes StoresSection's own documented empty-input fallback
// (initialStores=[], initialEntitlement=null) directly, the same "hardcode
// the unused prop" call AppointmentsScreenInner already makes for
// orgSettings. initialActiveStoreId is still real (see below) — it falls out
// of the store clamp this route runs regardless, at no extra cost.
//
// FAILURE CONTRACT: staff roster / org settings read failures → 502. NOT
// page parity — the web page's getStaffList() catches its own read error and
// degrades to [] (same deliberate facade-family rule as every other
// screens/* route: see the profile route's identical note).

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { SettingsScreenDTO } from '@/lib/app-api/settings-screen-dto'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { orgSettingsWithClient } from '@/actions/org-settings'

export const runtime = 'nodejs'

/** page.tsx only ever honors ?tab=audit (with the canViewAudit grant) — every
 *  other value falls through to null, same as the web page's own ternary. */
function readRequestedTab(ctx: FacadeContext): 'audit' | null {
  const raw = new URL(ctx.req.url).searchParams.get('tab')
  return raw === 'audit' ? 'audit' : null
}

export const GET = facadeHandler('screens.settings', async (ctx: FacadeContext) => {
  // Screens-route class gate — same baseline every screens/* GET applies.
  ensureCapability(ctx.identity.capabilities, 'customers.view')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)

  // Store clamp BEFORE any read — store_forbidden must reach the client as
  // 403, outside the 502 catch below. Settings data itself is business-wide
  // (no store-scoped read below), but the clamp's resolved storeId doubles as
  // this DTO's initialActiveStoreId (chrome-switcher semantics — clamp.storeId
  // is the same field chrome's route ships as activeStoreId).
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  try {
    const [staffList, orgSettings] = await Promise.all([
      staffListByBusinessOrThrow(businessId),
      orgSettingsWithClient(synqed),
    ])

    // isOwner mirrors page.tsx's own literal comparison (staffList.some(s =>
    // s.id === activeStaffId && s.display_role === 'owner')) — no
    // .toLowerCase() here; display_role already arrives lowercased out of
    // staffListByBusinessOrThrow, same source both paths share.
    const selfRow = staffList.find((s) => s.id === ctx.identity.authUserId) ?? null
    const isOwner = (selfRow?.display_role ?? '') === 'owner'

    const canViewAllStores = ctx.identity.capabilities.has('stores.viewAll')
    const canManageStaff = ctx.identity.capabilities.has('staff.manage')
    const canInviteStaff = ctx.identity.capabilities.has('staff.invite')
    const canViewAudit = isOwner || ctx.identity.capabilities.has('audit.view')

    const requestedTab = readRequestedTab(ctx)
    const initialTab = requestedTab === 'audit' && canViewAudit ? 'audit' : null
    const auditTargetId =
      initialTab === 'audit' ? new URL(ctx.req.url).searchParams.get('target') : null

    // Least-privilege (S1 fix batch): voice_enrollments always reads back as
    // {} here — no live S1 section reads this field (grep-proven) and the
    // write path already excludes it (writeOrgSettingsBlobWithClient never
    // accepts it, pinned at app-api-org-settings-patch.test.ts:126), so the
    // read path now matches that posture. org-settings.ts's own reads are
    // untouched — voice.ts still resolves real enrollment data on its paths.
    const orgSettingsForDto = orgSettings
      ? { ...orgSettings, voice_enrollments: {} }
      : orgSettings

    return ok(
      ctx,
      SettingsScreenDTO.parse({
        orgSettings: orgSettingsForDto,
        staffList,
        // Roster-gated (web parity: getCurrentUserStaffId) — the auth id only
        // when its row is present in the staff roster this DTO ships; a
        // removed-but-still-authenticated staffer gets null, same as web.
        activeStaffId: selfRow?.id ?? null,
        isOwner,
        canViewAllStores,
        canManageStaff,
        canInviteStaff,
        canViewAudit,
        initialTab,
        auditTargetId,
        // Deliberate divergence from web (web: null-default cookie via
        // getActiveStoreId; native: RBAC-clamped assigned[0] default via the
        // store clamp above) — revisit at S2 stores. No behavior change here.
        initialActiveStoreId: clamp.storeId,
      }),
    )
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'settings screen data unavailable')
  }
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
