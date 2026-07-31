/**
 * Packet 1 workspace resolver — table-driven boundary suite pinning the frozen
 * approved contract (SYNQED-BUSINESS-PACKET-1-APPROVED-CONTRACT.md, source SHA
 * 3760e1ef). Covers handoff boundary rows 1–25 + the Council zero-store rows:
 * boundaries, not the power set.
 *
 * Trust guarantees exercised here are runtime + module-surface guarantees, not
 * a type-level proof: restrictive client states (untrusted /
 * unsupported_release) carry no workspace list, and src/lib/workspaces exports
 * no factory that would let a caller mint a ClientSupportDecision or a
 * supported-workspace list. Every future/target client (future iPad, Android
 * remote WebView, …) exists ONLY as an inline fixture in this file.
 */

import {
  PRODUCT_IDS,
  WORKSPACE_IDS,
  type AuthoritySnapshot,
  type ClientSupportDecision,
  type ResolveInput,
} from '@/lib/workspaces/types';
import { CANONICAL_WORKSPACE_ORDER, WORKSPACE_COMPATIBILITY } from '@/lib/workspaces/manifest';
import { resolveWorkspace } from '@/lib/workspaces/resolve';
import * as typesModule from '@/lib/workspaces/types';
import * as manifestModule from '@/lib/workspaces/manifest';
import * as resolveModule from '@/lib/workspaces/resolve';

const ALL_WORKSPACES = ['karute_work', 'front_desk', 'reserve_operations', 'business_admin'] as const;

// ── fixtures ─────────────────────────────────────────────────────────────────

/** Fully-authorized store-context snapshot; rows override single axes. */
function makeSnapshot(overrides: Partial<AuthoritySnapshot> = {}): AuthoritySnapshot {
  return {
    subjectId: 'staff-1',
    businessId: 'biz-1',
    context: { kind: 'store', storeId: 'store-daikanyama' },
    authorityRevision: 'rev-1',
    entitlements: ['KARUTE', 'RESERVE'],
    grantedWorkspaceIds: [...ALL_WORKSPACES],
    rolloutWorkspaceIds: [...ALL_WORKSPACES],
    ...overrides,
  };
}

const web: ClientSupportDecision = { kind: 'recognized_web' };
const untrusted: ClientSupportDecision = { kind: 'untrusted' };
const unsupportedRelease: ClientSupportDecision = { kind: 'unsupported_release' };

type NativeDecision = Extract<ClientSupportDecision, { kind: 'recognized_native' }>;

/** Current-generation native fixture: iOS phone, local thin, karute_work only. */
function nativeClient(overrides: Partial<Omit<NativeDecision, 'kind'>> = {}): ClientSupportDecision {
  return {
    kind: 'recognized_native',
    platform: 'ios',
    deviceClass: 'phone',
    delivery: 'local_thin',
    shippedWorkspaceIds: ['karute_work'],
    ...overrides,
  };
}

// Row 9 / row 24: hypothetical FUTURE iPad release shipping all four
// workspaces. Inline test-local fixture ONLY — the manifest/module-surface
// tests below prove nothing like this is exported from src/lib/workspaces.
const futureIpad: NativeDecision = {
  kind: 'recognized_native',
  platform: 'ios',
  deviceClass: 'tablet',
  delivery: 'local_thin',
  shippedWorkspaceIds: [...ALL_WORKSPACES],
};

function resolve(input: Partial<ResolveInput> = {}) {
  return resolveWorkspace({
    snapshot: makeSnapshot(),
    clientSupport: web,
    ...input,
  });
}

// ── availability axes (rows 1–6, 20) ─────────────────────────────────────────

describe('availability intersection axes', () => {
  it('row 1: Karute entitled + granted + phone-supported + rollout → Karute Work', () => {
    const result = resolve({ clientSupport: nativeClient() });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'karute_work',
      availableWorkspaces: ['karute_work'],
      via: 'canonical_default',
    });
  });

  it('row 2: Reserve-only on the current phone → no workspace, never a Karute fallback', () => {
    const result = resolve({
      snapshot: makeSnapshot({ entitlements: ['RESERVE'] }),
      clientSupport: nativeClient(),
    });
    expect(result).toEqual({ kind: 'no_workspace' });
  });

  it('row 3: missing KARUTE entitlement removes karute_work even when granted + client-listed', () => {
    const result = resolve({ snapshot: makeSnapshot({ entitlements: ['RESERVE'] }) });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'front_desk',
      availableWorkspaces: ['front_desk', 'reserve_operations', 'business_admin'],
      via: 'canonical_default',
    });
  });

  it('row 4: missing RESERVE entitlement removes reserve_operations', () => {
    const result = resolve({ snapshot: makeSnapshot({ entitlements: ['KARUTE'] }) });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'karute_work',
      availableWorkspaces: ['karute_work', 'front_desk', 'business_admin'],
      via: 'canonical_default',
    });
  });

  it('row 5: no active product removes front_desk (and every workspace)', () => {
    const result = resolve({ snapshot: makeSnapshot({ entitlements: [] }) });
    expect(result).toEqual({ kind: 'no_workspace' });
  });

  it('row 6: business_admin without an explicit server grant is removed', () => {
    const result = resolve({
      snapshot: makeSnapshot({
        grantedWorkspaceIds: ['karute_work', 'front_desk', 'reserve_operations'],
      }),
    });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'karute_work',
      availableWorkspaces: ['karute_work', 'front_desk', 'reserve_operations'],
      via: 'canonical_default',
    });
  });

  // Row 20: each axis removed independently removes exactly its workspace,
  // starting from the all-four web baseline.
  it.each([
    [
      'entitlement',
      { snapshot: makeSnapshot({ entitlements: ['KARUTE'] }), clientSupport: web },
      ['karute_work', 'front_desk', 'business_admin'],
    ],
    [
      'server grant',
      {
        snapshot: makeSnapshot({
          grantedWorkspaceIds: ['karute_work', 'reserve_operations', 'business_admin'],
        }),
        clientSupport: web,
      },
      ['karute_work', 'reserve_operations', 'business_admin'],
    ],
    [
      'client support',
      { snapshot: makeSnapshot(), clientSupport: nativeClient() },
      ['karute_work'],
    ],
    [
      'rollout',
      {
        snapshot: makeSnapshot({
          rolloutWorkspaceIds: ['karute_work', 'front_desk', 'reserve_operations'],
        }),
        clientSupport: web,
      },
      ['karute_work', 'front_desk', 'reserve_operations'],
    ],
  ] as const)('row 20: removing %s independently removes the workspace', (_axis, input, expected) => {
    const result = resolveWorkspace(input);
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.availableWorkspaces).toEqual(expected);
    }
  });
});

// ── authority context (Council zero-store rows) ──────────────────────────────

describe('authority context — zero-store organization vs store', () => {
  // Council fixture: active product + explicit business_admin grant + org context.
  const orgAdminSnapshot = makeSnapshot({
    context: { kind: 'organization' },
    entitlements: ['KARUTE'],
  });
  // Full-authority org snapshot: BOTH products entitled, all four granted and
  // rolled out, web client — authority context is the ONLY axis that can
  // exclude a workspace, so every rejection below is context-isolated.
  const orgFullAuthority = makeSnapshot({ context: { kind: 'organization' } });

  it('zero-store organization admin resolves ONLY business_admin', () => {
    const result = resolve({ snapshot: orgAdminSnapshot });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'business_admin',
      availableWorkspaces: ['business_admin'],
      via: 'canonical_default',
    });
  });

  it.each(['karute_work', 'front_desk', 'reserve_operations'] as const)(
    'organization context NEVER resolves %s — even fully entitled, granted, rolled out and directly requested',
    (operational) => {
      const result = resolve({ snapshot: orgFullAuthority, requestedWorkspace: operational });
      expect(result).toEqual({ kind: 'denied', requestedRaw: operational });
    },
  );

  it('store-scoped grants cannot widen to organization authority — context alone excludes all three operational workspaces', () => {
    const result = resolve({ snapshot: orgFullAuthority });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'business_admin',
      availableWorkspaces: ['business_admin'],
      via: 'canonical_default',
    });
  });

  it('selecting a store later = NEW snapshot/revision → operational workspaces appear', () => {
    const before = resolve({ snapshot: orgAdminSnapshot });
    const after = resolve({
      snapshot: makeSnapshot({
        context: { kind: 'store', storeId: 'store-ginza' },
        entitlements: ['KARUTE'],
        authorityRevision: 'rev-2',
      }),
    });
    expect(before).toEqual({
      kind: 'resolved',
      activeWorkspace: 'business_admin',
      availableWorkspaces: ['business_admin'],
      via: 'canonical_default',
    });
    expect(after).toEqual({
      kind: 'resolved',
      activeWorkspace: 'karute_work',
      availableWorkspaces: ['karute_work', 'front_desk', 'business_admin'],
      via: 'canonical_default',
    });
    expect(after).not.toEqual(before);
  });

  it('business_admin also resolves in store context when granted', () => {
    const result = resolve({ requestedWorkspace: 'business_admin' });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'business_admin',
      availableWorkspaces: [...ALL_WORKSPACES],
      via: 'direct_request',
    });
  });
});

// ── role labels / non-inputs (rows 7, 23) ────────────────────────────────────

describe('role labels and raw claims are not inputs', () => {
  it('rows 7+23: junk fields (role label, business type, raw claims) cannot affect the result', () => {
    const base: ResolveInput = { snapshot: makeSnapshot(), clientSupport: web };
    const withJunk = {
      ...base,
      role: 'owner',
      businessType: 'salon',
      viewport: { width: 393 },
      userAgent: 'Mozilla/5.0',
      supportedWorkspaceIds: [...ALL_WORKSPACES],
      snapshot: { ...makeSnapshot(), roleLabel: 'manager', storeClaim: 'store-x' },
    } as unknown as ResolveInput;
    // No role/viewport/user-agent/claim parameter exists on the typed surface;
    // structurally smuggled extras are ignored — byte-identical result.
    expect(resolveWorkspace(withJunk)).toEqual(resolveWorkspace(base));
  });
});

// ── client trust states (rows 8–13) ──────────────────────────────────────────

describe('client-support trust states', () => {
  it('row 8: current local-thin tablet (ships karute_work only) → no Business-shell-only workspaces', () => {
    const result = resolve({
      clientSupport: nativeClient({ deviceClass: 'tablet' }),
    });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'karute_work',
      availableWorkspaces: ['karute_work'],
      via: 'canonical_default',
    });
  });

  it('row 9: future iPad exists ONLY as this inline fixture and passes the full intersection', () => {
    const result = resolve({ clientSupport: futureIpad });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'karute_work',
      availableWorkspaces: [...ALL_WORKSPACES],
      via: 'canonical_default',
    });
  });

  it('row 10: trusted native deviceClass=unknown is clamped to at most karute_work (§9.2 belt)', () => {
    // Bad future registry row shipping all four — the clamp still holds.
    const result = resolve({
      clientSupport: nativeClient({ deviceClass: 'unknown', shippedWorkspaceIds: [...ALL_WORKSPACES] }),
    });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'karute_work',
      availableWorkspaces: ['karute_work'],
      via: 'canonical_default',
    });
  });

  it('row 10: unknown deviceClass without Karute authority → nothing', () => {
    const result = resolve({
      snapshot: makeSnapshot({ entitlements: ['RESERVE'] }),
      clientSupport: nativeClient({ deviceClass: 'unknown', shippedWorkspaceIds: [...ALL_WORKSPACES] }),
    });
    expect(result).toEqual({ kind: 'no_workspace' });
  });

  it('row 10: the clamp restricts, never grants — unknown class without karute_work in the row → nothing', () => {
    const result = resolve({
      clientSupport: nativeClient({ deviceClass: 'unknown', shippedWorkspaceIds: ['front_desk'] }),
    });
    expect(result).toEqual({ kind: 'no_workspace' });
  });

  it('row 11: untrusted client context → no_workspace with zero preload surface', () => {
    const result = resolve({ clientSupport: untrusted });
    expect(result).toEqual({ kind: 'no_workspace' });
    // Branch shape: no activeWorkspace, no availableWorkspaces to preload from.
    expect('activeWorkspace' in result).toBe(false);
    expect('availableWorkspaces' in result).toBe(false);
  });

  it('row 12: recognized-but-unsupported release → no_workspace', () => {
    const result = resolve({ clientSupport: unsupportedRelease });
    expect(result).toEqual({ kind: 'no_workspace' });
  });

  // Row 13: iOS/Android × remote_webview/local_thin each represented. The
  // shipped list VARIES per row (inline test-local fixtures) so the rows
  // prove the registry-owned list — never platform/delivery — drives the
  // outcome: same platform/delivery pairs produce different availability
  // when (and only when) the shipped list differs.
  it.each([
    ['ios', 'remote_webview', ['karute_work'], ['karute_work']],
    ['ios', 'local_thin', ['karute_work', 'front_desk'], ['karute_work', 'front_desk']],
    ['android', 'remote_webview', ['front_desk'], ['front_desk']],
    ['android', 'local_thin', ['karute_work'], ['karute_work']],
  ] as const)(
    'row 13: %s + %s resolves from the registry-owned shipped list %p',
    (platform, delivery, shipped, expectedAvailable) => {
      const result = resolve({
        clientSupport: nativeClient({ platform, delivery, shippedWorkspaceIds: [...shipped] }),
      });
      expect(result.kind).toBe('resolved');
      if (result.kind === 'resolved') {
        expect(result.availableWorkspaces).toEqual([...expectedAvailable]);
        expect(result.activeWorkspace).toBe(expectedAvailable[0]);
        expect(result.via).toBe('canonical_default');
      }
    },
  );

  it('row 10 hardening: an off-contract runtime deviceClass value takes the clamp, never full shipped trust', () => {
    const offContract = {
      kind: 'recognized_native',
      platform: 'ios',
      deviceClass: 'Unknown', // off-contract casing — only 'phone'/'tablet' earn the shipped list
      delivery: 'local_thin',
      shippedWorkspaceIds: [...ALL_WORKSPACES],
    } as unknown as ClientSupportDecision;
    expect(resolve({ clientSupport: offContract })).toEqual({
      kind: 'resolved',
      activeWorkspace: 'karute_work',
      availableWorkspaces: ['karute_work'],
      via: 'canonical_default',
    });
    expect(
      resolve({ snapshot: makeSnapshot({ entitlements: ['RESERVE'] }), clientSupport: offContract }),
    ).toEqual({ kind: 'no_workspace' });
  });
});

// ── precedence (rows 14–19) ──────────────────────────────────────────────────

describe('precedence: direct request → remembered → suggestion → canonical default', () => {
  it('row 14: authorized direct request beats valid remembered + suggestion + default', () => {
    const result = resolve({
      snapshot: makeSnapshot({ landingSuggestion: 'business_admin' }),
      requestedWorkspace: 'reserve_operations',
      rememberedWorkspace: 'front_desk',
    });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'reserve_operations',
      availableWorkspaces: [...ALL_WORKSPACES],
      via: 'direct_request',
    });
  });

  it.each([
    ['unavailable (entitlement removed)', 'reserve_operations', { entitlements: ['KARUTE'] }],
    ['malformed', 'not-a-workspace', {}],
    ['empty string', '', {}],
  ] as const)(
    'row 15: %s direct request → denied even with valid remembered/default; nothing else consulted',
    (_label, requested, snapshotOverrides) => {
      const result = resolve({
        snapshot: makeSnapshot({ ...snapshotOverrides, landingSuggestion: 'karute_work' }),
        requestedWorkspace: requested,
        rememberedWorkspace: 'front_desk',
      });
      expect(result).toEqual({ kind: 'denied', requestedRaw: requested });
      expect('activeWorkspace' in result).toBe(false);
      expect('availableWorkspaces' in result).toBe(false);
    },
  );

  it('row 16: no direct request + valid remembered → remembered (beats suggestion + default)', () => {
    const result = resolve({
      snapshot: makeSnapshot({ landingSuggestion: 'business_admin' }),
      rememberedWorkspace: 'front_desk',
    });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'front_desk',
      availableWorkspaces: [...ALL_WORKSPACES],
      via: 'remembered',
    });
  });

  it.each([
    ['stale (authority removed)', 'reserve_operations', { entitlements: ['KARUTE'] }],
    ['malformed', '###garbage###', {}],
  ] as const)(
    'row 17: %s remembered value → safe still-authorized fallback carrying the raw value',
    (_label, remembered, snapshotOverrides) => {
      const result = resolve({
        snapshot: makeSnapshot(snapshotOverrides),
        rememberedWorkspace: remembered,
      });
      expect(result).toEqual({
        kind: 'resolved_stale_fallback',
        activeWorkspace: 'karute_work',
        availableWorkspaces:
          remembered === '###garbage###'
            ? [...ALL_WORKSPACES]
            : ['karute_work', 'front_desk', 'business_admin'],
        via: 'canonical_default',
        staleRemembered: remembered,
      });
    },
  );

  it('row 17+18: stale remembered falls to a still-authorized landing suggestion first', () => {
    const result = resolve({
      snapshot: makeSnapshot({ entitlements: ['KARUTE'], landingSuggestion: 'business_admin' }),
      rememberedWorkspace: 'reserve_operations',
    });
    expect(result).toEqual({
      kind: 'resolved_stale_fallback',
      activeWorkspace: 'business_admin',
      availableWorkspaces: ['karute_work', 'front_desk', 'business_admin'],
      via: 'landing_suggestion',
      staleRemembered: 'reserve_operations',
    });
  });

  it('row 18: authorized suggestion is used only when no direct/remembered selection exists', () => {
    const result = resolve({ snapshot: makeSnapshot({ landingSuggestion: 'front_desk' }) });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'front_desk',
      availableWorkspaces: [...ALL_WORKSPACES],
      via: 'landing_suggestion',
    });
  });

  it.each([
    [
      'unauthorized (entitlement removed)',
      'reserve_operations',
      { entitlements: ['KARUTE'] },
      ['karute_work', 'front_desk', 'business_admin'],
    ],
    ['malformed', 'future_workspace', {}, [...ALL_WORKSPACES]],
  ] as const)(
    'row 19: %s landingSuggestion cannot grant and falls through to canonical order',
    (_label, suggestion, snapshotOverrides, expectedAvailable) => {
      const result = resolve({
        snapshot: makeSnapshot({ ...snapshotOverrides, landingSuggestion: suggestion }),
      });
      expect(result).toEqual({
        kind: 'resolved',
        activeWorkspace: 'karute_work',
        availableWorkspaces: [...expectedAvailable],
        via: 'canonical_default',
      });
    },
  );
});

// ── robustness (rows 21–22, 25) ──────────────────────────────────────────────

describe('robustness: permutations, unknown tokens, empty intersection', () => {
  it('row 21: reordered + duplicated inputs produce byte-identical canonical results', () => {
    const base = resolveWorkspace({ snapshot: makeSnapshot(), clientSupport: futureIpad });
    const permuted = resolveWorkspace({
      snapshot: makeSnapshot({
        entitlements: ['RESERVE', 'KARUTE', 'RESERVE', 'KARUTE'],
        grantedWorkspaceIds: [
          'business_admin',
          'reserve_operations',
          'karute_work',
          'front_desk',
          'karute_work',
          'business_admin',
        ],
        rolloutWorkspaceIds: [
          'reserve_operations',
          'business_admin',
          'front_desk',
          'karute_work',
          'front_desk',
        ],
      }),
      clientSupport: {
        ...futureIpad,
        shippedWorkspaceIds: [
          'business_admin',
          'karute_work',
          'reserve_operations',
          'front_desk',
          'karute_work',
        ],
      },
    });
    expect(permuted).toEqual(base);
    expect(base.kind).toBe('resolved');
    if (base.kind === 'resolved') {
      expect(base.availableWorkspaces).toEqual([...ALL_WORKSPACES]);
    }
  });

  it('row 22: unknown tokens are dropped fail-closed at every parsed boundary', () => {
    const result = resolve({
      snapshot: makeSnapshot({
        entitlements: ['KARUTE', 'LEGACY_POS', ''],
        grantedWorkspaceIds: [...ALL_WORKSPACES, 'future_workspace', 'admin'],
        rolloutWorkspaceIds: [...ALL_WORKSPACES, 'KARUTE_WORK', ' karute_work'],
      }),
    });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'karute_work',
      availableWorkspaces: ['karute_work', 'front_desk', 'business_admin'],
      via: 'canonical_default',
    });
  });

  it('row 22: near-miss tokens are NOT matched — exact parse only, no trim/case tolerance', () => {
    // karute_work appears ONLY as case/whitespace variants in rollout — it
    // must be dropped; a tolerant (trim/lowercase) parser would wrongly keep
    // it and this row would go red.
    const result = resolve({
      snapshot: makeSnapshot({
        rolloutWorkspaceIds: [
          'KARUTE_WORK',
          ' karute_work',
          'Karute_Work',
          'front_desk',
          'reserve_operations',
          'business_admin',
        ],
      }),
    });
    expect(result).toEqual({
      kind: 'resolved',
      activeWorkspace: 'front_desk',
      availableWorkspaces: ['front_desk', 'reserve_operations', 'business_admin'],
      via: 'canonical_default',
    });
  });

  it('row 22: a non-empty all-unknown entitlement set is NOT an active product', () => {
    const result = resolve({
      snapshot: makeSnapshot({ entitlements: ['LEGACY_POS', 'FUTURE_PRODUCT'] }),
    });
    expect(result).toEqual({ kind: 'no_workspace' });
  });

  it('row 25: empty intersection (rollout empty — restricts, never grants) → no_workspace', () => {
    const result = resolve({ snapshot: makeSnapshot({ rolloutWorkspaceIds: [] }) });
    expect(result).toEqual({ kind: 'no_workspace' });
  });
});

// ── row 24: future client fixtures cannot bypass authority ───────────────────

describe('row 24: a future shipped-client fixture bypasses nothing', () => {
  it('cannot bypass entitlement: future iPad ships all four, KARUTE not entitled → karute_work absent', () => {
    const result = resolve({
      snapshot: makeSnapshot({ entitlements: ['RESERVE'] }),
      clientSupport: futureIpad,
    });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.availableWorkspaces).toEqual(['front_desk', 'reserve_operations', 'business_admin']);
    }
  });

  it('cannot bypass server grant: future iPad ships all four, reserve_operations ungranted → absent', () => {
    const result = resolve({
      snapshot: makeSnapshot({
        grantedWorkspaceIds: ['karute_work', 'front_desk', 'business_admin'],
      }),
      clientSupport: futureIpad,
    });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.availableWorkspaces).toEqual(['karute_work', 'front_desk', 'business_admin']);
    }
  });

  it('cannot bypass rollout: future iPad ships all four, business_admin not rolled out → absent', () => {
    const result = resolve({
      snapshot: makeSnapshot({
        rolloutWorkspaceIds: ['karute_work', 'front_desk', 'reserve_operations'],
      }),
      clientSupport: futureIpad,
    });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.availableWorkspaces).toEqual(['karute_work', 'front_desk', 'reserve_operations']);
    }
  });
});

// ── runtime immutability: TS readonly is erased, the module freezes ──────────

describe('runtime immutability hardening', () => {
  it('canonical tuples, order copy and compatibility table are deep-frozen', () => {
    expect(Object.isFrozen(WORKSPACE_IDS)).toBe(true);
    expect(Object.isFrozen(PRODUCT_IDS)).toBe(true);
    expect(Object.isFrozen(CANONICAL_WORKSPACE_ORDER)).toBe(true);
    expect(Object.isFrozen(WORKSPACE_COMPATIBILITY)).toBe(true);
    for (const id of WORKSPACE_IDS) {
      expect(Object.isFrozen(WORKSPACE_COMPATIBILITY[id])).toBe(true);
      expect(Object.isFrozen(WORKSPACE_COMPATIBILITY[id].contexts)).toBe(true);
    }
  });

  it('mutation attempts on authorization metadata throw instead of corrupting process-wide state', () => {
    expect(() => (WORKSPACE_IDS as unknown as string[]).push('evil_workspace')).toThrow(TypeError);
    expect(() => (WORKSPACE_IDS as unknown as string[]).reverse()).toThrow(TypeError);
    expect(() =>
      (WORKSPACE_COMPATIBILITY.karute_work.contexts as unknown as string[]).push('organization'),
    ).toThrow(TypeError);
    expect(() => {
      (WORKSPACE_COMPATIBILITY.karute_work as unknown as { requiredProduct: string }).requiredProduct =
        'any_active_product';
    }).toThrow(TypeError);
  });

  it('a resolved availableWorkspaces array is frozen — in-place widening is impossible', () => {
    const result = resolve();
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(Object.isFrozen(result.availableWorkspaces)).toBe(true);
      expect(() =>
        (result.availableWorkspaces as unknown as string[]).push('business_admin'),
      ).toThrow(TypeError);
    }
  });
});

// ── module boundary: no factory, no future preset (rows 9, 13, 24) ───────────

describe('module export surface — manifest metadata only, no factory, no future preset', () => {
  const runtimeExports = (mod: object) => Object.keys(mod).filter((k) => k !== '__esModule').sort();

  it('types exports exactly the two closed ID tuples', () => {
    expect(runtimeExports(typesModule)).toEqual(['PRODUCT_IDS', 'WORKSPACE_IDS']);
    expect(WORKSPACE_IDS).toEqual([...ALL_WORKSPACES]);
    expect(PRODUCT_IDS).toEqual(['KARUTE', 'RESERVE']);
  });

  it('manifest exports exactly compatibility metadata + canonical order — no preset/policy/boolean', () => {
    expect(runtimeExports(manifestModule)).toEqual(['CANONICAL_WORKSPACE_ORDER', 'WORKSPACE_COMPATIBILITY']);
    expect(CANONICAL_WORKSPACE_ORDER).toEqual([...ALL_WORKSPACES]);
    expect(Object.keys(WORKSPACE_COMPATIBILITY).sort()).toEqual([...ALL_WORKSPACES].sort());
    // Frozen contract §3 table, verbatim.
    expect(WORKSPACE_COMPATIBILITY).toEqual({
      karute_work: { requiredProduct: 'KARUTE', contexts: ['store'] },
      front_desk: { requiredProduct: 'any_active_product', contexts: ['store'] },
      reserve_operations: { requiredProduct: 'RESERVE', contexts: ['store'] },
      business_admin: { requiredProduct: 'any_active_product', contexts: ['organization', 'store'] },
    });
  });

  it('resolve exports exactly the single resolver function — no ClientSupportDecision factory', () => {
    expect(runtimeExports(resolveModule)).toEqual(['resolveWorkspace']);
    expect(typeof resolveModule.resolveWorkspace).toBe('function');
  });
});
