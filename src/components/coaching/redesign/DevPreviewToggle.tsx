'use client'

// ─────────────────────────────────────────────────────────────
// DevPreviewToggle — floating role-override pill
// ─────────────────────────────────────────────────────────────
// Renders ONLY when the dev preview env gate is on (see
// src/lib/coaching-dev-preview/hooks.ts isDevPreviewEnabled).
// In production builds with the env var unset, the toggle
// tree-shakes out entirely.
//
// LAYOUT
//
// Fixed-position pill, lower right, above the bottom-nav.
// Three buttons: Real / Owner / Staff. Tapping Real clears the
// override and reverts to the session-derived role.
//
// PRIVACY NOTE FOR THE USER
//
// The pill explicitly labels itself "Dev preview" and shows the
// REAL session role next to the override choice. A developer
// previewing as staff still sees data scoped to their own
// session — the API does not loosen. The pill is a render-shell
// override only.

import { Eye, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  isDevPreviewEnabled,
  useDevPreviewMutations,
  useDevPreviewRoleOverride,
} from '@/lib/coaching-dev-preview/hooks'
import type { CoachingRole } from '@/lib/coaching-dev-preview/types'

interface DevPreviewToggleProps {
  /** The session-derived role from the server page. Shown in
   *  the chip so the developer always knows what their real
   *  identity is. */
  realRole: CoachingRole
}

export function DevPreviewToggle({ realRole }: DevPreviewToggleProps) {
  const t = useTranslations('coaching.devPreview')
  const override = useDevPreviewRoleOverride()
  const { setOverride, clear } = useDevPreviewMutations()

  // Env gate: short-circuit before any render. The check is
  // a build-time constant so prod tree-shakes the whole pill.
  if (!isDevPreviewEnabled()) return null

  const effective = override ?? realRole

  return (
    <div
      className="fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-full border border-purple-300/60 bg-purple-50/95 px-3 py-2 shadow-lg backdrop-blur dark:border-purple-500/40 dark:bg-purple-950/90 md:bottom-4"
      role="region"
      aria-label={t('regionLabel')}
    >
      <Eye
        className="size-3.5 shrink-0 text-purple-700 dark:text-purple-300"
        aria-hidden
      />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-purple-900 dark:text-purple-200">
        {t('label')}
      </span>

      <div className="flex items-center gap-1">
        <PreviewButton
          active={override === null}
          onClick={() => clear()}
          label={t('asReal', { role: t(`role.${realRole}`) })}
        />
        <PreviewButton
          active={override === 'owner'}
          onClick={() => setOverride('owner')}
          label={t('role.owner')}
        />
        <PreviewButton
          active={override === 'staff'}
          onClick={() => setOverride('staff')}
          label={t('role.staff')}
        />
      </div>

      {override !== null && (
        <button
          type="button"
          onClick={() => clear()}
          className="ml-1 inline-flex size-5 items-center justify-center rounded-full text-purple-700 hover:bg-purple-200/60 dark:text-purple-200 dark:hover:bg-purple-800/40"
          aria-label={t('clearAria')}
        >
          <X className="size-3" aria-hidden />
        </button>
      )}

      <span className="sr-only">{t('renderingAs', { role: effective })}</span>
    </div>
  )
}

function PreviewButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium transition-colors ${
        active
          ? 'bg-purple-600 text-white'
          : 'text-purple-800 hover:bg-purple-200/60 dark:text-purple-200 dark:hover:bg-purple-800/40'
      }`}
    >
      {label}
    </button>
  )
}
