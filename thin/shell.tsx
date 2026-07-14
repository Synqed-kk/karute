import type { ReactNode } from 'react'

// ThinShell — reproduces the VIEWPORT CLAMP of src/app/[locale]/(app)/layout.tsx
// (its outer box), the one container every screen is authored to live inside:
//
//     <div className="flex h-dvh flex-col overflow-hidden">     ← clamps to the
//        <main className="... overflow-y-auto">                    dynamic viewport
//
// The thin target never renders that Next server layout, so a screen mounted
// bare has NO ancestor overflow boundary. Mobile full-bleed elements authored to
// be CLIPPED by the shell — e.g. CustomerTabBar's `-mx-4` bleed
// (src/components/customers/redesign/profile/CustomerTabBar.tsx) — then extend
// past the viewport edge and widen the DOCUMENT horizontally. iOS WKWebView, with
// `width=device-width, initial-scale=1`, responds by shrinking the whole page to
// fit that overflow → the zoomed/stretched rendering (follow-up f).
//
// Reproducing the clamp here (outer `overflow-hidden` + inner `overflow-y-auto`,
// which per CSS forces overflow-x to `auto` on the scroll region) keeps the bleed
// contained inside `main` exactly as the web layout does, so html/body never grow
// and WKWebView never rescales. The salon chrome (header / sidebar / bottom nav)
// is deliberately NOT reproduced here — it is not part of the clamp and is out of
// this batch's scope.
// Safe-area / Dynamic-Island (packet 06 §Build 3, carry-forward #3): the thin
// shell deliberately omits the salon chrome (header/bottom-nav) that, on the
// web, pushes content clear of the notch. In a bare WKWebView with
// viewport-fit=cover, a full-screen profile would therefore start UNDER the
// Dynamic Island (top) and the home indicator (bottom). Pad the viewport box by
// the vertical safe-area insets so every screen's content clears them. Applied
// with box-sizing:border-box (Tailwind default) so it stays inside h-dvh.
// Horizontal insets are intentionally NOT applied — they are 0 in portrait (the
// app's orientation) and padding them would inset CustomerTabBar's deliberate
// full-bleed `-mx-4`, which the outer overflow-hidden clamp is here to contain.
const safeAreaInsets = {
  paddingTop: 'env(safe-area-inset-top)',
  paddingBottom: 'env(safe-area-inset-bottom)',
} as const

export function ThinShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-[var(--color-bg)]"
      style={safeAreaInsets}
    >
      <main className="relative flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
