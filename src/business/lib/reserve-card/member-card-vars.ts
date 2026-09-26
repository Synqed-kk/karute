// Verified port of Synqed-kk/reserve @ c2a9f9543187 — the card's colour variables.
// Three blocks, each byte-identical below its marker; re-port when Reserve changes (see PARITY.md).
// Non-verbatim: these header lines and the two imports (Reserve imports via "@/lib/…" paths).
import type { CSSProperties } from "react";

import { satinVars } from "./satin-material";

// reserve src/lib/types.ts:162–185 @ c2a9f95, verbatim
export interface BrandTheme {
  /** Business-selected Reserve card color; separate from app chrome. */
  cardColor?: string;
  heroImage?: string; // URL or CSS gradient
  primaryColor?: string; // OKLCH or hex
  fontFamily?: string;
  tagline?: string;
  /** Latin display face for logotype/headline moments (e.g. a serif). */
  displayFont?: string;
  /** JP heading face paired with displayFont (e.g. a mincho). */
  headingJpFont?: string;
  /** Warm/cool ground override: [background, card, foreground] — all move together. */
  ground?: { background: string; card: string; foreground: string };
  /** Decorative accent, allowed in at most two enumerated components (hero tagline, rating stars). */
  ornamentColor?: string;
  /** The tenant's own SECOND brand colour — the lighter stop of the pair it
   *  prints with. Optional on purpose: a tenant that never named one keeps the
   *  app's contrast-safe darkening of `primaryColor` instead of being given an
   *  invented hue (src/index.css, the 回数券 stub). */
  brandColor2?: string;
  /** The tenant's own PALE brand ground — the tint its printed fields sit on.
   *  Same rule: authored first, the app's color-mix() formula otherwise. */
  brandPale?: string;
}

// reserve src/lib/reserve-api/member-ia.ts:238–253 @ c2a9f95, verbatim
/**
 * The two stops a tenant OBJECT is printed with — the lighter one first, which
 * is the order every gradient in the member area reads them in. `null` when the
 * tenant named no second colour: the app then falls back to its own
 * contrast-safe darkening of `primaryColor` (src/index.css, the
 * `var(--tenant-g1, var(--tenant, …))` chain) rather than being handed an
 * invented hue. Pure and here rather than in the adapter that emits it, so
 * check:member-ia can drive the fallback with a synthetic tenant — since F-9
 * gave STUDIO FORCE its own pair, no shipped tenant exercises that branch.
 */
export function tenantGradientPair(
  theme: BrandTheme | undefined,
): { "--tenant-g1": string; "--tenant-g2": string } | null {
  if (!theme?.brandColor2 || !theme.primaryColor) return null;
  return { "--tenant-g1": theme.brandColor2, "--tenant-g2": theme.primaryColor };
}

// reserve src/components/customer/salon-surface.tsx:36–61 @ c2a9f95, verbatim
/**
 * The MEMBER-AREA half of the same adapter: a tenant's identity carried into
 * an APP surface (a home row, the ranked ticket, the 受付 sheet) without
 * re-skinning it. salonSurfaceVars() hands a tenant its whole surface; this
 * hands the app three read-only vars the studio-round CSS paints with, so the
 * app's own chrome, type and accent stay the app's.
 *
 * Nothing here invents a colour: a tenant with no brandTheme yields {}, and
 * every rule that reads --tenant falls back to the platform accent.
 */
export function memberTenantVars(theme: BrandTheme | undefined): CSSProperties {
  if (!theme) return {};
  return {
    ...(theme.primaryColor ? { "--tenant": theme.primaryColor } : {}),
    ...satinVars(theme.cardColor ?? theme.primaryColor),
    ...(theme.displayFont ? { "--tenant-face": theme.displayFont } : {}),
    ...(theme.ornamentColor ? { "--tenant-ornament": theme.ornamentColor } : {}),
    // The two stops a tenant OBJECT is printed with. Emitted as a pair, and
    // only when the tenant authored a second colour: the pair is what makes
    // the ticket stub two-tone, and half of it would read as a formula again.
    // Absent → the CSS falls back to the app's contrast-safe derivation. The
    // RULE is pure (member-ia.tenantGradientPair) so a gate can drive it.
    ...(tenantGradientPair(theme) ?? {}),
    ...(theme.brandPale ? { "--tenant-pale": theme.brandPale } : {}),
  } as CSSProperties;
}
