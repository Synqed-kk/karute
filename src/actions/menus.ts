'use server'

import { revalidatePath } from 'next/cache'
import type { Menu } from '@synqed-kk/client'

import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { can } from '@/lib/auth/require-permission'
import { audit } from '@/lib/audit'
import { menuSchema, menuBandError, type MenuFormInput } from '@/lib/validations/menu'

// Service-menu catalog actions (設定→メニュー). Gated with can() — not
// requireCapability() — because these return the house { error } shape and the
// dialog awaits them WITHOUT a try/catch (same rationale as
// src/actions/appointments.ts's createAppointment).
const DENIED = 'You do not have permission to manage menus.'

const reason = (e: unknown) => (e instanceof Error ? e.message : 'unknown error')

// Menu writes revalidate '/settings' ONLY — no menus cache tag exists yet;
// PR-4a builds the cached picker reader and owns its tag invalidation.

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

/** The whole catalog, retired rows included — the settings surface needs them
 *  for the 停止中 disclosure. */
export async function listMenus(): Promise<{ menus: Menu[] } | { error: string }> {
  if (!(await can('menus.manage'))) return { error: DENIED }
  try {
    const { synqed } = await menuContext()
    const { menus } = await synqed.menus.list()
    return { menus }
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
    revalidatePath('/settings')
    return { id: menu.id }
  } catch (e) {
    return { error: `Could not create menu: ${reason(e)}` }
  }
}
