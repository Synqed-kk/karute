import { z } from 'zod'

/** Service-menu catalog row (設定→メニュー). Mirrors core's CreateMenuInput
 *  surface the settings editor actually edits — description / currency /
 *  tax_included / nomination_allowed stay on core's defaults until a screen
 *  edits them. */
export const menuSchema = z.object({
  name: z.string().trim().min(1, 'Menu name is required').max(120),
  category: z.string().trim().max(60).optional(),
  duration_minutes: z.number().int().positive('Duration must be more than 0 minutes'),
  price_list_amount: z.number().int().min(0, 'Price cannot be negative'),
  /** Band floor. null = fixed price (the list amount IS the price). */
  price_min_amount: z.number().int().min(0, 'Minimum price cannot be negative').nullable().optional(),
  /** null = every store (business-wide menu). */
  store_id: z.string().uuid().nullable().optional(),
  online_visible: z.boolean().optional(),
  display_order: z.number().int().min(0).optional(),
})
export type MenuFormInput = z.infer<typeof menuSchema>

/** PURE band check, mirroring core's own rule — no server imports, so the
 *  PR-3 dialog can call it for live feedback on the same rule the action
 *  enforces. Returns the first violation's message, or null when the band is
 *  legal. (Lives in src/lib, never src/actions: the thin build aliases ALL of
 *  src/actions/** to the ports module.) */
export function menuBandError(input: {
  duration_minutes: number
  price_list_amount: number
  price_min_amount?: number | null
}): string | null {
  // Non-finite guards first: a cleared numeric field reaches the PR-3 dialog as
  // NaN, and NaN fails every comparison below — so without these it would slip
  // through as "no error". Each reuses its own field's message.
  if (!Number.isFinite(input.duration_minutes) || input.duration_minutes <= 0)
    return 'Duration must be more than 0 minutes'
  if (!Number.isFinite(input.price_list_amount) || input.price_list_amount < 0)
    return 'Price cannot be negative'
  const floor = input.price_min_amount
  if (floor == null) return null
  if (!Number.isFinite(floor) || floor < 0) return 'Minimum price cannot be negative'
  if (floor > input.price_list_amount) return 'Minimum price cannot be above the list price'
  return null
}
