// src/lib/workspaces/resolve.ts
//
// Pure workspace resolver (frozen Packet 1 contract §5). Consumes ONE
// server-produced authority snapshot + ONE server-normalized client-support
// decision; the only browser-influenced inputs are the two raw
// requested/remembered strings, parsed fail-closed at runtime. Not wired into
// production anywhere in Packet 1.
//
// availability = product entitlement ∩ authority-context compatibility
//              ∩ parsed server grants ∩ client support ∩ parsed rollout
// — normalized, deduped, iterated in canonical order.

import { CANONICAL_WORKSPACE_ORDER, WORKSPACE_COMPATIBILITY } from './manifest';
import {
  PRODUCT_IDS,
  WORKSPACE_IDS,
  type ClientSupportDecision,
  type ProductId,
  type ResolveInput,
  type WorkspaceId,
  type WorkspaceResolution,
} from './types';

const WORKSPACE_ID_SET: ReadonlySet<string> = new Set(WORKSPACE_IDS);
const PRODUCT_ID_SET: ReadonlySet<string> = new Set(PRODUCT_IDS);
// Module-init snapshot for the recognized_web branch — reads the frozen
// manifest copy, never the live tuple, so post-init mutation attempts
// anywhere in the process cannot alter what "all four" means.
const WEB_SUPPORTED_WORKSPACES: ReadonlySet<WorkspaceId> = new Set(CANONICAL_WORKSPACE_ORDER);

/** Closed parser: dedupe, drop unknown tokens fail-closed. */
function parseWorkspaceIds(raw: ReadonlyArray<string>): ReadonlySet<WorkspaceId> {
  const parsed = new Set<WorkspaceId>();
  for (const token of raw) {
    if (WORKSPACE_ID_SET.has(token)) parsed.add(token as WorkspaceId);
  }
  return parsed;
}

/**
 * Closed parser: dedupe, drop unknown tokens fail-closed. A non-empty
 * all-unknown entitlement set parses to ∅ — NO active product.
 */
function parseProductIds(raw: ReadonlyArray<string>): ReadonlySet<ProductId> {
  const parsed = new Set<ProductId>();
  for (const token of raw) {
    if (PRODUCT_ID_SET.has(token)) parsed.add(token as ProductId);
  }
  return parsed;
}

/** Single raw untrusted token (requested/remembered/suggestion) → exact WorkspaceId or null. */
function parseWorkspaceToken(raw: string | undefined): WorkspaceId | null {
  return raw !== undefined && WORKSPACE_ID_SET.has(raw) ? (raw as WorkspaceId) : null;
}

/**
 * Client-supported workspace set. recognized_web = all four (the Business
 * shell). recognized_native = the registry-owned shippedWorkspaceIds,
 * re-parsed fail-closed — with the approved §9.2 clamp: only a KNOWN device
 * class ('phone' | 'tablet') earns the shipped list; 'unknown' — and any
 * off-contract deviceClass value that reaches this JS boundary at runtime —
 * is intersected with {karute_work} regardless of its registry row, so a bad
 * future row cannot silently widen an unclassified device. The clamp
 * restricts, never grants: without karute_work in the shipped row the result
 * is empty. untrusted / unsupported_release — and any unrecognized runtime
 * kind — fail closed to ∅ (no workspace, no business-data preload).
 */
function clientSupportedWorkspaces(decision: ClientSupportDecision): ReadonlySet<WorkspaceId> {
  if (decision.kind === 'recognized_web') {
    return WEB_SUPPORTED_WORKSPACES;
  }
  if (decision.kind === 'recognized_native') {
    const shipped = parseWorkspaceIds(decision.shippedWorkspaceIds);
    if (decision.deviceClass === 'phone' || decision.deviceClass === 'tablet') {
      return shipped;
    }
    const clamped = new Set<WorkspaceId>();
    if (shipped.has('karute_work')) clamped.add('karute_work');
    return clamped;
  }
  return new Set<WorkspaceId>();
}

/** Full availability intersection, iterated in canonical order (deduped by construction). */
function computeAvailability(
  snapshot: ResolveInput['snapshot'],
  clientSupport: ClientSupportDecision,
): ReadonlyArray<WorkspaceId> {
  const products = parseProductIds(snapshot.entitlements);
  const grants = parseWorkspaceIds(snapshot.grantedWorkspaceIds);
  const rollout = parseWorkspaceIds(snapshot.rolloutWorkspaceIds);
  const supported = clientSupportedWorkspaces(clientSupport);

  const available: WorkspaceId[] = [];
  for (const id of CANONICAL_WORKSPACE_ORDER) {
    const compat = WORKSPACE_COMPATIBILITY[id];
    const productOk =
      compat.requiredProduct === 'any_active_product'
        ? products.size > 0
        : products.has(compat.requiredProduct);
    const contextOk = compat.contexts.includes(snapshot.context.kind);
    if (contextOk && productOk && grants.has(id) && rollout.has(id) && supported.has(id)) {
      available.push(id);
    }
  }
  // Frozen: the ReadonlyArray in the result type is honest at runtime — a
  // caller cannot widen an already-resolved result in place.
  return Object.freeze(available);
}

/**
 * Resolve the active workspace for one authority snapshot + client-support
 * decision + raw request/remembered values. Exact precedence (contract §5):
 * direct request (deny on any miss — remembered/suggestion/default are NOT
 * consulted) → remembered → landing suggestion → canonical default →
 * no_workspace.
 */
export function resolveWorkspace(input: ResolveInput): WorkspaceResolution {
  const { snapshot, clientSupport, requestedWorkspace, rememberedWorkspace } = input;

  const availableWorkspaces = computeAvailability(snapshot, clientSupport);

  // Direct request present (ANY string, including empty/garbage): valid AND
  // available resolves; anything else is an explicit denial carrying only the
  // raw value — no active workspace, no fallback, no preload.
  if (requestedWorkspace !== undefined) {
    const requested = parseWorkspaceToken(requestedWorkspace);
    if (requested !== null && availableWorkspaces.includes(requested)) {
      return {
        kind: 'resolved',
        activeWorkspace: requested,
        availableWorkspaces,
        via: 'direct_request',
      };
    }
    return { kind: 'denied', requestedRaw: requestedWorkspace };
  }

  // Remembered value: valid AND available resolves; malformed/removed/
  // unavailable marks it stale (telemetry only) and falls through.
  let staleRemembered: string | null = null;
  if (rememberedWorkspace !== undefined) {
    const remembered = parseWorkspaceToken(rememberedWorkspace);
    if (remembered !== null && availableWorkspaces.includes(remembered)) {
      return {
        kind: 'resolved',
        activeWorkspace: remembered,
        availableWorkspaces,
        via: 'remembered',
      };
    }
    staleRemembered = rememberedWorkspace;
  }

  // Landing suggestion is a non-granting hint: honored only when it survives
  // the full intersection. Otherwise first available in canonical order.
  const suggestion = parseWorkspaceToken(snapshot.landingSuggestion);
  let landed: { readonly workspace: WorkspaceId; readonly via: 'landing_suggestion' | 'canonical_default' } | null = null;
  if (suggestion !== null && availableWorkspaces.includes(suggestion)) {
    landed = { workspace: suggestion, via: 'landing_suggestion' };
  } else if (availableWorkspaces.length > 0) {
    landed = { workspace: availableWorkspaces[0], via: 'canonical_default' };
  }

  if (landed === null) {
    return { kind: 'no_workspace' };
  }
  if (staleRemembered !== null) {
    return {
      kind: 'resolved_stale_fallback',
      activeWorkspace: landed.workspace,
      availableWorkspaces,
      via: landed.via,
      staleRemembered,
    };
  }
  return {
    kind: 'resolved',
    activeWorkspace: landed.workspace,
    availableWorkspaces,
    via: landed.via,
  };
}
