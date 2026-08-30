// 今日の運営 — THE SELLING ENGINE'S ROUND GATE (SPEC-SELLING-ENGINE §12).
//
// ⚖ E3a wires both doors to the reserved mask and the fragment fallback with
// this OFF, and proves the gated-off board byte-identical to today's. E3b is
// THE FLIP: withholding + fallback + reserved emission + §9's ruled 確保 chip
// go live together, in one coherent visible change, so the board changes ONCE
// and Liam previews the law whole. Flipping this constant is that round's first
// line — and its only switch.
//
// IT IS NOT A PRODUCT SWITCH. The store's dial is `gap_guard_mode` (core's
// `StoreBookingPolicy`, default OFF), and it is already in the inputs: a
// guard-off store gets an empty mask from `reservedMaskFor` and pays nothing,
// gate or no gate. This constant is CONSTRUCTION scaffolding — the reason the
// wiring can land, be reviewed and be proven before anything on screen moves.
// No env var, no dial, no per-store reading: one boolean, one home.
//
// IT IS READ AT THE SCREEN BOUNDARY ONLY (TodayScreen.tsx, twice — once per
// world). Everything below takes the mask as a PARAMETER, so an absent mask IS
// today's board by construction; reading this constant inside a predicate, a
// layer or a handler would put the round's state in two places and is a
// review-fail.
//
// `boolean` rather than `false as const` deliberately: `as const` makes every
// ON branch statically dead, so the type-checker stops checking the code this
// round exists to land, and the eventual flip would be the first time any of it
// was compiled honestly. The suite pins the value instead (one assertion, and
// it is the thing that actually matters: shipped OFF).
export const SELLING_ENGINE_LAW: boolean = false
