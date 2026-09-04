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
// today's board by construction; reading this constant inside a predicate, a
// layer or a handler would put the round's state in two places and is a
// review-fail.
//
// `boolean` rather than `true as const` deliberately, and for the mirror image
// of E3a's reason: `as const` would make every OFF branch statically dead, and
// those branches are the ones the gated-off parity proof is written against.
// The suite pins the value instead (one assertion, and it is the thing that
// actually matters: shipped ON from E3b).
export const SELLING_ENGINE_LAW: boolean = true
