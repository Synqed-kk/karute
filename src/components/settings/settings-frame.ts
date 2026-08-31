// The settings frame's width ceiling — ONE home for the value.
//
// ⚖ Liam 2026-08-31: the settings screen "should adapt to whatever the screen
// size is." It did not: the frame sat at `max-w-5xl` (1024px), which clamped the
// section surface to 926px at EVERY viewport ≥1268 on the web door (244px
// sidebar → the app shell → 1024px frame → two nested p-6 → SectionPanel's 1px
// border), and at 926px from a 1025px viewport up on the thin door, which has no
// sidebar.
//
// What that clamp actually cost, precisely: the discard section's master–detail
// composition and its two-up definitions turn on at 880px of section width, so
// those WERE reachable under the old ceiling (from a 1222px web window). What
// 926px could never reach was four-up definitions (≥1048) and the mock's 360px
// master column (≥1180) — DiscardReasonsSection's WIDE_MIN_PX /
// DEFS_FOUR_UP_MIN_PANE_PX / MOCK_SECTION_PX. This raises the ceiling; nothing
// at or below a 1268px web viewport changes, because there the viewport — not
// the ceiling — is what binds.
//
// 1440px is the settings-side readability ceiling. TWO shared wrappers bind
// before it today, one per door, both `mx-auto max-w-7xl` = 1280px:
//   · web   — src/app/[locale]/(app)/layout.tsx:145
//   · thin  — thin/chrome/Chrome.tsx:67
// So 1440 never binds on either door as things stand; the frame plateaus at
// 1280 (1182px of section surface). Widening either wrapper is a whole-app
// decision, not a settings one. This constant is what settings takes if one
// ever moves.
//
// Read by the web chrome (SettingsPageChrome), the thin bundle's settings
// screen, and the settings loading skeleton — the three places that paint this
// frame. Pinned by src/__tests__/integration/settings-fluid-width.test.tsx,
// which also guards that no wrapper spells a second `max-w-` of its own.
//
// ⚠ This must stay a CONTIGUOUS literal. Tailwind v4 finds classes by scanning
// source text, so a composed or interpolated class string (`max-w-[${n}px]`)
// would emit no rule and the ceiling would silently do nothing. Emission also
// depends on src/app/globals.css's `@source "../**/*.{ts,tsx}"` continuing to
// cover src/** — this file included.
export const SETTINGS_CONTENT_MAX_W = 'max-w-[1440px]'
