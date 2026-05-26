// ─────────────────────────────────────────────────────────────
// Store types — shared by the stores section + dialogs
// ─────────────────────────────────────────────────────────────
// ANTHONY: when the `stores` table lands, hydrate this from a
// per-business query:
//
//   select id, business_id, name, address, phone, is_primary,
//          active,
//          (select count(*) from profiles where store_id = s.id)
//            as staff_count,
//          (select count(*) from customers where store_id = s.id)
//            as customer_count,
//          created_at
//   from stores s
//   where business_id = $1
//   order by is_primary desc, created_at asc
//
// RLS:
//   - owners read every row scoped to their business_id
//   - staff read only the store they're attached to (profiles.store_id)
//   - mutations (insert/update) owner-only
//
// Schema sketch matches the StoresSection.tsx TODO this lift
// replaces.

export interface Store {
  id: string
  name: string
  address: string
  phone?: string
  /** Number of staff attached to this store. */
  staffCount: number
  /** Number of customers attached to this store. */
  customerCount: number
  /** False when the owner has temporarily disabled this location. */
  active: boolean
  /** True for the "本店" (main) store — the first one created on
   *  the account. Only one row per business has this true. */
  isPrimary: boolean
}

export interface StoreFormValues {
  name: string
  address: string
  phone: string
}
