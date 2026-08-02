// src/lib/workspaces/manifest.ts
//
// Static workspace/product/context compatibility metadata + canonical order.
// ONLY that (frozen Packet 1 contract §3): no platform detection, no
// user-agent/version parsing, no future platform preset, no client-release
// registry. Every workspace additionally requires an explicit server grant —
// that intersection lives in the resolver, never here.
//
// Runtime hardening: TypeScript readonly is erased at runtime, so everything
// here is Object.freeze'd — including the canonical ID tuples imported from
// types.ts (that file is kept byte-identical to the approved contract §1
// block, which is why the freeze calls live here instead). Without this, any
// in-process consumer doing an in-place .sort()/.reverse()/.push() on the
// tuples or the table would silently corrupt authorization metadata
// process-wide.

import { PRODUCT_IDS, WORKSPACE_IDS, type ProductId, type WorkspaceId } from './types';

Object.freeze(WORKSPACE_IDS);
Object.freeze(PRODUCT_IDS);

/**
 * Fixed canonical (least-surprise) fallback order — a frozen copy of the
 * WORKSPACE_IDS tuple (content single-sourced there; the copy means even a
 * consumer holding the tuple reference can never alias-mutate the order the
 * resolver iterates). All resolver set operations iterate this constant —
 * never input order, never JS Set insertion order.
 */
export const CANONICAL_WORKSPACE_ORDER: ReadonlyArray<WorkspaceId> = Object.freeze([
  ...WORKSPACE_IDS,
]);

interface WorkspaceCompatibility {
  /** Specific product entitlement, or any ≥1 active product. */
  readonly requiredProduct: ProductId | 'any_active_product';
  /** Authority contexts this workspace may resolve in. Restricts, never grants. */
  readonly contexts: ReadonlyArray<'organization' | 'store'>;
}

const COMPATIBILITY_TABLE: Record<WorkspaceId, WorkspaceCompatibility> = {
  karute_work: { requiredProduct: 'KARUTE', contexts: ['store'] },
  front_desk: { requiredProduct: 'any_active_product', contexts: ['store'] },
  reserve_operations: { requiredProduct: 'RESERVE', contexts: ['store'] },
  business_admin: { requiredProduct: 'any_active_product', contexts: ['organization', 'store'] },
};
for (const compat of Object.values(COMPATIBILITY_TABLE)) {
  Object.freeze(compat.contexts);
  Object.freeze(compat);
}

/**
 * Frozen contract §3 table (deep-frozen at runtime). karute_work /
 * front_desk / reserve_operations are store-context only; business_admin may
 * resolve in organization OR store context (zero-store onboarding path) when
 * explicitly granted.
 */
export const WORKSPACE_COMPATIBILITY: Readonly<Record<WorkspaceId, WorkspaceCompatibility>> =
  Object.freeze(COMPATIBILITY_TABLE);
