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
- Add a compatibility-bridge alias layer in the same theme blocks: `--color-bg-card`, `--color-text`, `--radius-md`, etc. (the names consumed by `@synqed-kk/ui` components) resolve to `--sq-*` equivalents. This keeps the 7 non-karute screens functional during phase 1 — they inherit the new palette through their existing var names but their layouts are not redesigned.
- Swap `next-themes` to set `data-theme="dark|light"` on `<html>`.
- Add new primitives in `src/components/ui/` that the karute screen needs and don't exist yet: `card`, `badge`, `chip` (filter pill / staff chip), `tabs`, `segmented`, `icon` (thin lucide-react wrapper exposing the prototype's name → component mapping). All built against `--sq-*` utilities using class-variance-authority.
- **Existing shadcn primitives are not rewritten.** `button.tsx`, `input.tsx`, `avatar.tsx` (and the other untouched files: `dialog`, `dropdown-menu`, `sheet`, `tooltip`, `skeleton`, `separator`, etc.) keep their current code. They reference shadcn semantic names (`bg-primary`, `bg-card`, `text-foreground`, `border-border`, etc.) which the alias bridge maps to `--sq-*` equivalents — so they pick up the new palette automatically without being touched. The cleanup of these primitives is deferred to a later phase.
- Redesign app shell: `src/components/layout/sidebar.tsx` (full-width with labels, accent active state, user identity tile pinned bottom — per prototype), `src/components/layout/top-bar.tsx` (restyled), `src/app/[locale]/(app)/layout.tsx` (drop hardcoded grays, adopt `bg-sq-bg-0` page / `bg-sq-bg-1` sidebar / `bg-sq-bg-2` cards).
- Redesign karute screen at `src/app/[locale]/(app)/karute/...` against new primitives, matching `synq/project/screens.jsx` `KaruteScreen` as the visual source of truth.

### Out
- The other 7 screens (recording, dashboard, reservations, customers, AI, import, settings) and the karute detail screen — their layouts are not redesigned in this phase. They inherit the new palette through the bridge.
- Rewriting the existing shadcn primitives in `src/components/ui/` (`button`, `input`, `avatar`, `dialog`, `dropdown-menu`, `sheet`, `tooltip`, `skeleton`, `separator`, `employee-timeline-bar`, `timetable`). They keep rendering against shadcn semantic var names; the bridge handles the repaint.
- TweaksPanel (dropped — neither dev tool nor settings UI in phase 1).
- User-selectable accent / radius / density. One fixed accent in phase 1.
- A new "coaching" route — not currently in the app, not added.
- Promoting tokens/primitives to the `@synqed-kk/ui` package.
- Refactoring data flows. Existing Supabase queries and `@synqed-kk/client` calls remain unchanged; only the rendering layer is touched.
- Updating tests beyond what is forced by signature changes.

## Architecture

### Tokens

`src/app/globals.css` is rewritten:

1. Remove `@import "@synqed-kk/ui/src/themes/tokens.css"` and the `@source` line. The `@synqed-kk/ui` components continue to work because we add a compatibility-bridge alias layer (step 5 below); they just see the new palette through their old var names.
2. Remove the existing `:root`/`.dark` `oklch` token block (lines 53–120 currently).
3. Remove `@custom-variant dark (&:where(.dark, .dark *))` — no longer needed; tokens flip via `[data-theme]`.
4. Insert the ported `--sq-*` blocks from `synq/project/tokens.css`: `:root, [data-theme="dark"]` and `[data-theme="light"]`. This covers surfaces (`--sq-bg-0..4`), strokes, text ramp (`--sq-text-1..4`), accent (`--sq-accent`, `-hover`, `-soft`, `-ring`, `-text`), the six status palettes (success/warning/danger/info/violet/teal/rose), avatar ramp, radii (`--sq-r-xs..xl`, `--sq-r-pill`), spacing scale, shadows, type stacks, motion.
5. **Compatibility-bridge aliases.** Inside each of the dark/light theme blocks, alias the `@synqed-kk/ui` var names AND the shadcn semantic var names to their `--sq-*` equivalents. This keeps both `@synqed-kk/ui` screen components and the existing shadcn primitives (Button, Input, Avatar, Dialog, etc.) rendering correctly with the new palette without being touched.

   **`@synqed-kk/ui` names** (derived from `@synqed-kk/ui/src/themes/tokens.css`):
   - `--color-bg → --sq-bg-0`, `--color-bg-card → --sq-bg-2`, `--color-bg-card-hover → --sq-bg-3`, `--color-bg-muted → --sq-bg-4`, `--color-bg-overlay → --sq-bg-overlay`
   - `--color-chrome → --sq-bg-1`, `--color-chrome-hover → --sq-bg-2`, `--color-chrome-active → --sq-bg-2`, `--color-chrome-border → --sq-stroke-2`, `--color-chrome-text → --sq-text-3`, `--color-chrome-text-active → --sq-accent-text`
   - `--color-accent → --sq-accent`, `--color-accent-hover → --sq-accent-hover`, `--color-accent-light → --sq-accent-soft`, `--color-accent-text: #ffffff` (literal; accent buttons need white text)
   - `--color-text → --sq-text-1`, `--color-text-muted → --sq-text-3`, `--color-text-inverse → --sq-bg-0`
   - `--color-border → --sq-stroke-2`, `--color-border-strong → --sq-stroke-3`
   - `--color-destructive → --sq-danger`, `--color-destructive-text: #ffffff`, `--color-success → --sq-success`, `--color-warning → --sq-warning`, `--color-recording → --sq-danger`
   - `--radius-sm → --sq-r-sm`, `--radius-md → --sq-r-md`, `--radius-lg → --sq-r-lg`, `--radius-xl → --sq-r-xl`, `--radius-full → --sq-r-pill`
   - `--sidebar-width: 80px` (preserve as-is; not a color)

   **shadcn semantic names** (consumed by existing primitives in `src/components/ui/`):
   - `--background → --sq-bg-0`, `--foreground → --sq-text-1`
   - `--card → --sq-bg-2`, `--card-foreground → --sq-text-1`
   - `--popover → --sq-bg-3`, `--popover-foreground → --sq-text-1`
   - `--primary → --sq-accent`, `--primary-foreground: #ffffff`
   - `--secondary → --sq-bg-3`, `--secondary-foreground → --sq-text-1`
   - `--muted → --sq-bg-4`, `--muted-foreground → --sq-text-3`
   - `--accent → --sq-bg-3`, `--accent-foreground → --sq-text-1` (these are shadcn "subtle highlight" semantics, NOT the brand accent)
   - `--destructive → --sq-danger`
   - `--border → --sq-stroke-2`, `--input → --sq-stroke-2`, `--ring → --sq-accent-ring`
   - `--sidebar → --sq-bg-1`, `--sidebar-foreground → --sq-text-1`, `--sidebar-primary → --sq-accent`, `--sidebar-primary-foreground: #ffffff`, `--sidebar-accent → --sq-accent-soft`, `--sidebar-accent-foreground → --sq-accent-text`, `--sidebar-border → --sq-stroke-1`, `--sidebar-ring → --sq-accent-ring`
   - `--radius: 10px` (a single number, consumed by `--radius-sm/md/lg/xl` calc expressions in the existing `@theme inline` block that we keep)
6. Add a `@theme inline` block mapping `--sq-*` to Tailwind theme variables so utilities are generated:

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

7. Keep `@import "tailwindcss"`, `@import "tw-animate-css"`, `@import "shadcn/tailwind.css"`.
8. Body base styles use `--sq-bg-0` and `--sq-text-1`.

### Theme switching

Configure `next-themes`:
- `attribute="data-theme"` on `<html>` (instead of class)
- `themes={['dark', 'light']}`
- `defaultTheme="dark"` (handoff index.html ships dark-first)

The existing `theme-toggle.tsx` is updated to set theme via `setTheme('dark' | 'light')` and reflect state — it already uses `next-themes`, so the change is the provider config plus removing any `.dark` class checks.

### Primitives (`src/components/ui/`)

**Existing primitives are not touched in phase 1.** `button.tsx`, `input.tsx`, `avatar.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `sheet.tsx`, `tooltip.tsx`, `skeleton.tsx`, `separator.tsx`, `employee-timeline-bar.tsx`, `timetable.tsx` keep their current code. They render against shadcn semantic var names, which the alias bridge resolves to `--sq-*` palette.

**New primitives** added for the karute screen (and reusable across the app). Each is a small CVA-based component, shadcn-shaped (forwarded ref where it makes sense, `className` merge via `cn`, variant + size props), built against `--sq-*` Tailwind utilities directly:

- **`card.tsx`** (new) — `bg-sq-bg-2 border border-sq-stroke-1 rounded-sq-lg shadow-sq-1`. Header / content / footer subcomponents.
- **`badge.tsx`** (new) — tone variants `accent | success | warning | danger | info | violet | teal | rose | neutral`. Each uses the matching `*-soft` background and `*-text` foreground.
- **`chip.tsx`** (new) — pill-shaped filter/staff chip. Active state: `bg-sq-accent-soft text-sq-accent-text border-sq-accent-ring`. Inactive: `bg-sq-bg-2 text-sq-text-2 border-sq-stroke-1`. Optional leading avatar or icon.
- **`tabs.tsx`** (new) — list of tab triggers; active gets accent underline + accent text.
- **`segmented.tsx`** (new) — segmented control used for tone toggles in karute (e.g. status filter). Pill container with `bg-sq-bg-2`; active segment gets `bg-sq-accent-soft text-sq-accent-text`.
- **`icon.tsx`** (new) — `<Icon name="mic" size={16} />` wrapper. Maps prototype icon names (mic, home, calendar, users, clipboard, sparkle, upload, settings, search, chev*, plus, check, x, send, paperclip, bell, clock, fileText, trending[Down], bar, etc.) to lucide-react components. Stroke / sizing defaults match the prototype (`stroke=1.75`, `size=16`).

### App shell

- **`src/components/layout/sidebar.tsx`** — rewritten to match handoff `Sidebar`: full-width column at fixed width (per prototype), background `bg-sq-bg-1`, border-right `border-sq-stroke-1`. Items show label text alongside icon (lucide via `Icon`), active item uses `bg-sq-accent-soft text-sq-accent-text`. User identity tile pinned at bottom with avatar + name + role. The `MicIcon`/`HomeIcon`/... inline-SVG functions at the top of the current file are removed in favor of `<Icon name="..." />`.
- **`src/components/layout/top-bar.tsx`** — same children, restyled against `--sq-*`. Background transparent over `bg-sq-bg-0`.
- **`src/app/[locale]/(app)/layout.tsx`** — replace `bg-[#e8e8e8] dark:bg-[#2a2a2a]` and the rounded `bg-[#e0e0e0] dark:bg-[#3a3a3a]` main panel with the prototype frame: page background `bg-sq-bg-0`, sidebar `bg-sq-bg-1`, main content flowing directly over page background. The logo header row is preserved structurally but restyled against the new tokens. `MiniRecorder` and `AIChatFAB` stay; if their internals reference old tokens those are rewritten.

### Karute screen

`src/components/karute/KaruteListView.tsx` currently consumes `KaruteListPageHeader`, `KaruteListFilterBar`, `KaruteListRow`, and `ErrorState` from `@synqed-kk/ui`. In this phase, `KaruteListView.tsx` is rewritten to stop importing those components and instead render the karute screen layout using the new Tailwind/shadcn primitives we are building, matching `synq/project/screens.jsx` `KaruteScreen` as the visual source of truth — specifically:
- the customer/karute list layout (rows of avatar + name + meta + visit progress + status badge),
- staff-filter chip row at the top,
- the search/filter pill row,
- per-row visit-progress indicator,
- typography and spacing match the prototype.

The detail page (`src/components/karute/KaruteDetailSpikeView.tsx`) is **not redesigned in this phase**. It keeps using `@synqed-kk/ui` and inherits the new palette through the bridge — same as the other 7 screens. The redesign target in phase 1 is the list screen at `/karute`, since that is what `KaruteScreen` in the prototype shows.

Existing data fetching (`src/app/[locale]/(app)/karute/page.tsx`, Supabase queries, the `karuteRecordsToRowData` adapter) is preserved; only the JSX/styling of `KaruteListView` changes. Where the prototype's data shape doesn't match what we have (e.g. `visitsTotal/visitsDone`, staff filter), we render whatever the current data flow provides and adapt the layout if needed. Fields shown in the prototype but absent from current data (e.g. visit count) are omitted rather than mocked.

### Data flow

Unchanged. Server components fetch as today. No changes to API routes, Supabase queries, or `@synqed-kk/client` usage.

## Migration order (within phase 1, one branch, staged commits)

1. **Tokens + bridge land** — `globals.css` rewrite (new `--sq-*` tokens + alias bridge for `@synqed-kk/ui` and shadcn semantic names + `@theme inline` mapping) + `next-themes` config swap to `data-theme`. After this step, **every existing screen should still render correctly** — same layouts, new palette — because the bridge maps the var names existing components consume.
2. **New primitives added** — Card, Badge, Chip, Tabs, Segmented, Icon. No existing files modified in this step.
3. **App shell ported** — Sidebar (rewrite using Icon + new layout), TopBar (restyled), app layout frame (`[locale]/(app)/layout.tsx`: drop hardcoded `bg-[#e8e8e8]/[#2a2a2a]`/`bg-[#e0e0e0]/[#3a3a3a]` grays in favor of `bg-sq-bg-0`/`bg-sq-bg-1`).
4. **Karute list screen redesigned** — `KaruteListView.tsx` rewritten to stop importing `@synqed-kk/ui` karute components, instead rendering the prototype's `KaruteScreen` layout using the new primitives.

## Risk: bridge breakage

The alias bridge is doing significant work — it makes both the `@synqed-kk/ui` package and the existing shadcn primitives keep rendering correctly. If a var name is missed from the alias list, the component using it will render with an unset/inherited value (usually broken contrast or wrong background).

**Mitigation:**
- The alias lists in this spec were derived from grepping the actual source files (`@synqed-kk/ui/src/themes/tokens.css` and `src/app/globals.css`'s existing oklch block + `@theme inline` block). The implementer re-greps both at step 1 to confirm nothing has changed.
- Phase 1 verification walks every screen visually. Any var name that turns out to be referenced but unaliased is added to the bridge before phase 1 closes.

Rejected alternative: rewrite all primitives + all consumers in phase 1 to use `--sq-*` directly. Eliminates the bridge but multiplies the diff size and verification burden; the bridge buys us a much smaller phase 1 at the cost of carrying two var-name systems until later phases redesign each screen.

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
- Remove the `@import "@synqed-kk/ui/src/themes/tokens.css"` line and the `@source "../../node_modules/@synqed-kk/ui/dist/..."` line in `globals.css`.
- Remove `@custom-variant dark` declaration (no longer needed; tokens flip via `[data-theme]` attribute).
- The hardcoded `bg-[#e8e8e8]/[#2a2a2a]` and `bg-[#e0e0e0]/[#3a3a3a]` color literals in `src/app/[locale]/(app)/layout.tsx`.

Anything outside this list (rewriting existing shadcn primitives, refactoring data flows, redesigning other screens' layouts, adding tests, restructuring server components) is deferred.
