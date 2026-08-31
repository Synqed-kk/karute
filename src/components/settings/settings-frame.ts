// The settings frame's width ceiling — ONE home for the value.
//
// ⚖ Liam 2026-08-31: the settings screen "should adapt to whatever the screen
// size is." It did not: the frame sat at `max-w-5xl` (1024px), which clamped the
// section surface to 926px at EVERY viewport ≥1268 (244px sidebar → the app
// shell → 1024px frame → two nested p-6 → SectionPanel's 1px border). The
// discard section already ships width-keyed compositions (two-up below 1048,
// four-up at ≥1048, master column 300→360 at ≥1180) that the clamp made
// unreachable. This raises the ceiling; nothing below 1268 changes, because
// below it the viewport — not the ceiling — is what binds.
//
// 1440px is the settings-side readability ceiling. Today the SHARED app-shell
// wrapper (`mx-auto max-w-7xl`, src/app/[locale]/(app)/layout.tsx:145) binds
// first at 1280px, so the frame plateaus there from a ~1524px viewport upward;
// widening that shared wrapper is a whole-app decision, not a settings one.
// This constant is what settings takes if it ever moves.
//
// Read by the web chrome (SettingsPageChrome), the thin bundle's settings
// screen, and the settings loading skeleton — the three places that paint this
// frame. Pinned by src/__tests__/integration/settings-fluid-width.test.tsx.
export const SETTINGS_CONTENT_MAX_W = 'max-w-[1440px]'
