'use client'

// ─────────────────────────────────────────────────────────────
// useIsWide — the `md` branch measurement behind SettingsShell's
// single-mount render. Lives here (not inline in the shell) so the
// breakpoint constant has one home and the tie-to-Tailwind test can
// import it instead of re-spelling the literal.
// ─────────────────────────────────────────────────────────────
// NOT the hook for BookingActionSheetWrapper / StaffDrillDownModal: those two
// ask `(max-width: 767px)`, whose boundary semantics differ from this one at
// exactly 768px (a px max-width also drifts from Tailwind's rem-based md at any
// root font size other than 16). Migrating them here would silently move that
// boundary, so they stay on their own queries; converting them is separate
// work with its own before/after proof.
import { useEffect, useState } from 'react'

/** The `md` breakpoint, spelled ONCE. Tailwind v4's default (src/app/globals.css
 *  declares no `--breakpoint-md` override), and kept in rem — not the 768px it
 *  resolves to at a 16px root — so this tracks Tailwind's own
 *  `@media (width >= 48rem)` exactly, at any root font size.
 *
 *  A future `--breakpoint-md` override would move the CSS `md` without moving
 *  this query, and settings would render BLANK on the widths between them (the
 *  hook keeps one branch, the classes hide it). Pinned against Tailwind's own
 *  resolved value by "MD_QUERY tracks Tailwind's resolved --breakpoint-md" in
 *  src/__tests__/integration/settings-shell-single-mount.test.tsx — that test
 *  goes red instead. */
export const MD_QUERY = '(min-width: 48rem)'

export interface IsWideState {
  /** null = NOT MEASURED: SSR and the first client render. */
  wide: boolean | null
  /** true once a `change` event has fired, i.e. the viewport has crossed `md`
   *  at least once in this component's lifetime. Latches — never goes back. */
  crossed: boolean
}

/** Measures the `md` breakpoint so a caller can mount only the branch that is
 *  actually visible, instead of rendering both and letting CSS hide one.
 *
 *  The three states a caller must handle:
 *
 *  1. `wide === null` — not measured (SSR, the first client render, and any
 *     host without matchMedia: jsdom, anything non-browser). Render BOTH
 *     branches and let the `md:hidden` / `hidden md:block` classes hide one,
 *     exactly as before the single-mount change: identical server HTML → no
 *     hydration mismatch, no first-paint flash.
 *  2. measured, `crossed === false` — the normal visit. Render only the
 *     matching branch. This is the whole win: one mount per section, so one
 *     read per section open.
 *  3. `crossed === true` — render BOTH branches again, CSS-gated, PERMANENTLY.
 *
 *  Why state 3 exists: switching branches on a crossing unmounts one section
 *  and mounts the other, and a mount is a READ. On 監査ログ every read also
 *  WRITES a privacy.audit_log.view row (src/actions/audit-log.ts fires per
 *  invocation), so a phone rotating back and forth (393 portrait ↔ ~852
 *  landscape crosses 48rem) would write audit rows without bound. Falling back
 *  to the dual render after the FIRST crossing bounds it: the first crossing
 *  costs one mount, every crossing after it costs zero — nothing is unmounted
 *  or remounted, because both branches are already in the tree. The steady
 *  state is exactly the pre-change tree, which is the ceiling this is measured
 *  against.
 *
 *  Two consequences of state 3, both deliberate:
 *
 *  - The section instance the user was actually editing in STAYS MOUNTED
 *    across the crossing, so its local state survives an A→B→A round trip.
 *    The twin that comes forward is a fresh instance holding its own (empty)
 *    state — which is what the pre-change dual render did too, so no
 *    preservation property was ever lost. Carrying state ACROSS the two
 *    branches would need the section reparented (portals / one hoisted tree),
 *    a real structural cost for something only a resize or rotation triggers;
 *    deliberately not attempted.
 *  - After the first crossing every later section open costs two reads again,
 *    not one — the pre-change cost, not worse.
 *
 *  KNOWN RESIDUAL, deliberate: because measuring is a post-mount effect, a
 *  `?tab=`-deep-linked section is mounted in BOTH branches for that first
 *  render and so reads twice on that one paint (React flushes the children's
 *  passive effects before the measurement's re-render — a useLayoutEffect
 *  measurement was probed and behaves identically). Measuring during render
 *  instead WOULD fix it and WOULD cost a hydration mismatch, so it isn't done.
 *  Its one interaction with state 3: on that path the dropped branch is
 *  restored on the first crossing, so the deep-linked section mounts three
 *  times in total (2 on the paint + 1 restore) instead of the pre-change 2 —
 *  one extra read, once, and zero on every crossing after. Every non-deep-link
 *  path stays at ≤ 2. Pinned in settings-shell-single-mount.test.tsx.
 *
 *  KNOWN RESIDUAL, deliberate: on a phone's FIRST (unmeasured) paint the
 *  desktop branch mounts the default tab's section and discards it at
 *  measurement — zero cost today because OrganizationSection has no mount
 *  effects, but a cost the day that section (or whichever tab sorts first)
 *  gains one. */
export function useIsWide(): IsWideState {
  const [state, setState] = useState<IsWideState>({ wide: null, crossed: false })
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(MD_QUERY)
    // `crossing` is passed in rather than inferred from `prev.wide !== null`:
    // React StrictMode re-runs this effect on mount, and a second initial
    // measurement would otherwise latch `crossed` in dev and turn the
    // optimization off for every dev session.
    // `mq.matches` read OUT here, not inside the updater: React may invoke an
    // updater more than once (StrictMode double-invocation), and an updater
    // that re-reads a live browser object is not pure — two invocations could
    // see two different widths. Sample once, then fold. Defensive shape with no
    // reachable failing case today, so deliberately NOT covered by a red run —
    // a test would have to make the width change mid-flush to tell it apart.
    const measure = (crossing: boolean) => {
      const matches = mq.matches
      setState((prev) => ({ wide: matches, crossed: prev.crossed || crossing }))
    }
    measure(false)
    const onChange = () => measure(true)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return state
}
