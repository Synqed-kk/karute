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
// Safe-area / Dynamic-Island: the shell used to pad the viewport box by the
// vertical insets because it had NO chrome to do it (packet 06 §Build 3).
// With the REAL web chrome mounted (parity P-A), the chrome owns the insets
// exactly like the web layout: MobileHeader pads pt-[env(safe-area-inset-top)]
// and BottomNav pads pb-[env(safe-area-inset-bottom)]. Keeping the shell
// padding too DOUBLED both edges (a dead strip above the header and below the
// nav on notched phones). The chrome-free branches (login, boot loading) are
// center-aligned full-screen content, clear of both edges by construction.
// Horizontal insets stay unapplied — 0 in portrait (the app's orientation),
// and padding them would inset CustomerTabBar's deliberate full-bleed `-mx-4`.

export function ThinShell({
  children,
  nav,
}: {
  children: ReactNode
  nav?: ReactNode
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-bg)]">
      <main className="relative flex-1 overflow-y-auto">{children}</main>
      {/* Bottom nav as a flex sibling BELOW the scroll region (packet-09 F-7
       *  cause 3) — it carries its own safe-area inset, like the web. */}
      {nav}
    </div>
  )
}
