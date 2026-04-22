import 'server-only'
import { getSynqedClient } from './client'
import { SynqedError } from '@synqed/client'

export interface NameRef {
  id: string
  name: string | null
}

/**
 * Fetch a map of id → {id, name} for a set of customer IDs via synqed-core.
 * Missing IDs (404 / deleted / not-yet-synced) resolve to {id, name: null}
 * so callers can fall back gracefully instead of throwing.
 */
export async function batchCustomerNames(
  tenantId: string,
  ids: string[],
): Promise<Map<string, NameRef>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const client = getSynqedClient(tenantId)
  const out = new Map<string, NameRef>()

  // synqed-core doesn't yet have a bulk-get endpoint — issue parallel GETs.
  // At ~5 customers per page this is cheap; we can optimize with a bulk
  // endpoint later if N climbs.
  await Promise.all(
    unique.map(async (id) => {
      try {
        const c = await client.customers.get(id)
        out.set(id, { id, name: c.name })
      } catch (err) {
        if (err instanceof SynqedError && err.status === 404) {
          out.set(id, { id, name: null })
        } else {
          // For unexpected errors, also fall back to null so one bad id
          // doesn't tank the whole response.
          out.set(id, { id, name: null })
        }
      }
    }),
  )

  return out
}

export async function batchStaffNames(
  tenantId: string,
  ids: string[],
): Promise<Map<string, NameRef>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const client = getSynqedClient(tenantId)
  const out = new Map<string, NameRef>()

  await Promise.all(
    unique.map(async (id) => {
      try {
        const s = await client.staff.get(id)
        out.set(id, { id, name: s.name })
      } catch (err) {
        if (err instanceof SynqedError && err.status === 404) {
          out.set(id, { id, name: null })
        } else {
          out.set(id, { id, name: null })
        }
      }
    }),
  )

  return out
}
