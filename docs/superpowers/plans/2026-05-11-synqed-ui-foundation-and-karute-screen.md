# Synqed-UI Foundation & Karute Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the Synqed-UI design language (from `Synq-handoff.zip`, extracted at `/tmp/synq-handoff/`) as karute's single source of truth, starting with the foundation layer plus a redesign of the karute list screen.

**Architecture:** Replace the existing token layers in `src/app/globals.css` with the handoff's `--sq-*` tokens (dark + light themes). Add a compatibility-bridge alias layer mapping `@synqed-kk/ui` and shadcn semantic var names to `--sq-*` equivalents — this lets existing primitives (`Button`, `Input`, `Avatar`, etc.) and `@synqed-kk/ui` screen components keep rendering without being rewritten. Add four new primitives (`Card`, `Badge`, `Chip`, `Icon`) that the karute screen needs. Rewrite the sidebar, app frame, and `KaruteListView` against the new primitives. Other screens inherit the new palette through the bridge but keep their existing layouts.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, shadcn, `class-variance-authority`, `next-themes`, `lucide-react`, TypeScript.

**Spec:** [`docs/superpowers/specs/2026-05-11-synqed-ui-foundation-and-karute-screen-design.md`](../specs/2026-05-11-synqed-ui-foundation-and-karute-screen-design.md)

**Handoff source files (read-only reference):**
- `/tmp/synq-handoff/synq/project/tokens.css` — source of `--sq-*` token values
- `/tmp/synq-handoff/synq/project/screens.jsx` line 405–490 — `KaruteScreen` visual reference for Task 8

---

## Task 1: Replace `globals.css` with `--sq-*` tokens + alias bridge + `@theme inline`

**Files:**
- Modify: `src/app/globals.css` (full rewrite)
- Modify: `src/components/providers/theme-provider.tsx`

**Goal:** All existing screens continue to render correctly but with the Synqed-UI palette. No new components yet. This is the foundation step.

- [ ] **Step 1: Rewrite `src/app/globals.css`**

Replace the file's entire contents with:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* ─────────────────────────────────────────────────────────────────
   Synqed-UI Design Tokens
   Ported from synq/project/tokens.css (Synq-handoff bundle).
   Canonical --sq-* layer + compatibility-bridge aliases for legacy
   @synqed-kk/ui and shadcn semantic var names.
   Themable via [data-theme="dark|light"] on :root.
   ───────────────────────────────────────────────────────────────── */

:root,
[data-theme="dark"] {
  /* Surfaces */
  --sq-bg-0: #07090c;
  --sq-bg-1: #0c1014;
  --sq-bg-2: #11161c;
  --sq-bg-3: #161c24;
  --sq-bg-4: #1c232c;
  --sq-bg-overlay: rgba(8, 11, 15, 0.72);

  /* Strokes */
  --sq-stroke-1: rgba(255, 255, 255, 0.06);
  --sq-stroke-2: rgba(255, 255, 255, 0.10);
  --sq-stroke-3: rgba(255, 255, 255, 0.16);

  /* Text */
  --sq-text-1: #f3f5f8;
  --sq-text-2: #b8c0cc;
  --sq-text-3: #7d8694;
  --sq-text-4: #525b67;

  /* Brand accent */
  --sq-accent: #3d7bff;
  --sq-accent-hover: #5790ff;
  --sq-accent-soft: rgba(61, 123, 255, 0.14);
  --sq-accent-ring: rgba(61, 123, 255, 0.35);
  --sq-accent-text: #8fb3ff;

  /* Status palettes */
  --sq-success: #2fbf71;
  --sq-success-soft: rgba(47, 191, 113, 0.13);
  --sq-success-text: #6ee7a8;

  --sq-warning: #f6a93b;
  --sq-warning-soft: rgba(246, 169, 59, 0.13);
  --sq-warning-text: #fbcd7a;

  --sq-danger: #ef5a5a;
  --sq-danger-soft: rgba(239, 90, 90, 0.13);
  --sq-danger-text: #ff8a8a;

  --sq-info: #4ec5e6;
  --sq-info-soft: rgba(78, 197, 230, 0.13);
  --sq-info-text: #86d8ec;

  --sq-violet: #9b7bff;
  --sq-violet-soft: rgba(155, 123, 255, 0.13);
  --sq-violet-text: #c1a8ff;

  --sq-teal: #2dd4bf;
  --sq-teal-soft: rgba(45, 212, 191, 0.13);
  --sq-teal-text: #6fe7d4;

  --sq-rose: #f06aa8;
  --sq-rose-soft: rgba(240, 106, 168, 0.13);
  --sq-rose-text: #ff9bcb;

  /* Avatar ramp (deterministic) */
  --sq-avatar-1: #4ec5e6;
  --sq-avatar-2: #9b7bff;
  --sq-avatar-3: #2fbf71;
  --sq-avatar-4: #f6a93b;
  --sq-avatar-5: #f06aa8;
  --sq-avatar-6: #c89b59;

  /* Radii */
  --sq-r-xs: 6px;
  --sq-r-sm: 8px;
  --sq-r-md: 10px;
  --sq-r-lg: 14px;
  --sq-r-xl: 18px;
  --sq-r-pill: 999px;

  /* Spacing (4px base) */
  --sq-s-1: 4px;
  --sq-s-2: 8px;
  --sq-s-3: 12px;
  --sq-s-4: 16px;
  --sq-s-5: 20px;
  --sq-s-6: 24px;
  --sq-s-7: 32px;
  --sq-s-8: 40px;
  --sq-s-9: 56px;

  /* Shadows */
  --sq-shadow-1: 0 1px 2px rgba(0, 0, 0, 0.4);
  --sq-shadow-2: 0 8px 24px rgba(0, 0, 0, 0.35);
  --sq-shadow-3: 0 20px 50px rgba(0, 0, 0, 0.5);
  --sq-shadow-focus: 0 0 0 3px var(--sq-accent-ring);

  /* Type */
  --sq-font-sans: "Inter", "Hiragino Sans", "Noto Sans JP", system-ui, -apple-system, sans-serif;
  --sq-font-display: "Inter", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  --sq-font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;

  /* Motion */
  --sq-easing: cubic-bezier(0.4, 0, 0.2, 1);
  --sq-dur-1: 120ms;
  --sq-dur-2: 200ms;
  --sq-dur-3: 320ms;

  /* ── Compatibility bridge: @synqed-kk/ui var names → --sq-* ── */
  --color-bg: var(--sq-bg-0);
  --color-bg-card: var(--sq-bg-2);
  --color-bg-card-hover: var(--sq-bg-3);
  --color-bg-muted: var(--sq-bg-4);
  --color-bg-overlay: var(--sq-bg-overlay);
  --color-chrome: var(--sq-bg-1);
  --color-chrome-hover: var(--sq-bg-2);
  --color-chrome-active: var(--sq-bg-2);
  --color-chrome-border: var(--sq-stroke-2);
  --color-chrome-text: var(--sq-text-3);
  --color-chrome-text-active: var(--sq-accent-text);
  --color-accent: var(--sq-accent);
  --color-accent-hover: var(--sq-accent-hover);
  --color-accent-light: var(--sq-accent-soft);
  --color-accent-text: #ffffff;
  --color-text: var(--sq-text-1);
  --color-text-muted: var(--sq-text-3);
  --color-text-inverse: var(--sq-bg-0);
  --color-border: var(--sq-stroke-2);
  --color-border-strong: var(--sq-stroke-3);
  --color-destructive: var(--sq-danger);
  --color-destructive-text: #ffffff;
  --color-success: var(--sq-success);
  --color-warning: var(--sq-warning);
  --color-recording: var(--sq-danger);
  --radius-sm: var(--sq-r-sm);
  --radius-md: var(--sq-r-md);
  --radius-lg: var(--sq-r-lg);
  --radius-xl: var(--sq-r-xl);
  --radius-full: var(--sq-r-pill);
  --sidebar-width: 80px;

  /* ── Compatibility bridge: shadcn semantic var names → --sq-* ── */
  --background: var(--sq-bg-0);
  --foreground: var(--sq-text-1);
  --card: var(--sq-bg-2);
  --card-foreground: var(--sq-text-1);
  --popover: var(--sq-bg-3);
  --popover-foreground: var(--sq-text-1);
  --primary: var(--sq-accent);
  --primary-foreground: #ffffff;
  --secondary: var(--sq-bg-3);
  --secondary-foreground: var(--sq-text-1);
  --muted: var(--sq-bg-4);
  --muted-foreground: var(--sq-text-3);
  --accent: var(--sq-bg-3);
  --accent-foreground: var(--sq-text-1);
  --destructive: var(--sq-danger);
  --border: var(--sq-stroke-2);
  --input: var(--sq-stroke-2);
  --ring: var(--sq-accent-ring);
  --radius: 10px;
  --sidebar: var(--sq-bg-1);
  --sidebar-foreground: var(--sq-text-1);
  --sidebar-primary: var(--sq-accent);
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: var(--sq-accent-soft);
  --sidebar-accent-foreground: var(--sq-accent-text);
  --sidebar-border: var(--sq-stroke-1);
  --sidebar-ring: var(--sq-accent-ring);
  --chart-1: var(--sq-accent);
  --chart-2: var(--sq-violet);
  --chart-3: var(--sq-teal);
  --chart-4: var(--sq-success);
  --chart-5: var(--sq-warning);

  color-scheme: dark;
}

[data-theme="light"] {
  --sq-bg-0: #f6f7fa;
  --sq-bg-1: #ffffff;
  --sq-bg-2: #ffffff;
  --sq-bg-3: #f1f3f8;
  --sq-bg-4: #ecf0f5;
  --sq-bg-overlay: rgba(255, 255, 255, 0.78);

  --sq-stroke-1: rgba(15, 23, 42, 0.06);
  --sq-stroke-2: rgba(15, 23, 42, 0.10);
  --sq-stroke-3: rgba(15, 23, 42, 0.16);

  --sq-text-1: #0e1623;
  --sq-text-2: #455065;
  --sq-text-3: #6a7589;
  --sq-text-4: #98a0b0;

  --sq-accent: #2a5fdb;
  --sq-accent-hover: #1d4fc6;
  --sq-accent-soft: rgba(42, 95, 219, 0.10);
  --sq-accent-ring: rgba(42, 95, 219, 0.25);
  --sq-accent-text: #1d4fc6;

  --sq-success: #1f8a5b;
  --sq-success-soft: rgba(31, 138, 91, 0.10);
  --sq-success-text: #136b46;

  --sq-warning: #b8730b;
  --sq-warning-soft: rgba(184, 115, 11, 0.10);
  --sq-warning-text: #8e5807;

  --sq-danger: #c43c3c;
  --sq-danger-soft: rgba(196, 60, 60, 0.10);
  --sq-danger-text: #962525;

  --sq-info: #1681a3;
  --sq-info-soft: rgba(22, 129, 163, 0.10);
  --sq-info-text: #0f6080;

  --sq-violet: #6e4ed0;
  --sq-violet-soft: rgba(110, 78, 208, 0.10);
  --sq-violet-text: #4f37a0;

  --sq-teal: #0c9b87;
  --sq-teal-soft: rgba(12, 155, 135, 0.10);
  --sq-teal-text: #086c5e;

  --sq-rose: #c93a7c;
  --sq-rose-soft: rgba(201, 58, 124, 0.10);
  --sq-rose-text: #971f5b;

  --sq-shadow-1: 0 1px 2px rgba(15, 23, 42, 0.06);
  --sq-shadow-2: 0 8px 24px rgba(15, 23, 42, 0.08);
  --sq-shadow-3: 0 20px 50px rgba(15, 23, 42, 0.12);

  /* Bridge re-resolves automatically because aliases point at --sq-* */

  color-scheme: light;
}

/* ── Tailwind v4 @theme mapping: expose --sq-* as utilities ── */
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

  --color-sq-success: var(--sq-success);
  --color-sq-success-soft: var(--sq-success-soft);
  --color-sq-success-text: var(--sq-success-text);
  --color-sq-warning: var(--sq-warning);
  --color-sq-warning-soft: var(--sq-warning-soft);
  --color-sq-warning-text: var(--sq-warning-text);
  --color-sq-danger: var(--sq-danger);
  --color-sq-danger-soft: var(--sq-danger-soft);
  --color-sq-danger-text: var(--sq-danger-text);
  --color-sq-info: var(--sq-info);
  --color-sq-info-soft: var(--sq-info-soft);
  --color-sq-info-text: var(--sq-info-text);
  --color-sq-violet: var(--sq-violet);
  --color-sq-violet-soft: var(--sq-violet-soft);
  --color-sq-violet-text: var(--sq-violet-text);
  --color-sq-teal: var(--sq-teal);
  --color-sq-teal-soft: var(--sq-teal-soft);
  --color-sq-teal-text: var(--sq-teal-text);
  --color-sq-rose: var(--sq-rose);
  --color-sq-rose-soft: var(--sq-rose-soft);
  --color-sq-rose-text: var(--sq-rose-text);

  --color-sq-avatar-1: var(--sq-avatar-1);
  --color-sq-avatar-2: var(--sq-avatar-2);
  --color-sq-avatar-3: var(--sq-avatar-3);
  --color-sq-avatar-4: var(--sq-avatar-4);
  --color-sq-avatar-5: var(--sq-avatar-5);
  --color-sq-avatar-6: var(--sq-avatar-6);

  --radius-sq-xs: var(--sq-r-xs);
  --radius-sq-sm: var(--sq-r-sm);
  --radius-sq-md: var(--sq-r-md);
  --radius-sq-lg: var(--sq-r-lg);
  --radius-sq-xl: var(--sq-r-xl);
  --radius-sq-pill: var(--sq-r-pill);

  --shadow-sq-1: var(--sq-shadow-1);
  --shadow-sq-2: var(--sq-shadow-2);
  --shadow-sq-3: var(--sq-shadow-3);

  --font-sans: var(--sq-font-sans);
}

@layer base {
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--sq-bg-0);
    color: var(--sq-text-1);
    font-family: var(--sq-font-sans);
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    transition: background var(--sq-dur-2) var(--sq-easing), color var(--sq-dur-2) var(--sq-easing);
  }
  ::selection { background: var(--sq-accent-soft); color: var(--sq-text-1); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--sq-stroke-2); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
  ::-webkit-scrollbar-thumb:hover { background: var(--sq-stroke-3); background-clip: padding-box; border: 2px solid transparent; }
}
```

This removes: the `@import "@synqed-kk/ui/src/themes/tokens.css"` line, the `@source "../../node_modules/@synqed-kk/ui/dist/..."` line, the `@custom-variant dark` declaration, the entire `oklch`-based `:root`/`.dark` block.

- [ ] **Step 2: Update the theme provider to use `data-theme` attribute**

Edit `src/components/providers/theme-provider.tsx`:

```tsx
'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem={false}
      themes={['dark', 'light']}
    >
      {children}
    </NextThemesProvider>
  )
}
```

The only change is `attribute="class"` → `attribute="data-theme"` and adding `themes={['dark', 'light']}`. `defaultTheme="dark"` is preserved.

- [ ] **Step 3: Verify the build is clean**

Run: `npm run type-check`
Expected: PASS (no type errors)

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: Smoke-test the dev server**

Run: `npm run dev` (in a separate terminal, or background)
Open: `http://localhost:3000/<locale>/karute` (after logging in)
Expected: the page renders. It will look different (new dark palette) but layouts should be intact — sidebar visible, content readable, no flash of unstyled content. The KaruteListView still renders the `@synqed-kk/ui` `KaruteListRow` rows, just in the new colors.

If a specific element renders with no background or unreadable text, that's a missed alias — add it to the bridge and re-verify.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/components/providers/theme-provider.tsx
git commit -m "$(cat <<'EOF'
feat(ui): replace token layer with Synqed-UI --sq-* + alias bridge

Adds the handoff's --sq-* dark/light tokens to globals.css and exposes
them as Tailwind v4 utilities via @theme inline. Aliases legacy
@synqed-kk/ui (--color-*) and shadcn semantic (--background, --card,
--primary, ...) var names to --sq-* equivalents so existing primitives
and screen components keep rendering through the bridge. next-themes
switched from class to data-theme attribute. No component code changed.
EOF
)"
```

---

## Task 2: Add `Icon` component (lucide-react wrapper)

**Files:**
- Create: `src/components/ui/icon.tsx`

**Goal:** A single named-icon wrapper used by the new Sidebar and KaruteListView. Only the icons phase 1 actually consumes are mapped — no speculative mapping.

- [ ] **Step 1: Create the file**

Write `src/components/ui/icon.tsx`:

```tsx
import * as React from 'react'
import {
  AlertTriangle,
  Bell,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clipboard,
  Clock,
  FileText,
  GraduationCap,
  Home,
  Mic,
  Plus,
  Search,
  Settings,
  Sparkles,
  Upload,
  Users,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react'

const ICONS = {
  alert: AlertTriangle,
  bell: Bell,
  calendar: Calendar,
  cap: GraduationCap,
  chevDown: ChevronDown,
  chevLeft: ChevronLeft,
  chevRight: ChevronRight,
  chevUp: ChevronUp,
  clipboard: Clipboard,
  clock: Clock,
  fileText: FileText,
  home: Home,
  mic: Mic,
  plus: Plus,
  search: Search,
  settings: Settings,
  sparkle: Sparkles,
  upload: Upload,
  users: Users,
} as const satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

interface IconProps extends Omit<LucideProps, 'ref'> {
  name: IconName
}

export function Icon({ name, size = 16, strokeWidth = 1.75, ...props }: IconProps) {
  const Component = ICONS[name]
  return <Component size={size} strokeWidth={strokeWidth} aria-hidden {...props} />
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/icon.tsx
git commit -m "feat(ui): add Icon component (lucide-react wrapper)"
```

---

## Task 3: Add `Card` component

**Files:**
- Create: `src/components/ui/card.tsx`

**Goal:** A surface primitive matching the handoff Card — `bg-sq-bg-2` with `border-sq-stroke-1` and `rounded-sq-lg`. Optional `interactive` variant for clickable rows. Optional `accent` prop showing a left-edge accent ramp color.

- [ ] **Step 1: Create the file**

Write `src/components/ui/card.tsx`:

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const cardVariants = cva(
  'relative rounded-sq-lg border border-sq-stroke-1 bg-sq-bg-2 shadow-sq-1 transition-colors',
  {
    variants: {
      interactive: {
        true: 'cursor-pointer hover:bg-sq-bg-3 hover:border-sq-stroke-2',
        false: '',
      },
    },
    defaultVariants: {
      interactive: false,
    },
  },
)

const ACCENT_VAR: Record<NonNullable<CardProps['accent']>, string> = {
  accent: 'var(--sq-accent)',
  success: 'var(--sq-success)',
  warning: 'var(--sq-warning)',
  danger: 'var(--sq-danger)',
  info: 'var(--sq-info)',
  violet: 'var(--sq-violet)',
  teal: 'var(--sq-teal)',
  rose: 'var(--sq-rose)',
}

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  accent?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'teal' | 'rose'
}

export function Card({ className, interactive, accent, style, children, ...props }: CardProps) {
  const accentStyle = accent
    ? {
        ...style,
        boxShadow: `inset 3px 0 0 0 ${ACCENT_VAR[accent]}`,
      }
    : style
  return (
    <div className={cn(cardVariants({ interactive }), className)} style={accentStyle} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between px-6 pt-5 pb-3', className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pb-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-end gap-2 border-t border-sq-stroke-1 px-6 py-3', className)} {...props} />
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/card.tsx
git commit -m "feat(ui): add Card primitive (Synqed-UI tokens, accent variant)"
```

---

## Task 4: Add `Badge` component

**Files:**
- Create: `src/components/ui/badge.tsx`

**Goal:** Pill-shaped status badge with 9 tone variants. Used in KaruteListView for AI-status badges.

- [ ] **Step 1: Create the file**

Write `src/components/ui/badge.tsx`:

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { Icon, type IconName } from './icon'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sq-pill font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        accent: 'bg-sq-accent-soft text-sq-accent-text',
        success: 'bg-sq-success-soft text-sq-success-text',
        warning: 'bg-sq-warning-soft text-sq-warning-text',
        danger: 'bg-sq-danger-soft text-sq-danger-text',
        info: 'bg-sq-info-soft text-sq-info-text',
        violet: 'bg-sq-violet-soft text-sq-violet-text',
        teal: 'bg-sq-teal-soft text-sq-teal-text',
        rose: 'bg-sq-rose-soft text-sq-rose-text',
        neutral: 'bg-sq-bg-3 text-sq-text-2',
      },
      size: {
        xs: 'px-2 py-0.5 text-[10px]',
        sm: 'px-2.5 py-1 text-xs',
        md: 'px-3 py-1.5 text-sm',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      size: 'sm',
    },
  },
)

const ICON_SIZE = { xs: 10, sm: 12, md: 14 } as const

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  icon?: IconName
}

export function Badge({ className, tone, size, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {icon ? <Icon name={icon} size={ICON_SIZE[size ?? 'sm']} /> : null}
      {children}
    </span>
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/badge.tsx
git commit -m "feat(ui): add Badge primitive (9 tones, optional leading icon)"
```

---

## Task 5: Add `Chip` component

**Files:**
- Create: `src/components/ui/chip.tsx`

**Goal:** Pill-shaped filter / staff chip with active state. Used for filter pills and the staff filter row in KaruteListView.

- [ ] **Step 1: Create the file**

Write `src/components/ui/chip.tsx`:

```tsx
import * as React from 'react'

import { cn } from '@/lib/utils'

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  count?: number
  leading?: React.ReactNode
}

export function Chip({ active, count, leading, className, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      data-active={active ? 'true' : undefined}
      className={cn(
        'inline-flex items-center gap-2 rounded-sq-pill border px-4 py-2 text-[13px] font-medium transition-colors',
        active
          ? 'border-sq-accent-ring bg-sq-accent-soft text-sq-accent-text'
          : 'border-sq-stroke-1 bg-sq-bg-2 text-sq-text-2 hover:border-sq-stroke-2 hover:text-sq-text-1',
        className,
      )}
      {...props}
    >
      {leading}
      <span>{children}</span>
      {typeof count === 'number' ? (
        <span
          className={cn(
            'ml-0.5 rounded-sq-pill px-1.5 py-0.5 text-[11px]',
            active ? 'bg-sq-accent-ring text-sq-accent-text' : 'bg-sq-bg-3 text-sq-text-3',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/chip.tsx
git commit -m "feat(ui): add Chip primitive (filter/staff pill with count)"
```

---

## Task 6: Rewrite `Sidebar` to match handoff layout

**Files:**
- Modify: `src/components/layout/sidebar.tsx` (full rewrite)

**Goal:** Replace the 80px icon rail with a full-width sidebar (labels + icons, accent active state, fixed width per prototype). Uses the new `Icon` component instead of inline SVG functions.

- [ ] **Step 1: Read the handoff Sidebar for visual reference**

Read `/tmp/synq-handoff/synq/project/synqed-ui.jsx` and locate the `Sidebar` function (search for `function Sidebar`). Note the structure: vertical column, nav items with `Icon + label`, active item highlighted with `bg-sq-accent-soft text-sq-accent-text`, user identity tile pinned at bottom.

- [ ] **Step 2: Rewrite the file**

Replace `src/components/layout/sidebar.tsx` with:

```tsx
'use client'

import React, { useState, useEffect, useRef } from 'react'
import { usePathname, Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'

import { Icon, type IconName } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

type SidebarLabelKey =
  | 'recording'
  | 'dashboard'
  | 'appointments'
  | 'customers'
  | 'karute'
  | 'askAi'
  | 'dataImport'
  | 'settings'

interface NavRoute {
  id: string
  href: string
  labelKey: SidebarLabelKey
  icon: IconName
}

const NAV_ROUTES: NavRoute[] = [
  { id: 'recording', href: '/sessions', labelKey: 'recording', icon: 'mic' },
  { id: 'dashboard', href: '/dashboard', labelKey: 'dashboard', icon: 'home' },
  { id: 'appointments', href: '/appointments', labelKey: 'appointments', icon: 'calendar' },
  { id: 'customers', href: '/customers', labelKey: 'customers', icon: 'users' },
  { id: 'karute', href: '/karute', labelKey: 'karute', icon: 'clipboard' },
  { id: 'askAi', href: '/ask-ai', labelKey: 'askAi', icon: 'sparkle' },
  { id: 'dataImport', href: '/data-import', labelKey: 'dataImport', icon: 'upload' },
  { id: 'settings', href: '/settings', labelKey: 'settings', icon: 'settings' },
]

const LABEL_FALLBACKS: Record<SidebarLabelKey, string> = {
  recording: 'Recording',
  dashboard: 'Dashboard',
  appointments: 'Appointments',
  customers: 'Customers',
  karute: 'Karute',
  askAi: 'Ask AI',
  dataImport: 'Import',
  settings: 'Settings',
}

const SWIPE_THRESHOLD = 50
const EDGE_ZONE = 30

export function Sidebar() {
  const pathname = usePathname()
  const t = useTranslations('sidebar')
  const activeId = NAV_ROUTES.find((r) => pathname.startsWith(r.href))?.id
  const [mobileOpen, setMobileOpen] = useState(false)

  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const swiping = useRef(false)

  function getLabel(key: SidebarLabelKey): string {
    try {
      return t(key)
    } catch {
      return LABEL_FALLBACKS[key]
    }
  }

  useEffect(() => {
    function handleTouchStart(e: TouchEvent) {
      const touch = e.touches[0]
      touchStartX.current = touch.clientX
      touchStartY.current = touch.clientY
      swiping.current = false
    }
    function handleTouchMove(e: TouchEvent) {
      const touch = e.touches[0]
      const dx = touch.clientX - touchStartX.current
      const dy = touch.clientY - touchStartY.current
      if (Math.abs(dy) > Math.abs(dx)) return
      if (Math.abs(dx) < 10) return
      swiping.current = true
    }
    function handleTouchEnd(e: TouchEvent) {
      if (!swiping.current) return
      const touch = e.changedTouches[0]
      const dx = touch.clientX - touchStartX.current
      if (!mobileOpen && dx > SWIPE_THRESHOLD && touchStartX.current < EDGE_ZONE) {
        setMobileOpen(true)
      } else if (mobileOpen && dx < -SWIPE_THRESHOLD) {
        setMobileOpen(false)
      }
      swiping.current = false
    }
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [mobileOpen])

  return (
    <>
      {!mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="fixed top-5 left-4 z-40 flex h-10 w-10 items-center justify-center rounded-sq-md bg-sq-bg-2 text-sq-text-2 shadow-sq-2 sm:hidden"
          aria-label="Open menu"
        >
          <Icon name="chevRight" size={20} />
        </button>
      )}

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 sm:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <nav
        className={cn(
          'flex h-full w-[220px] flex-col rounded-sq-lg border border-sq-stroke-1 bg-sq-bg-1 py-4',
          'max-sm:fixed max-sm:left-0 max-sm:top-0 max-sm:z-50 max-sm:h-screen max-sm:rounded-none max-sm:transition-transform max-sm:duration-200',
          mobileOpen ? 'max-sm:translate-x-0' : 'max-sm:-translate-x-full',
        )}
        aria-label="Main navigation"
      >
        <div className="flex flex-col gap-0.5 px-3">
          {NAV_ROUTES.map((route) => {
            const isActive = route.id === activeId
            return (
              <Link
                key={route.id}
                href={route.href as Parameters<typeof Link>[0]['href']}
                onClick={() => setMobileOpen(false)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-sq-md px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sq-accent-soft text-sq-accent-text'
                    : 'text-sq-text-2 hover:bg-sq-bg-2 hover:text-sq-text-1',
                )}
              >
                <Icon name={route.icon} size={18} />
                <span className="truncate">{getLabel(route.labelKey)}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run type-check`
Expected: PASS

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: Manually smoke-test the sidebar**

With `npm run dev` running, navigate to `/<locale>/karute`. Confirm:
- Sidebar is ~220px wide (not 90px), shows label text next to each icon.
- Clicking each item navigates to that route.
- Active item has accent background (`bg-sq-accent-soft`) and accent text.
- Mobile (< sm): hamburger button shows; swipe-from-edge opens the sidebar.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat(layout): rewrite Sidebar with Synqed-UI tokens + labels"
```

---

## Task 7: Update app frame to use Synqed-UI surfaces

**Files:**
- Modify: `src/app/[locale]/(app)/layout.tsx`

**Goal:** Replace hardcoded gray literals (`bg-[#e8e8e8]`, `dark:bg-[#2a2a2a]`, `bg-[#e0e0e0]`, `dark:bg-[#3a3a3a]`) with the Synqed-UI surface ramp.

- [ ] **Step 1: Edit the frame**

In `src/app/[locale]/(app)/layout.tsx`, find the return block (lines 54–73). Replace its outer-most `<div>` and the rounded `<main>` element with:

```tsx
return (
  <SessionProvider data={sessionData}>
    <div className="flex h-screen flex-col overflow-hidden bg-sq-bg-0 p-3">
      <div className="flex items-center py-1" style={{ height: '72px' }}>
        <img src="/karute_logo.png" alt="Karute" className="h-14 object-contain dark:invert" style={{ height: '100px' }} />
        <div className="ml-auto flex items-center">
          <TopBar />
          <StaffSwitcher staffList={staffItems} activeStaff={activeStaff} authProfileId={user.id} />
        </div>
      </div>
      <div className="flex flex-1 gap-3 min-h-0 overflow-hidden">
        <div className="relative max-sm:w-0">
          <Sidebar />
        </div>
        <main className="relative flex-1 overflow-y-auto rounded-sq-lg border border-sq-stroke-1 bg-sq-bg-1">
          <div className="mx-auto max-w-7xl p-4 md:p-6">
            {children}
          </div>
        </main>
      </div>
      <MiniRecorder />
      <AIChatFAB locale={locale} />
    </div>
  </SessionProvider>
)
```

Changes from the existing file:
- `bg-[#e8e8e8] p-3 dark:bg-[#2a2a2a]` → `bg-sq-bg-0 p-3` (the outer page background, theme-driven through `--sq-bg-0` which already flips for light/dark via `[data-theme]`).
- `bg-[#e0e0e0] dark:bg-[#3a3a3a]` and `rounded-[28px]` on `<main>` → `rounded-sq-lg border border-sq-stroke-1 bg-sq-bg-1`.

Leave the logo + TopBar + StaffSwitcher header row, MiniRecorder, AIChatFAB unchanged.

- [ ] **Step 2: Verify the build**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 3: Smoke-test the frame**

With dev server running, navigate to `/<locale>/karute`. Confirm:
- Outer page is `--sq-bg-0` (very dark, near-black).
- Main content panel is `--sq-bg-1` (slightly lighter than page).
- Both flip to light surfaces when the theme toggle is clicked.
- Logo and top bar render at the top.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/(app)/layout.tsx"
git commit -m "feat(layout): drop hardcoded grays in app frame for --sq-bg ramp"
```

---

## Task 8: Redesign `KaruteListView` against new primitives

**Files:**
- Modify: `src/components/karute/KaruteListView.tsx` (full rewrite)

**Goal:** Stop importing screen components from `@synqed-kk/ui`. Render the karute list as in the prototype's `KaruteScreen`: page header with title + meta + CTA, search input, filter pill row, grouped list with day-headers and Card rows. Wire to existing `karuteRecordsToRowData` shape — no data flow changes. Fields not present in our data (`staffName`, `service`, `duration`) are rendered as `'—'` rather than omitted, so the row grid stays consistent.

- [ ] **Step 1: Visual reference**

Read `/tmp/synq-handoff/synq/project/screens.jsx` lines 405–490 (`KaruteScreen`). The grid columns we render: date | avatar | name + summary | service/meta | badge | staff. Day-header rows separate groups of records by `formatShortDate(created_at)`.

- [ ] **Step 2: Rewrite the file**

Replace `src/components/karute/KaruteListView.tsx` with:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { Link } from '@/i18n/navigation'
import type { KaruteListRowData } from '@synqed-kk/ui'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Chip } from '@/components/ui/chip'
import { Icon } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'

interface KaruteListViewProps {
  rows: KaruteListRowData[]
}

interface DayGroup {
  date: string
  weekday: string
  count: number
  rows: KaruteListRowData[]
}

function groupByDay(rows: KaruteListRowData[]): DayGroup[] {
  const map = new Map<string, DayGroup>()
  for (const r of rows) {
    const key = r.dateDisplay
    const existing = map.get(key)
    if (existing) {
      existing.rows.push(r)
      existing.count += 1
    } else {
      map.set(key, { date: r.dateDisplay, weekday: r.weekday, count: 1, rows: [r] })
    }
  }
  return [...map.values()]
}

type AiTone = 'success' | 'warning' | 'danger' | 'accent'

function aiTone(row: KaruteListRowData): AiTone {
  switch (row.aiStatusTone) {
    case 'summarized':
      return 'success'
    case 'pending':
      return 'warning'
    case 'review':
      return 'danger'
    default:
      return 'accent'
  }
}

const AVATAR_PALETTE = [
  'bg-sq-info-soft text-sq-info-text',
  'bg-sq-violet-soft text-sq-violet-text',
  'bg-sq-success-soft text-sq-success-text',
  'bg-sq-warning-soft text-sq-warning-text',
  'bg-sq-rose-soft text-sq-rose-text',
  'bg-sq-teal-soft text-sq-teal-text',
] as const

function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}

export function KaruteListView({ rows }: KaruteListViewProps) {
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending'>('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = rows
    if (q) {
      out = out.filter(
        (r) =>
          r.customerName.toLowerCase().includes(q) ||
          r.summary.toLowerCase().includes(q),
      )
    }
    if (activeFilter === 'pending') {
      out = out.filter((r) => r.aiStatusTone === 'pending')
    }
    return out
  }, [rows, search, activeFilter])

  const groups = useMemo(() => groupByDay(filtered), [filtered])
  const pendingCount = rows.filter((r) => r.aiStatusTone === 'pending').length

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-sq-text-1">カルテ</h1>
          <p className="mt-1 text-sm text-sq-text-3">{rows.length}件のカルテを表示中</p>
        </div>
        <Button>
          <Icon name="fileText" size={14} />
          新規カルテ
        </Button>
      </header>

      <label className="relative block">
        <span className="sr-only">Search</span>
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sq-text-3"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="顧客名・サマリで検索…"
          className="h-12 w-full rounded-sq-md border border-sq-stroke-2 bg-sq-bg-2 pl-11 pr-4 text-sm text-sq-text-1 placeholder:text-sq-text-4 outline-none transition-colors focus:border-sq-accent focus:ring-2 focus:ring-sq-accent-ring"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={activeFilter === 'all'} count={rows.length} onClick={() => setActiveFilter('all')}>
          すべて
        </Chip>
        <Chip
          active={activeFilter === 'pending'}
          count={pendingCount}
          onClick={() => setActiveFilter('pending')}
        >
          AI補完待ち
        </Chip>
      </div>

      {groups.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm text-sq-text-3">該当するカルテがありません</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {groups.map((g) => (
            <section key={g.date} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2 px-1 pt-3 pb-1 text-xs text-sq-text-3">
                <span>
                  {g.date} ({g.weekday})
                </span>
                <span>·</span>
                <span>{g.count}件のカルテ</span>
              </div>
              {g.rows.map((row) => (
                <Link
                  key={row.id}
                  href={`/karute/${row.id}` as Parameters<typeof Link>[0]['href']}
                  className="block"
                >
                  <Card interactive className="grid grid-cols-[84px_44px_minmax(0,1.6fr)_minmax(0,1.3fr)_auto] items-center gap-4 px-5 py-4">
                    <div>
                      <div className="text-base font-semibold text-sq-text-1">{row.dateDisplay}</div>
                      <div className="mt-0.5 text-[11px] text-sq-text-3">{row.weekday}</div>
                    </div>
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-sq-pill text-sm font-semibold ${avatarColor(row.id)}`}
                    >
                      {row.customerInitials}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm text-sq-text-1">
                        <strong className="font-semibold">{row.customerName}</strong>
                        <span className="ml-1 font-normal text-sq-text-3">#{row.id.slice(0, 8)}</span>
                      </div>
                      <div className="mt-1 truncate text-[12.5px] text-sq-text-3">{row.summary}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] text-sq-text-1">{row.service}</div>
                      <div className="mt-1 text-[11.5px] text-sq-text-3">
                        {row.duration}分 · {row.entryCount}件のエントリー
                      </div>
                    </div>
                    <Badge
                      tone={aiTone(row)}
                      icon={row.aiStatusTone === 'pending' ? 'clock' : row.aiStatusTone === 'review' ? 'alert' : 'sparkle'}
                      size="sm"
                    >
                      {row.aiStatusLabel}
                    </Badge>
                  </Card>
                </Link>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
```

Notes on the rewrite:
- Drops `@synqed-kk/ui` imports for screen components (only the `KaruteListRowData` type is still imported, since that's what the existing adapter produces).
- Drops the `KaruteListFilterBar`, `KaruteListPageHeader`, `KaruteListRow`, `ErrorState`, `KaruteListFilter` imports.
- The grid drops the prototype's 6th column (staff) because `staffName` is `'—'` in our data — keeping it visible would just show empty space. The prototype's full column layout is restored in a later phase once staff assignment data flows in.
- Empty state uses a simple Card, not `ErrorState`.

- [ ] **Step 3: Verify the build**

Run: `npm run type-check`
Expected: PASS

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: Smoke-test the karute screen**

With dev server running, navigate to `/<locale>/karute`. Confirm:
- Page header shows title + record count + "新規カルテ" button.
- Search input is visible with leading magnifier icon.
- "すべて" and "AI補完待ち" chips render with counts; clicking toggles active state.
- List shows day-header rows ("MM/DD (Weekday) · N件のカルテ") above grouped Card rows.
- Each Card row shows: date column, avatar initials in a colored circle, customer name + summary, service/duration/entries, AI status badge.
- Clicking a Card navigates to `/karute/<id>`.

- [ ] **Step 5: Commit**

```bash
git add src/components/karute/KaruteListView.tsx
git commit -m "$(cat <<'EOF'
feat(karute): redesign list view against Synqed-UI primitives

Stops importing screen components from @synqed-kk/ui and renders the
karute list using the new Card, Badge, Chip, and Icon primitives. Layout
matches synq/project/screens.jsx KaruteScreen: page header + search +
filter chips + day-grouped Card rows. Existing data flow
(karuteRecordsToRowData) is unchanged.
EOF
)"
```

---

## Task 9: Phase 1 verification walk + final commit

**Files:**
- Modify (if needed): any file revealed as broken during the walk.

**Goal:** Confirm the verification gate from the spec. Walk every screen, run the full build, document anything that needed correction.

- [ ] **Step 1: Run the full build pipeline**

Run: `npm run type-check && npm run lint && npm test`
Expected: all three pass.

- [ ] **Step 2: Walk every screen**

With `npm run dev` running and logged in, navigate to each of the following in turn and confirm the page renders, content is readable, and no obvious layout breakage (overflow, clipped controls, unreadable contrast, blank backgrounds):
- `/<locale>/sessions` (recording)
- `/<locale>/dashboard`
- `/<locale>/appointments`
- `/<locale>/customers`
- `/<locale>/customers/<some-id>` (customer detail)
- `/<locale>/karute` (redesigned in Task 8 — should match the prototype layout)
- `/<locale>/karute/<some-id>` (karute detail — `KaruteDetailSpikeView`; uses bridge, layout unchanged)
- `/<locale>/ask-ai`
- `/<locale>/data-import`
- `/<locale>/settings`

Then toggle theme dark ↔ light using the toggle in the top bar. Confirm:
- Every screen flips palette cleanly.
- No flash of unstyled content.
- No element ends up with white-on-white or black-on-black contrast.

- [ ] **Step 3: Fix any bridge gaps**

If a screen rendered with a clearly-broken color (e.g. a button background reads as transparent, contrast is unreadable), open browser DevTools and inspect the element. Look at its `background` or `color` computed-style values — if the value is `unset`, `inherit`, or an unexpected fallback, the underlying CSS var is not aliased. Add the missing alias to the bridge in `src/app/globals.css` and re-verify that screen.

The bridge is intentionally a single source of truth — fixes to bridge gaps belong in `globals.css`, not in individual component files.

If a screen is broken in a way that is not a missing alias (e.g. real layout overflow), apply the **minimum correction** to that screen's file to restore usability — not a redesign — and note the file in the commit message.

- [ ] **Step 4: Commit verification fixes (if any)**

If Step 3 required edits:

```bash
git add <files-edited>
git commit -m "fix(ui): close phase 1 bridge gaps / minimum-correction fixups"
```

If no fixes were needed, skip this step.

- [ ] **Step 5: Phase 1 complete**

The verification gate from the spec is satisfied:
- `npm run type-check`, `npm run lint`, `npm test` pass
- All 8 existing screens render and remain usable
- `/karute` matches the redesigned prototype layout
- Theme toggle flips cleanly

The branch is ready for the user's review.

---

## Self-review notes

Reviewing against the spec sections:

- **Tokens layer:** Task 1 covers token block, bridge, `@theme inline`, body base styles, removal of legacy imports, `@custom-variant dark` removal. ✓
- **Theme switching:** Task 1 Step 2 switches `next-themes` attribute. ✓
- **New primitives:** Tasks 2–5 add `Icon`, `Card`, `Badge`, `Chip`. Tabs and Segmented deferred (spec also defers them). ✓
- **App shell:** Tasks 6 + 7 cover Sidebar rewrite and app-layout frame. TopBar restyle not given its own task because the only change is its visual context (it already uses semantic classes which the bridge handles) — if any TopBar element looks broken in the Task 9 walk, the bridge gap is fixed there.
- **Karute screen:** Task 8. ✓
- **Verification gate:** Task 9. ✓

Reviewing for placeholders: no "TBD" / "implement later" / "fill in details" patterns. Every code block is complete and executable.

Reviewing for type consistency: `IconName` exported from `icon.tsx` is consumed by `Badge` (Task 4) and `Sidebar` (Task 6). `KaruteListRowData` type imported from `@synqed-kk/ui` is preserved (the existing adapter produces it).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-synqed-ui-foundation-and-karute-screen.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.
