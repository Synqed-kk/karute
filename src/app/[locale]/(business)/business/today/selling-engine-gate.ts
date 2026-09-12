// 今日の運営 — THE SELLING ENGINE'S ROUND GATE (SPEC-SELLING-ENGINE §12).
//
// ⚖ E3a wired both doors to the reserved mask and the fragment fallback with
// this OFF, and proved the gated-off board byte-identical to today's. E3b IS
// THE FLIP, and this line is it: withholding + fallback + reserved emission +
// §9's ruled 確保 chip + the counter's ruled definition all go live together,
// in one coherent visible change, so the board changes ONCE and Liam previews
// the law whole. Every seam below still takes the mask as a parameter, so the
// off path did not become dead code — it became the shape of a store that
// holds nothing.
//
// IT IS NOT A PRODUCT SWITCH. The store's dial is `gap_guard_mode` (core's
// `StoreBookingPolicy`, default OFF), and it is already in the inputs: a
// guard-off store gets an empty mask from `reservedMaskFor` and pays nothing,
// gate or no gate. This constant is CONSTRUCTION scaffolding — the reason the
// wiring can land, be reviewed and be proven before anything on screen moves.
// No env var, no dial, no per-store reading: one boolean, one home.
//
// IT IS READ AT THE SCREEN BOUNDARY ONLY (TodayScreen.tsx) — FOUR value reads:
// the committed world's `gateOn`, the board world's mask memo, the rail's
// protected door and (⚖ R7) the verdict's protected door. The count is pinned
// in selling-engine-doors.test.ts §1, so a fifth read cannot arrive quietly.
// Everything below takes the mask as a PARAMETER, so an absent mask IS
// today's board by construction — for every reader EXCEPT the rail's 新規用
// word, which is the mask's own (⚖ NEW-WINDOW L-E, today-interactions
// `railExplain`): with no mask there is no held half hour, so no word —
// honest, not a regression. Reading this constant inside a predicate, a
// layer or a handler would put the round's state in two places and is a
// review-fail.
//
// `boolean` rather than `true as const` deliberately, and for the mirror image
// of E3a's reason: `as const` would make every OFF branch statically dead, and
// those branches are the ones the gated-off parity proof is written against.
// The suite pins the value instead (one assertion, and it is the thing that
// actually matters: shipped ON from E3b).
export const SELLING_ENGINE_LAW: boolean = true

// 今日の運営 — THE HONEST 確保 COUNT'S OWN ROUND GATE (⚖ Liam 2026-09-12 21:1x).
//
// Same discipline as the line above, for the round that makes 新規用に確保 say
// what the store's ROOMS can honour rather than what the per-lane enumeration
// published. It lives here for the reason that one does: the doors test's
// forbidden-reader list (§1) exists so a round's state cannot end up in two
// places, and `reserved-mask.ts` — where a netting gate would look natural — is
// ON that list.
//
// IT IS NOT A PRODUCT SWITCH EITHER. The store's dial is still `gap_guard_mode`:
// a guard-off store gets the frozen empty mask and there is nothing to net.
// This constant is CONSTRUCTION scaffolding, one boolean, one home, no env var.
//
// READ AT THE SCREEN BOUNDARY ONLY — ONE value read, and the count is pinned in
// selling-engine-doors.test.ts §1 so a second cannot arrive quietly. OFF means
// the screen's `honest` memo is `undefined`, and every reader below it —
// the chip, the day layer, the row's boxes, the online 確保 rows, the rail —
// takes the path that shipped, by construction rather than by a branch each of
// them maintains. The netting FUNCTION keeps its own `on` parameter so its
// identity answer stays reachable from its suite.
//
// `boolean` rather than `true as const`, for the same reason as above: the OFF
// branches are what the parity proof is written against and `as const` would
// make them statically dead.
export const HONEST_HELD: boolean = true
