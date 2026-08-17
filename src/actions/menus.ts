'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import type { Menu } from '@synqed-kk/client'

import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { can } from '@/lib/auth/require-permission'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { audit } from '@/lib/audit'
import { menuSchema, menuIdSchema, menuBandError, type MenuFormInput } from '@/lib/validations/menu'

// Service-menu catalog actions (設定→メニュー). Gated with can() — not
// requireCapability() — because these return the house { error } shape and the
// dialog awaits them WITHOUT a try/catch (same rationale as
// src/actions/appointments.ts's createAppointment).
const DENIED = 'You do not have permission to manage menus.'

const reason = (e: unknown) => (e instanceof Error ? e.message : 'unknown error')

// Menu writes revalidate '/settings' (the catalog surface) AND the 'menus'
// tag — the 予約 picker's 60s cached reader (src/lib/menus/cached.ts) would
// otherwise keep serving the pre-edit catalog for up to a minute (same tab
// immediately; other tabs/devices ride the ~25s QuietRefresh envelope —
// updateTag drops the data cache, not the router cache). Invalidation fires
// only after the core write succeeds, so a refused write never blows the
// cache. updateTag is Server-Action-only; every writer here is 'use server'
// and no facade route imports this module (facade-core-updatetag-ban).

async function menuContext() {
  const [synqed, businessId, actorId] = await Promise.all([
    getSynqedClient(),
    getBusinessId(),
    getCurrentUserStaffId(),
  ])
  return { synqed, businessId, actorId }
}

/** Full validated form → core payload. Cleared NULLABLE fields (category,
 *  price_min_amount, store_id) land as explicit null, never silently reverting
 *  to a core default; an omitted online_visible / display_order stays
 *  undefined, drops out of the request body, and takes core's own default. */
function toPayload(data: MenuFormInput) {
  return {
    name: data.name,
    category: data.category || null,
    duration_minutes: data.duration_minutes,
    price_list_amount: data.price_list_amount,
    price_min_amount: data.price_min_amount ?? null,
    store_id: data.store_id ?? null,
    online_visible: data.online_visible,
    display_order: data.display_order,
  }
}

// Old/new pairs are for non-free-text scalars ONLY. name and category are
// staff free text that can embed a customer's name, so a change to either
// surfaces as a bare *_changed flag and the VALUE never reaches the log drain
// (audit.ts's PII rule, same reason createMenu carries no detail at all).
const TRACKED = ['duration_minutes', 'price_list_amount', 'price_min_amount',
  'store_id', 'online_visible', 'display_order'] as const
const FREE_TEXT = ['name', 'category'] as const

/** Changed fields ONLY — unchanged fields are absent, so a menu edit's row
 *  shows what actually moved. */
function changedDetail(before: Menu, after: Menu): Record<string, string | number | boolean | null> {
  const detail: Record<string, string | number | boolean | null> = {}
  // ?? null throughout: a field core omits arrives as undefined. On the COMPARE
  // it would report an absent-vs-cleared no-op as a change; on the EMIT it would
  // ride out as undefined, get dropped by the audit layer's JSON.stringify, and
  // leave a half pair (_new with no _old) — so both sides normalize.
  for (const key of TRACKED) {
    if ((before[key] ?? null) === (after[key] ?? null)) continue
    detail[`${key}_old`] = before[key] ?? null
    detail[`${key}_new`] = after[key] ?? null
  }
  for (const key of FREE_TEXT) {
    if ((before[key] ?? null) !== (after[key] ?? null)) detail[`${key}_changed`] = true
  }
  return detail
}

/** Actor store-scope clamp (⚖ Liam 2026-08-17: "the store manager can only
 *  edit or touch their own store unless they are given rights to access both
 *  stores"). menus.manage says WHAT you may do; stores.viewAll says WHERE — so
 *  a custom grant of menus.manage alone is held to its own branch. Same
 *  resolution the store-scoped reads use (lib/auth/store-scope) and the same
 *  shape as the setActiveStore clamp (stores.ts:248-259): stores.viewAll ranges
 *  freely, floating staff (empty staff_stores = works in every store, the house
 *  convention) stay unclamped for any REAL store id, everyone else is held to
 *  their assignment. Every shipped preset (owner/manager/senior) carries
 *  stores.viewAll, so their behaviour is unchanged.
 *
 *  A null store_id is the 全店舗 menu — it lands in every branch's picker, so
 *  touching one takes stores.viewAll no matter how the actor is assigned,
 *  floating staff included (their "unclamped" above stops at real store ids).
 *
 *  Returns the refusal message (house { error } convention, :12-15 — never a
 *  throw), or null when every target store passes. Translated only on refusal:
 *  the allowed path pays nothing. */
async function storeScopeError(
  ...targets: (string | null | undefined)[]
): Promise<string | null> {
  const { viewAll, allowedStoreIds, degraded } = await resolveStoreScope()
  if (viewAll) return null
  const allowed = (id: string | null | undefined) =>
    id ? !allowedStoreIds || allowedStoreIds.includes(id) : false
  // A degraded lookup can't tell floating from clamped, so it refuses
  // outright (F-A, fail-closed) — same refusal as a target failing `allowed`.
  if (!degraded && targets.every(allowed)) return null
  const t = await getTranslations('settings.menus')
  return t('storeScopeDenied')
}

/** The whole catalog, retired rows included — the settings surface needs them
 *  for the 停止中 disclosure.
 *
 *  Store-scoped READ (⚖ Liam 2026-08-17): a branch actor sees only their own
 *  stores' menus plus the 全店舗 rows — another branch's catalog is off limits,
 *  not merely uneditable. Same resolution + same fail-closed posture as the
 *  write clamp above: a degraded assignment lookup can't vouch for ANY store,
 *  so it shows the 全店舗 rows only. Floating staff (allowedStoreIds null)
 *  stay unclamped, and stores.viewAll returns byte-identically to before. */
export async function listMenus(): Promise<{ menus: Menu[] } | { error: string }> {
  if (!(await can('menus.manage'))) return { error: DENIED }
  try {
    const { synqed } = await menuContext()
    const { menus } = await synqed.menus.list()
    const { viewAll, allowedStoreIds, degraded } = await resolveStoreScope()
    if (viewAll) return { menus }
    // The picker's twin of this predicate is scopeMenuOptions
    // (src/lib/menus/cached.ts) — deliberately NOT imported here: that module
    // value-imports the ESM-only SDK client, which this 'use server' module
    // (and its suite) keeps out of its graph on purpose.
    const allowed = degraded ? [] : allowedStoreIds
    if (!allowed) return { menus }
    return { menus: menus.filter((m) => m.store_id === null || allowed.includes(m.store_id)) }
  } catch (e) {
    return { error: `Could not load menus: ${reason(e)}` }
  }
}

export async function createMenu(input: MenuFormInput): Promise<{ id: string } | { error: string }> {
  if (!(await can('menus.manage'))) return { error: DENIED }
  const parsed = menuSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(', ') }
  const band = menuBandError(parsed.data)
  if (band) return { error: band }
  try {
    // Actor scope BEFORE any core call — a refused create touches nothing.
    const denied = await storeScopeError(parsed.data.store_id)
    if (denied) return { error: denied }
    const { synqed, businessId, actorId } = await menuContext()
    // Tenant-validate the store before writing, same as setActiveStore
    // (stores.ts:230-246) — the client is business-scoped, so a 404 here means
    // it isn't this tenant's store, "so it can never point at another tenant's
    // store". A throw lands in the catch below as the house { error }.
    if (parsed.data.store_id) await synqed.stores.get(parsed.data.store_id)
    const menu = await synqed.menus.create(toPayload(parsed.data))
    // No detail: ids only (audit.ts's PII rule — log-drain lines stay
    // label-free, and a staff-authored menu name can carry a customer's).
    // settings.store_create is the precedent (stores.ts:333-343).
    audit({
      category: 'settings',
      action: 'settings.menu_create',
      actorId,
      actorType: 'staff',
      businessId,
      targetType: 'menu',
      targetId: menu.id,
      requestId: crypto.randomUUID(),
      source: 'web',
    })
    updateTag('menus')
    revalidatePath('/settings')
    return { id: menu.id }
  } catch (e) {
    return { error: `Could not create menu: ${reason(e)}` }
  }
}

export async function updateMenu(
  id: string,
  input: MenuFormInput,
): Promise<{ ok: true } | { error: string }> {
  if (!(await can('menus.manage'))) return { error: DENIED }
  const parsedId = menuIdSchema.safeParse(id)
  if (!parsedId.success) return { error: parsedId.error.issues.map((i) => i.message).join(', ') }
  const parsed = menuSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(', ') }
  const band = menuBandError(parsed.data)
  if (band) return { error: band }
  try {
    const { synqed, businessId, actorId } = await menuContext()
    const before = await synqed.menus.get(parsedId.data)
    // BOTH ends of the move are in scope or the edit is refused: taking a menu
    // OUT of another branch and dropping one INTO it are equally "touching" it.
    const denied = await storeScopeError(before.store_id, parsed.data.store_id)
    if (denied) return { error: denied }
    // Tenant-validate the store before writing — deliberately the SAME rule as
    // createMenu: every non-null store_id is checked, moved or not, so the two
    // writers can never disagree about which stores this tenant may point at.
    // null is the all-store menu (nothing to resolve).
    if (parsed.data.store_id) await synqed.stores.get(parsed.data.store_id)
    const after = await synqed.menus.update(parsedId.data, toPayload(parsed.data))
    audit({
      category: 'settings',
      action: 'settings.menu_update',
      actorId,
      actorType: 'staff',
      businessId,
      targetType: 'menu',
      targetId: parsedId.data,
      detail: changedDetail(before, after),
      requestId: crypto.randomUUID(),
      source: 'web',
    })
    updateTag('menus')
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return { error: `Could not update menu: ${reason(e)}` }
  }
}

/** 停止 — core has no delete endpoint; retiring IS active:false. */
export async function retireMenu(id: string): Promise<{ ok: true } | { error: string }> {
  if (!(await can('menus.manage'))) return { error: DENIED }
  const parsedId = menuIdSchema.safeParse(id)
  if (!parsedId.success) return { error: parsedId.error.issues.map((i) => i.message).join(', ') }
  try {
    const { synqed, businessId, actorId } = await menuContext()
    // 停止 carries no store in its payload, so the TARGET's store is read first
    // — the scope question is about the menu being touched, not the write body.
    const { store_id } = await synqed.menus.get(parsedId.data)
    const denied = await storeScopeError(store_id)
    if (denied) return { error: denied }
    await synqed.menus.update(parsedId.data, { active: false })
    audit({
      category: 'settings',
      action: 'settings.menu_retire',
      actorId,
      actorType: 'staff',
      businessId,
      targetType: 'menu',
      targetId: parsedId.data,
      requestId: crypto.randomUUID(),
      source: 'web',
    })
    updateTag('menus')
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return { error: `Could not retire menu: ${reason(e)}` }
  }
}

/** 再開 — the exact inverse of retireMenu. */
export async function reactivateMenu(id: string): Promise<{ ok: true } | { error: string }> {
  if (!(await can('menus.manage'))) return { error: DENIED }
  const parsedId = menuIdSchema.safeParse(id)
  if (!parsedId.success) return { error: parsedId.error.issues.map((i) => i.message).join(', ') }
  try {
    const { synqed, businessId, actorId } = await menuContext()
    // Same target-store read as retireMenu — the inverse write, the same clamp.
    const { store_id } = await synqed.menus.get(parsedId.data)
    const denied = await storeScopeError(store_id)
    if (denied) return { error: denied }
    await synqed.menus.update(parsedId.data, { active: true })
    audit({
      category: 'settings',
      action: 'settings.menu_reactivate',
      actorId,
      actorType: 'staff',
      businessId,
      targetType: 'menu',
      targetId: parsedId.data,
      requestId: crypto.randomUUID(),
      source: 'web',
    })
    updateTag('menus')
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return { error: `Could not reactivate menu: ${reason(e)}` }
  }
}
