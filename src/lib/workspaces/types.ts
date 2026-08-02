// src/lib/workspaces/types.ts

/** Canonical workspace IDs in fixed canonical (least-surprise fallback) order. */
export const WORKSPACE_IDS = [
  'karute_work',
  'front_desk',
  'reserve_operations',
  'business_admin',
] as const;
export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

export const PRODUCT_IDS = ['KARUTE', 'RESERVE'] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

/**
 * Discriminated authority context (Council round-2 correction).
 * organization: no selected store — zero-store onboarding path.
 * store: exactly one server-validated selected store.
 */
export type AuthorityContext =
  | { readonly kind: 'organization' }
  | { readonly kind: 'store'; readonly storeId: string };

/**
 * One immutable server-produced authority snapshot for ONE authenticated
 * subject + business + context + revision. Entitlements/grants/rollout are
 * string-typed at this boundary and re-parsed fail-closed by the resolver:
 * unknown tokens are dropped; a non-empty all-unknown entitlement set counts
 * as NO active product. Positive inputs never come from browser claims and
 * snapshots from different scopes/revisions must never be mixed.
 */
export interface AuthoritySnapshot {
  readonly subjectId: string;
  readonly businessId: string;
  readonly context: AuthorityContext;
  readonly authorityRevision: string;
  readonly entitlements: ReadonlyArray<string>;          // parsed → ProductId, fail-closed
  readonly grantedWorkspaceIds: ReadonlyArray<string>;   // parsed → WorkspaceId, fail-closed
  readonly rolloutWorkspaceIds: ReadonlyArray<string>;   // restricts, never grants; parsed fail-closed
  readonly landingSuggestion?: string;                   // non-granting hint; parsed fail-closed
}

/**
 * Server-normalized client-support decision (trust-state union). Produced by
 * Packet 3B's trusted adapter + closed release registry — NEVER by the caller.
 * Packet 1 exports no factory for it; target clients exist only as inline
 * test fixtures. Restrictive states carry no workspace list at the type level.
 * Impossible combinations (web+local_thin, native+open_web, native desktop)
 * are unrepresentable.
 */
export type ClientSupportDecision =
  | { readonly kind: 'recognized_web' } // open web = the Business shell: all four workspaces client-supported
  | {
      readonly kind: 'recognized_native';
      readonly platform: 'ios' | 'android';
      readonly deviceClass: 'phone' | 'tablet' | 'unknown';
      readonly delivery: 'remote_webview' | 'local_thin';
      /** Exact workspace IDs whose renderers/routes/data handling shipped in this release — registry-owned. */
      readonly shippedWorkspaceIds: ReadonlyArray<WorkspaceId>;
    }
  | { readonly kind: 'untrusted' }            // missing or untrusted client context
  | { readonly kind: 'unsupported_release' }; // recognized family, release ships no supported surface

export interface ResolveInput {
  readonly snapshot: AuthoritySnapshot;
  readonly clientSupport: ClientSupportDecision;
  readonly requestedWorkspace?: string;  // raw untrusted route/deep-link value
  readonly rememberedWorkspace?: string; // raw untrusted scoped-persistence value
}

/**
 * Discriminated result. Branch shapes make denial vs resolution vs stale
 * fallback vs empty access impossible to confuse: only resolved branches
 * carry activeWorkspace; denied and no_workspace carry none and imply no
 * business-data preload.
 */
export type WorkspaceResolution =
  | {
      readonly kind: 'resolved';
      readonly activeWorkspace: WorkspaceId;
      readonly availableWorkspaces: ReadonlyArray<WorkspaceId>; // canonical order, deduped
      readonly via: 'direct_request' | 'remembered' | 'landing_suggestion' | 'canonical_default';
    }
  | {
      readonly kind: 'resolved_stale_fallback';
      readonly activeWorkspace: WorkspaceId;
      readonly availableWorkspaces: ReadonlyArray<WorkspaceId>;
      readonly via: 'landing_suggestion' | 'canonical_default';
      readonly staleRemembered: string; // the rejected raw value, for telemetry only
    }
  | { readonly kind: 'denied'; readonly requestedRaw: string } // no activeWorkspace, no fallback, no preload
  | { readonly kind: 'no_workspace' };                          // empty intersection, no preload
