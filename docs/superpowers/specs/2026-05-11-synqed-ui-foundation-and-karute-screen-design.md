# Synqed-UI Foundation & Karute Screen Redesign

**Date:** 2026-05-11
**Branch:** `feat/synqed-core-migration`
**Source:** `Synq-handoff.zip` (Claude Design handoff bundle) — extracted to `/tmp/synq-handoff/`

## Goal

Adopt the Synqed-UI design language as karute's single source of truth, replacing three overlapping token systems (shadcn `oklch`, `@synqed-kk/ui` 4-theme palette, hardcoded app-shell grays). This first phase delivers the foundation (tokens, app shell, primitive components) plus a redesign of the karute screen. The seven other screens inherit the new primitive look but keep their existing layouts pending later phases.

The eventual home for the Synqed-UI design system is the `@synqed-kk/ui` package, but it lives in karute for this phase to be validated end-to-end before promotion.

## Scope

### In
- Port `synq/project/tokens.css` `--sq-*` tokens into `src/app/globals.css` as the canonical token layer, dark + light themes only.
- Expose `--sq-*` to Tailwind v4 via `@theme inline` so utilities like `bg-sq-bg-2`, `text-sq-text-1`, `border-sq-stroke-2`, `rounded-sq-md`, `shadow-sq-2` exist.
- Swap `next-themes` to set `data-theme="dark|light"` on `<html>`.
- Rewrite shadcn primitives in `src/components/ui/` against `--sq-*` using class-variance-authority: `button`, `input`, `card`, `badge`, `avatar`. Add new primitives the karute screen needs: `chip` (filter pill / staff chip), `tabs`, `segmented`, `icon` (thin lucide-react wrapper exposing the prototype's name → component mapping).
- Redesign app shell: `src/components/layout/sidebar.tsx` (full-width with labels, accent active state, user identity tile pinned bottom — per prototype), `src/components/layout/top-bar.tsx` (restyled), `src/app/[locale]/(app)/layout.tsx` (drop hardcoded grays, adopt `bg-sq-bg-0` page / `bg-sq-bg-1` sidebar / `bg-sq-bg-2` cards).
- Redesign karute screen at `src/app/[locale]/(app)/karute/...` against new primitives, matching `synq/project/screens.jsx` `KaruteScreen` as the visual source of truth.

### Out
- The other 7 screens (recording, dashboard, reservations, customers, AI, import, settings) — their layouts are not redesigned in this phase. They inherit the new primitive look only.
- TweaksPanel (dropped — neither dev tool nor settings UI in phase 1).
- User-selectable accent / radius / density. One fixed accent in phase 1.
- A new "coaching" route — not currently in the app, not added.
- Promoting tokens/primitives to the `@synqed-kk/ui` package.
- Refactoring data flows. Existing Supabase queries and `@synqed-kk/client` calls remain unchanged; only the rendering layer is touched.
- Updating tests beyond what is forced by signature changes.

## Architecture

### Tokens

`src/app/globals.css` is rewritten:

1. Remove `@import "@synqed-kk/ui/src/themes/tokens.css"` and the `@source` line that pulled in `@synqed-kk/ui/dist`.
2. Remove the existing `:root`/`.dark` `oklch` token block (lines 53–120 currently).
3. Remove `@custom-variant dark (&:where(.dark, .dark *))` — no longer needed; tokens flip via `[data-theme]`.
4. Insert the ported `--sq-*` blocks from `synq/project/tokens.css`: `:root, [data-theme="dark"]` and `[data-theme="light"]`. This covers surfaces (`--sq-bg-0..4`), strokes, text ramp (`--sq-text-1..4`), accent (`--sq-accent`, `-hover`, `-soft`, `-ring`, `-text`), the six status palettes (success/warning/danger/info/violet/teal/rose), avatar ramp, radii (`--sq-r-xs..xl`, `--sq-r-pill`), spacing scale, shadows, type stacks, motion.
5. Add a `@theme inline` block mapping `--sq-*` to Tailwind theme variables so utilities are generated:

   ```css
   @theme inline {
     --color-sq-bg-0: var(--sq-bg-0);
     --color-sq-bg-1: var(--sq-bg-1);
     --color-sq-bg-2: var(--sq-bg-2);
     --color-sq-bg-3: var(--sq-bg-3);
     --color-sq-bg-4: var(--sq-bg-4);
     --color-sq-text-1: var(--sq-text-1);
     --color-sq-text-2: var(--sq-text-2);
     --color-sq-text-3: var(--sq-text-3);
     --color-sq-text-4: var(--sq-text-4);
     --color-sq-stroke-1: var(--sq-stroke-1);
     --color-sq-stroke-2: var(--sq-stroke-2);
     --color-sq-stroke-3: var(--sq-stroke-3);
     --color-sq-accent: var(--sq-accent);
     --color-sq-accent-hover: var(--sq-accent-hover);
     --color-sq-accent-soft: var(--sq-accent-soft);
     --color-sq-accent-ring: var(--sq-accent-ring);
     --color-sq-accent-text: var(--sq-accent-text);
     /* status: success / warning / danger / info / violet / teal / rose
        each with base / -soft / -text */
     /* avatar ramp 1..6 */
     --radius-sq-xs: var(--sq-r-xs);
     --radius-sq-sm: var(--sq-r-sm);
     --radius-sq-md: var(--sq-r-md);
     --radius-sq-lg: var(--sq-r-lg);
     --radius-sq-xl: var(--sq-r-xl);
     --radius-sq-pill: var(--sq-r-pill);
     --shadow-sq-1: var(--sq-shadow-1);
     --shadow-sq-2: var(--sq-shadow-2);
     --shadow-sq-3: var(--sq-shadow-3);
   }
   ```

6. Keep `@import "tailwindcss"`, `@import "tw-animate-css"`, `@import "shadcn/tailwind.css"`.
7. Body base styles use `--sq-bg-0` and `--sq-text-1`.

### Theme switching

Configure `next-themes`:
- `attribute="data-theme"` on `<html>` (instead of class)
- `themes={['dark', 'light']}`
- `defaultTheme="dark"` (handoff index.html ships dark-first)

The existing `theme-toggle.tsx` is updated to set theme via `setTheme('dark' | 'light')` and reflect state — it already uses `next-themes`, so the change is the provider config plus removing any `.dark` class checks.

### Primitives (`src/components/ui/`)

Each primitive is a small CVA-based component, shadcn-shaped (forwarded ref, `className` merge via `cn`, variant + size props):

- **`button.tsx`** — variants `primary | secondary | ghost | danger`; sizes `sm | md | lg`. Primary: `bg-sq-accent text-white hover:bg-sq-accent-hover`. Secondary: `bg-sq-bg-3 text-sq-text-1 hover:bg-sq-bg-4`. Ghost: `text-sq-text-2 hover:bg-sq-bg-2`. Danger: `bg-sq-danger text-white`.
- **`input.tsx`** — `bg-sq-bg-4 border border-sq-stroke-2 rounded-sq-md text-sq-text-1 placeholder:text-sq-text-4 focus:border-sq-accent focus:ring-sq-accent-ring`.
- **`card.tsx`** — `bg-sq-bg-2 border border-sq-stroke-1 rounded-sq-lg shadow-sq-1`. Header / content / footer subcomponents.
- **`badge.tsx`** — tone variants `accent | success | warning | danger | info | violet | teal | rose | neutral`. Each uses the matching `*-soft` background and `*-text` foreground.
- **`avatar.tsx`** — circular, sizes `sm | md | lg`. Accepts `src` + fallback initials. Accent variant uses avatar ramp colors (`--sq-avatar-1..6`) selected deterministically from a name hash.
- **`chip.tsx`** (new) — pill-shaped filter/staff chip. Active state: `bg-sq-accent-soft text-sq-accent-text border-sq-accent-ring`. Inactive: `bg-sq-bg-2 text-sq-text-2 border-sq-stroke-1`. Optional leading avatar or icon.
- **`tabs.tsx`** (new) — list of tab triggers; active gets accent underline + accent text.
- **`segmented.tsx`** (new) — segmented control used for tone toggles in karute (e.g. status filter). Pill container with `bg-sq-bg-2`; active segment gets `bg-sq-accent-soft text-sq-accent-text`.
- **`icon.tsx`** (new) — `<Icon name="mic" size={16} />` wrapper. Maps prototype icon names (mic, home, calendar, users, clipboard, sparkle, upload, settings, search, chev*, plus, check, x, send, paperclip, bell, clock, fileText, trending[Down], bar, etc.) to lucide-react components. Stroke / sizing defaults match the prototype (`stroke=1.75`, `size=16`).

Existing primitives that stay (touched only if a token rename is forced): `dialog.tsx`, `dropdown-menu.tsx`, `sheet.tsx`, `tooltip.tsx`, `skeleton.tsx`, `separator.tsx`, `employee-timeline-bar.tsx`, `timetable.tsx`. Where any of these reference shadcn semantic tokens (`bg-card`, `text-foreground`, etc.) those references are rewritten to the equivalent `--sq-*` utility.

### App shell

- **`src/components/layout/sidebar.tsx`** — rewritten to match handoff `Sidebar`: full-width column at fixed width (per prototype), background `bg-sq-bg-1`, border-right `border-sq-stroke-1`. Items show label text alongside icon (lucide via `Icon`), active item uses `bg-sq-accent-soft text-sq-accent-text`. User identity tile pinned at bottom with avatar + name + role. The `MicIcon`/`HomeIcon`/... inline-SVG functions at the top of the current file are removed in favor of `<Icon name="..." />`.
- **`src/components/layout/top-bar.tsx`** — same children, restyled against `--sq-*`. Background transparent over `bg-sq-bg-0`.
- **`src/app/[locale]/(app)/layout.tsx`** — replace `bg-[#e8e8e8] dark:bg-[#2a2a2a]` and the rounded `bg-[#e0e0e0] dark:bg-[#3a3a3a]` main panel with the prototype frame: page background `bg-sq-bg-0`, sidebar `bg-sq-bg-1`, main content flowing directly over page background. The logo header row is preserved structurally but restyled against the new tokens. `MiniRecorder` and `AIChatFAB` stay; if their internals reference old tokens those are rewritten.

### Karute screen

`src/app/[locale]/(app)/karute/...` renders existing route components against the new primitives. The implementation reads `synq/project/screens.jsx` `KaruteScreen` as the visual source of truth — specifically:
- the customer list layout (rows of avatar + name + meta + visit progress + status badge),
- staff-filter chip row at the top,
- the search/filter pill row,
- per-row visit-progress indicator,
- right-side detail pane (if present in the screen),
- typography and spacing match the prototype.

Existing data fetching (server components, Supabase, `@synqed-kk/client`) is preserved; only the JSX/styling of the rendering components changes. Where the prototype's data shape doesn't match what we have (e.g. `visitsTotal/visitsDone`), we render whatever the current data flow provides and adapt the layout if needed.

### Data flow

Unchanged. Server components fetch as today. No changes to API routes, Supabase queries, or `@synqed-kk/client` usage.

## Migration order (within phase 1, one branch, staged commits)

1. **Tokens land** — `globals.css` rewrite + `next-themes` config swap. Mid-state: app renders with broken styling because primitives still reference old vars. Acceptable mid-PR state.
2. **Primitives rewritten** — Button, Input, Card, Badge, Avatar, plus new Chip, Tabs, Segmented, Icon. After this, all 8 screens render again, visually shifted toward Synqed-UI.
3. **App shell ported** — Sidebar, TopBar, app layout frame.
4. **Karute screen redesigned** — against new primitives + shell.

## Risk: primitive cascade

Replacing primitives in step 2 instantly changes the look of every screen, not just karute. The other 7 screens currently use shadcn-token-shaped Button/Input/Card and will inherit the Synqed-UI look without their layouts being redesigned.

**Chosen strategy: accept the cascade.** Verify each existing screen still works (not broken, not unreadable) but accept it'll look "Synqed-primitive-styled, old-layout" until its own redesign phase. Rationale: existing screens use generic primitive shapes — colors/radii/spacing shift but functionality is preserved. If a specific screen breaks badly during verification (overflow, unreadable contrast, clipped interactive elements), apply the minimum correction in this branch to restore usability — not a redesign — rather than forking the primitive.

Rejected alternative: parallel `ButtonV2`/`InputV2` primitives. Doubles the primitive surface and creates migration debt for marginal short-term visual stability.

## Verification gate

Phase 1 is done when:
- `npm run type-check` passes
- `npm run lint` passes
- `npm test` passes
- Dev server boots; manually walk every existing screen (`/recording`, `/dashboard`, `/appointments`, `/customers`, `/karute`, `/ask-ai`, `/data-import`, `/settings`) — none are broken or unusable.
- Karute screen renders against new primitives and matches `synq/project/screens.jsx` `KaruteScreen` layout via side-by-side compare against the prototype source. (The prototype is HTML/CSS/JSX source — we read the source, we don't render the prototype.)
- Theme toggle flips dark ↔ light cleanly with no flash of unstyled or partially-themed content.

## Out-of-band cleanup performed as part of this work

These edits are forced by the foundation change and are in scope:
- Remove the `MicIcon`/`HomeIcon`/... inline-SVG functions at the top of `src/components/layout/sidebar.tsx` (replaced by `<Icon name="..." />`).
- Remove dead references to `@synqed-kk/ui/src/themes/tokens.css` and the `@source` line in `globals.css`.
- Update any component that hard-codes shadcn semantic tokens (`bg-card`, `text-foreground`, `border-border`, etc.) to use `--sq-*` equivalents.

Anything outside this list (refactoring data flows, redesigning other screens' layouts, adding tests, restructuring server components) is deferred.
