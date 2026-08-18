// Settings screen facade GET (design-parity packet 12 §S1). Mirrors the web
// page's server-side assembly (src/app/[locale]/(app)/settings/page.tsx):
// staff roster + org settings + the capability-driven exposure flags the page
// derives from getMyCapabilities(), threaded onto the Bearer-resolved
// ctx.identity.capabilities instead.
//
// Standing recipe (#565/#566/#570/#571/#572): facadeHandler + ensureCapability
// + the store clamp BEFORE any read + a zod DTO in src/lib/app-api/.
//
// STORES/ENTITLEMENT (design-parity packet 12 §B-3 S2): the 店舗 tab is now
// LIVE. initialStores/initialEntitlement fan out via the listStores/
// loadEntitlement WithClient twins (src/actions/stores.ts,
// src/lib/entitlements.ts) alongside the existing reads — but ONLY for a
// canViewAllStores identity (least-privilege: the tab is hidden without that
// grant, same divergence-from-web rule S1 applied to voice_enrollments).
// listStoresWithClient is called with ensurePrimary: FALSE here (unlike the
// stores GET route / web action) — this screen-wide GET stays write-free so
// every user's settings load never pays the revocation round-trip for a
// write only viewAll identities can even trigger; 'screens.settings' is
// deliberately NOT in REVOCATION_SENSITIVE_ENDPOINTS. A zero-store tenant's
// first paint instead shows StoresSection's own designed seeded-primary
// placeholder for one refresh round-trip (StoresSection.tsx:28) — its mount
// effect's own refresh() calls the (ensurePrimary: true) stores GET route,
// which provisions and replaces the placeholder with the real row. Read
// failures mirror web's OWN tolerance for these two (page.tsx:38,43 —
// `.catch(() => [])` / `.catch(() => null)`): a stores/entitlement hiccup
// must not 502 the whole settings screen. initialActiveStoreId is still real
// — it falls out of the store clamp this route runs regardless, at no extra
// cost.
//
// FAILURE CONTRACT: staff roster / org settings read failures → 502. NOT
// page parity — the web page's getStaffList() catches its own read error and
// degrades to [] (same deliberate facade-family rule as every other
// screens/* route: see the profile route's identical note).

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { SettingsScreenDTO, type SettingsScreenDTOType } from '@/lib/app-api/settings-screen-dto'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { viewerStaffRosterForBusiness } from '@/lib/auth/store-scope'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { listStoresWithClient } from '@/actions/stores'
import { loadEntitlementWithClient } from '@/lib/entitlements'
import { getBusinessAiPersona, resolvePersonaTokens } from '@/lib/karute/business-ai-tokens'

export const runtime = 'nodejs'

/** page.tsx only ever honors ?tab=audit (with the canViewAudit grant) — every
 *  other value falls through to null, same as the web page's own ternary. */
function readRequestedTab(ctx: FacadeContext): 'audit' | null {
  const raw = new URL(ctx.req.url).searchParams.get('tab')
  return raw === 'audit' ? 'audit' : null
}

/** Same shape as every other screens route's locale read (screens/record). */
function readLocale(ctx: FacadeContext): 'ja' | 'en' {
  return new URL(ctx.req.url).searchParams.get('locale') === 'en' ? 'en' : 'ja'
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

  // Independent of any read below — gates the stores/entitlement fan-out.
  const canViewAllStores = ctx.identity.capabilities.has('stores.viewAll')

  try {
    const [staffList, orgSettings, storesResult, entitlementResult] = await Promise.all([
      staffListByBusinessOrThrow(businessId),
      orgSettingsWithClient(synqed),
      // Least-privilege: a non-viewAll identity never triggers the read at
      // all (the tab is hidden for them anyway) — same posture as web's own
      // `canViewAllStores ? stores : []` gate (page.tsx:82), just applied
      // before the fetch instead of after it.
      canViewAllStores
        ? listStoresWithClient(synqed, businessId, { ensurePrimary: false }).catch(() => [])
        : Promise.resolve([]),
      canViewAllStores
        ? loadEntitlementWithClient(synqed, businessId).catch(() => null)
        : Promise.resolve(null),
    ])

    // isOwner mirrors page.tsx's own literal comparison (staffList.some(s =>
    // s.id === activeStaffId && s.display_role === 'owner')) — no
    // .toLowerCase() here; display_role already arrives lowercased out of
    // staffListByBusinessOrThrow, same source both paths share.
    const selfRow = staffList.find((s) => s.id === ctx.identity.authUserId) ?? null
    const isOwner = (selfRow?.display_role ?? '') === 'owner'

    // Web twin of settings/page.tsx's viewerStaffRoster (Liam 8/17): the DTO
    // ships only the clamp's own store(s)' staff + self. selfRow/isOwner above
    // stay on the full roster — this narrows what LEAVES the server, nothing
    // else. Business id from the verified token, never the cookie session.
    const visibleRoster = await viewerStaffRosterForBusiness(
      staffList,
      clamp.allowedStoreIds,
      selfRow?.id ?? null,
      businessId,
    )

    const canManageStaff = ctx.identity.capabilities.has('staff.manage')
    const canInviteStaff = ctx.identity.capabilities.has('staff.invite')
    const canViewAudit = isOwner || ctx.identity.capabilities.has('audit.view')
    const canViewSync = isOwner || ctx.identity.capabilities.has('sync.view')
    // Bare capability, no owner fallback — web parity (settings/page.tsx:76).
    const canManageMenus = ctx.identity.capabilities.has('menus.manage')

    // 予約同期 status card (packet 31) — SOFT-FAIL: a throw or missing config
    // must never 502 the whole settings screen (this is a read-only extra,
    // not load-bearing like staff/org-settings above). Ungranted viewers
    // never trigger the read at all (least-privilege, same posture as the
    // stores/entitlement fan-out above).
    let syncStatus: SettingsScreenDTOType['syncStatus'] = null
    if (canViewSync) {
      try {
        const config = await synqed.sync.getConfig('QUICKRESERVE')
        if (config) {
          syncStatus = {
            enabled: config.enabled,
            lastRunAt: config.last_run_at ?? null,
            lastRunStatus: config.last_run_status ?? null,
            lastRunError: config.last_run_error ?? null,
          }
        }
      } catch {
        syncStatus = null
      }
    }

    // The audit tab requires canViewAudit AND canViewAllStores (same AND the
    // tab-visibility filter uses, settings-visibility.ts) — a store-clamped
    // audit.view grantee isn't offered the tab at all, so a deep-link must
    // fall through too, not land on a blank desktop panel (parity fix, P-3).
    const requestedTab = readRequestedTab(ctx)
    const initialTab =
      requestedTab === 'audit' && canViewAudit && canViewAllStores ? 'audit' : null
    const auditTargetId =
      initialTab === 'audit' ? new URL(ctx.req.url).searchParams.get('target') : null

    // Per-staff scoping (design-parity packet 12 §S4b — un-zeroing S1's
    // placeholder now that スタッフ is live and StaffList/SettingsShell read
    // this field to render the voice chip): staff-owned data rule — a
    // staff.manage identity sees every entry (same floor as the voice
    // routes' owner/manager branch); anyone else sees ONLY their own row
    // (selfRow.id), never a coworker's enrollment state. The write path
    // stays excluded regardless (writeOrgSettingsBlobWithClient never
    // accepts this field, pinned at app-api-org-settings-patch.test.ts:126)
    // — this is a read-scoping change only. org-settings.ts's own reads are
    // untouched — voice.ts still resolves real enrollment data on its paths.
    const voiceEnrollmentsForDto = canManageStaff
      ? (orgSettings?.voice_enrollments ?? {})
      : selfRow && orgSettings?.voice_enrollments?.[selfRow.id]
        ? { [selfRow.id]: orgSettings.voice_enrollments[selfRow.id] }
        : {}
    const orgSettingsForDto = orgSettings
      ? { ...orgSettings, voice_enrollments: voiceEnrollmentsForDto }
      : orgSettings

    return ok(
      ctx,
      SettingsScreenDTO.parse({
        orgSettings: orgSettingsForDto,
        staffList: visibleRoster,
        // Roster-gated (web parity: getCurrentUserStaffId) — the auth id only
        // when its row is present in the staff roster this DTO ships; a
        // removed-but-still-authenticated staffer gets null, same as web.
        activeStaffId: selfRow?.id ?? null,
        isOwner,
        canViewAllStores,
        canManageStaff,
        canInviteStaff,
        canViewAudit,
        canViewSync,
        canManageMenus,
        syncStatus,
        initialTab,
        auditTargetId,
        // Deliberate divergence from web (web: null-default cookie via
        // getActiveStoreId; native: RBAC-clamped assigned[0] default via the
        // store clamp above) — reviewed at S2 stores (packet 12 §B-3 S2) and
        // deliberately left as-is; out of that packet's scope. No behavior
        // change here.
        initialActiveStoreId: clamp.storeId,
        initialStores: storesResult,
        initialEntitlement: entitlementResult,
        // Server-truth flags (design-parity packet 12 §S4a) — this route's
        // own process.env is real (unlike thin's, which is {}); ship the
        // resolved booleans so StaffSection/StaffForm don't have to read the
        // env var directly and silently go dark in the native bundle.
        featureStaffInvites: process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES === 'true',
        featureMultiStore: process.env.NEXT_PUBLIC_FEATURE_MULTI_STORE === 'true',
        // Resolved here, never in the component — see the DTO field's note.
        serviceNoun: resolvePersonaTokens(
          getBusinessAiPersona(orgSettings?.business_type),
          readLocale(ctx),
        ).serviceNoun,
      }),
    )
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'settings screen data unavailable')
  }
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
