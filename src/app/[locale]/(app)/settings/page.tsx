import { getTranslations, getMessages } from 'next-intl/server'
import { NextIntlClientProvider } from 'next-intl'
import { PAGE_PICKS, pickMessages } from '@/i18n/client-messages'
import { getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { listStores, getActiveStoreId } from '@/actions/stores'
import { listMenus } from '@/actions/menus'
import { getEntitlement } from '@/actions/entitlements'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { resolveStoreScope, menuStoresForScope, viewerStaffRoster } from '@/lib/auth/store-scope'
import { getBusinessAiPersona, resolvePersonaTokens } from '@/lib/karute/business-ai-tokens'
import type { Capability } from '@/lib/auth/permissions'
import { SettingsShell, type SettingsTabId } from '@/components/settings/redesign/SettingsShell'
import { SettingsPageChrome } from '@/components/settings/SettingsPageChrome'

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ tab?: string; target?: string }>
}) {
  const [{ locale }, sp] = await Promise.all([params, searchParams])

  const [
    staffList,
    activeStaffId,
    t,
    orgSettings,
    stores,
    initialActiveStoreId,
    caps,
    entitlement,
    menusResult,
    storeScope,
  ] = await Promise.all([
    getStaffList(),
    getCurrentUserStaffId(),
    getTranslations('settings'),
    getOrgSettings(),
    // Server-fetch the store list (+ active store) so the 店舗 settings section
    // paints complete — no placeholder-then-pop-in when the second store loads.
    // Guarded: a synqed-core hiccup here must NOT 500 the whole settings page —
    // degrade to [] and let StoresSection fall back to its client fetch.
    listStores().catch(() => []),
    getActiveStoreId().catch(() => null),
    getMyCapabilities().catch(() => new Set<Capability>()),
    // Same treatment for the entitlement — the plan row + add-store gate paint
    // with the page instead of popping in after a client fetch.
    getEntitlement().catch(() => null),
    // Same degrade-never-500 posture for the service-menu catalog. The
    // { error } shape is what listMenus already returns on a denied read, so
    // a thrown failure folds into the same branch below.
    listMenus().catch(() => ({ error: 'unavailable' as const })),
    // The actor's own write scope — already resolved (and React-cached) by the
    // (app) layout, so this costs nothing. Same degrade-never-500 posture.
    resolveStoreScope().catch(() => null),
  ])

  const isOwner = staffList.some(
    (s) => s.id === activeStaffId && s.display_role === 'owner',
  )

  // スタッフ roster, store-scoped (Liam 8/17): a clamped staff.manage holder
  // only ever receives their own store(s)' staff + themselves. Scoped HERE,
  // not in the shell — the other branch's names/emails must not reach the
  // client at all. visibleStaffRoster's self-only rule still runs on top.
  //
  // ⚖ Liam 8/18: an UNVOUCHED scope ships an EMPTY roster here — the same
  // blind posture menuStoresForScope already takes below, and for the same
  // reason: fail closed rather than hand a viewer every branch's names off a
  // lookup we could not read. BOTH shapes count, because they are the same
  // glitch: `degraded` (the staff_stores read failed inside resolveStoreScope)
  // and `null` (resolveStoreScope itself threw — caught above). Without the
  // null arm, viewerStaffRoster's own catch would quietly hand back the full
  // roster on the sibling failure. Deliberately SURFACE level: the app-shell
  // switch drawer (layout.tsx) keeps its full-roster fallback, because profile
  // switching on a shared device must survive a glitch. That asymmetry is the
  // ruling, not an oversight.
  const visibleRoster =
    !storeScope || storeScope.degraded
      ? []
      : await viewerStaffRoster(staffList, activeStaffId)

  // Capability-driven settings exposure (not role names): what a manager/SV can
  // do here is whatever the owner toggled onto them, enforced server-side by the
  // same capabilities. A branch-restricted staff (no stores.viewAll) gets NO
  // store data at all — the 店舗 section leaked the other branch's existence +
  // customer counts to the first real restricted login.
  const canViewAllStores = caps.has('stores.viewAll')
  const canManageStaff = caps.has('staff.manage')
  const canInviteStaff = caps.has('staff.invite')
  // 監査ログ: owner always; a manager only via the explicit audit.view grant.
  const canViewAudit = isOwner || caps.has('audit.view')
  // 予約同期: owner always; a manager only via the explicit sync.view grant —
  // same posture as canViewAudit (PR-M2 fix round: the tab had no filter at
  // all, so every non-owner staff could open it and hit a 403 from the
  // now-gated sync routes).
  const canViewSync = isOwner || caps.has('sync.view')
  // メニュー: the bare capability (like stores.viewAll above, not the
  // owner-plus-grant idiom) — owner/manager/senior all hold menus.manage
  // through their preset, and listMenus enforces the same capability.
  const canManageMenus = caps.has('menus.manage')
  // null = the read FAILED (or was denied); [] would claim an empty catalog.
  const initialMenus = 'menus' in menusResult ? menusResult.menus : null
  // メニュー store pills + editable rows follow the ACTOR's write scope (⚖ Liam
  // 2026-08-17). src/actions/menus.ts is the enforcement; this only stops the
  // UI offering a store the server would refuse — and stops offering ONLY
  // 全店舗 to a branch manager, the one scope they cannot use. Deliberately NOT
  // initialStores: that prop also feeds 店舗/自動録音/スタッフ, where a
  // branch-restricted staff must keep seeing nothing (the leak fixed at
  // :61-63). allowedStoreIds null = viewAll or floating staff — unclamped,
  // exactly like the server. Scope unresolved → today's behaviour (only the
  // null case now — a degraded lookup is handled below).
  // A degraded lookup (the staff_stores assignment fetch itself failed) is
  // blind, not unclamped: the server write clamp already fails closed on it
  // (storeScopeError, src/actions/menus.ts), so the UI must offer nothing
  // rather than every branch's name behind a doomed edit control (Greptile
  // P1 on #707).
  const menuStores = menuStoresForScope(storeScope, canViewAllStores, stores)

  // Deep-link support (?tab=audit&target=<customerId> from the privacy tab's
  // アクセス履歴 row). Unknown tab values — and audit links followed by staff
  // without the grant — fall through to the default view, never a blank pane.
  // The audit tab itself requires canViewAudit AND canViewAllStores (same AND
  // the tab-visibility filter uses, settings-visibility.ts) — a store-clamped
  // audit.view grantee isn't offered the tab at all, so deep-linking it must
  // fall through too, not land on a blank desktop panel (parity fix, P-3).
  const initialTab: SettingsTabId | null =
    sp.tab === 'audit' && canViewAudit && canViewAllStores ? 'audit' : null
  const auditTargetId = initialTab === 'audit' && sp.target ? sp.target : null

  return (
    // The layout provider ships only settings.stores — the full settings
    // dictionary (and this subtree's other namespaces) ride this pick.
    <NextIntlClientProvider
      messages={pickMessages(await getMessages(), PAGE_PICKS.settings)}
    >
    <SettingsPageChrome title={t('title')}>
      <SettingsShell
        orgSettings={orgSettings}
        staffList={visibleRoster}
        activeStaffId={activeStaffId}
        locale={locale}
        isOwner={isOwner}
        canViewAllStores={canViewAllStores}
        canManageStaff={canManageStaff}
        canInviteStaff={canInviteStaff}
        canViewAudit={canViewAudit}
        canViewSync={canViewSync}
        canManageMenus={canManageMenus}
        initialTab={initialTab}
        auditTargetId={auditTargetId}
        initialStores={canViewAllStores ? stores : []}
        menuStores={menuStores}
        initialActiveStoreId={initialActiveStoreId}
        initialMenus={canManageMenus ? initialMenus : []}
        initialEntitlement={entitlement}
        // The business type's own visit noun (spec §8.8 fix C9) — resolved
        // server-side so the ~260 KB persona module never reaches the client;
        // the facade twin resolves the same field into its DTO.
        serviceNoun={
          resolvePersonaTokens(getBusinessAiPersona(orgSettings?.business_type), locale)
            .serviceNoun
        }
      />
    </SettingsPageChrome>
    </NextIntlClientProvider>
  )
}
