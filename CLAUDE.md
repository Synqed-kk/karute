# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

## Design law — no black interactive elements (R13, Liam 2026-08-06)

No tab, button, chip, toggle, or segmented control is EVER deliberately black.
The interactive accent is blue-600 `#2563eb` (dark mode `#60a5fa`), carried by
`--primary` in `src/app/globals.css` plus the `--color-accent` karute-theme
override there (the @synqed-kk/ui package ships a black accent — the override
is the app-side fix until the package retints).

- Selected/pressed state (tabs, filters, chips, options): `bg-primary/8
  text-primary` + `border-primary` where the control has a border. Never a
  solid dark fill. (/8 not /10: accent text on the 10% wash computes to
  4.49:1 — just under WCAG AA; 8% passes.)
- Commit/primary action (save, create, confirm): `bg-primary
  text-primary-foreground hover:bg-primary-hover`. Never `bg-foreground`,
  `bg-sage-800`, a dark hover, or an opacity hover on the fill —
  `hover:opacity-90`/`hover:bg-primary/90` LIGHTEN toward the page and drop
  white text below AA; `--primary-hover` darkens within the accent.
- Destructive stays red; status colors untouched; dark fills are legal only on
  non-interactive surfaces (photo canvases, scrims — allowlist them in the
  guard).

Enforced by `npm run audit:dark-interactive`
(`scripts/audit/check-dark-interactive.mjs`, runs in CI). If it fails, fix the
color — don't allowlist an interactive element.

## Design law — the one-way accent law (Liam 2026-08-06)

Saturated accent (`text-primary` used as a text color, `border-primary` as a
border, solid `bg-primary` fill) is RESERVED for interactive elements — things
a user can press: links, buttons, and the selected/active state OF pressable
controls (tabs, filter pills, options). Decoration, section labels,
status/informational text, and non-pressable indicators must be neutral
(`muted-foreground` / `border-border` / foreground-family).

The law is ONE-WAY: pressables may be quieter than accent (outline cancel
buttons, neutral tappable rows, muted icons) — that is fine and NOT a
violation. The allowance covers resting-state quietness only; it does not
override the R13 selected-state recipe above.

LEGAL and out of scope: soft washes (`bg-primary/8`, `bg-blue-50` info
banners, wash-styled status chips — wash-level opacity or a *-50 tint, never
a solid `bg-primary` fill on a non-pressable), focus rings and focus-visible
styles (a11y), semantic colors (red destructive, green success, amber
warning), chart/data colors.

The law binds the saturated blue family in ANY spelling (Liam, phase 2
2026-08-06): the primary tokens above, literal Tailwind blues
(`text-blue-500`–`700`, solid `bg-blue-500`–`700`, `border-blue-500`–`700`),
and raw accent hexes are all the same accent. Wash-level tints (*-50, *-100,
opacity washes) stay in the legal soft-wash tier — the approved icon-chip
treatment is `bg-blue-100 text-blue-700` + dark `bg-blue-500/15
text-blue-300`.

No sound fully-automated gate exists for this law — pressability is semantic;
a grep heuristic (like check-dark-interactive's INTERACTIVE_MARKERS) can flag
candidates but not judge them. Enforcement is review plus class-contract
tests pinning adjudicated sites
(`src/__tests__/integration/accent-tier-contract.test.tsx` today; siblings
accrue as more sites are adjudicated).
Judge the ELEMENT, not the file: accent on a span INSIDE a link/button is
part of the pressable and legal.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
