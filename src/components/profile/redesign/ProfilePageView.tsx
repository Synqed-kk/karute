'use client'

// ─────────────────────────────────────────────────────────────
// /profile — "me" surface for the signed-in user
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: src/app/[locale]/(app)/profile/page.tsx
// (full file, ~290 lines).
//
// Visual + flow preserved 1:1 except:
//   • Demo-only CoachingRoleToggle section omitted (per spike's
//     own ANTHONY comment — toggle was scaffolding for the spike
//     preview; karute derives role from session.activeStaff
//     server-side).
//   • Activity stats render em-dash placeholders + 対応予定
//     scaffold pill until Anthony wires the MTD aggregate
//     queries — no fake data per the karute project's rule.
//   • Logout reuses the karute sidebar's signOut pattern.
//
// PRIVACY POSTURE (preserved from spike header):
//   Entire page is Layer 1 — staff-private. An owner visiting
//   /profile sees THEIR OWN profile, not another staff member's.
//   Backend RLS requirement: staff row + stats queries MUST
//   filter by staff_id = auth.uid().

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  ArrowRight,
  Building2,
  GraduationCap,
  LogOut,
  Mic,
  Settings as SettingsIcon,
  Shield,
  UserCheck,
  Users as UsersIcon,
  Wand2,
} from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { wipeSessionVault } from '@/lib/karute/logout-wipe'
import { WebOnly } from '@/components/shell/WebOnly'

export interface ProfilePageProfile {
  name: string
  initials: string
  email: string
  role: 'owner' | 'staff'
  /** Display label per locale — e.g. 'オーナー' / 'Owner'. */
  roleLabel: { ja: string; en: string }
  /** Primary store / salon name per locale. */
  storeName: { ja: string; en: string }
}

interface ProfilePageViewProps {
  profile: ProfilePageProfile
}

export function ProfilePageView({ profile }: ProfilePageViewProps) {
  const t = useTranslations('profile')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [signingOut, setSigningOut] = useState(false)

  const isStaff = profile.role === 'staff'
  const roleLabel = locale === 'en' ? profile.roleLabel.en : profile.roleLabel.ja
  const storeName = locale === 'en' ? profile.storeName.en : profile.storeName.ja

  function handleLanguageChange(next: 'ja' | 'en') {
    if (next === locale) return
    // Pathname-based locale swap — karute uses /[locale]/(app)/...
    // routing, so swapping the first path segment changes the
    // active locale without losing the current screen.
    const segments = pathname.split('/')
    if (segments[1] === 'ja' || segments[1] === 'en') {
      segments[1] = next
      router.push(segments.join('/'))
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    try {
      // Shared-device privacy: one wipe for singletons + draft + takes
      // (see lib/karute/logout-wipe for why the in-memory half matters).
      // Best-effort — a wipe failure must never block signOut (see sidebar).
      await wipeSessionVault().catch(() => {})
      const supabase = createClient()
      await supabase.auth.signOut()
      // Locale-prefixed: this page uses next/navigation's router (the language
      // swapper above needs the locale in the path), so prefix manually here —
      // otherwise logout lands on /login (no locale) → 404.
      router.push(`/${locale}/login`)
      router.refresh()
    } catch {
      setSigningOut(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-[720px] space-y-5 px-4 py-5 md:px-8 md:py-8">
      {/* Desktop title (mobile gets it from the sidebar/menu). */}
      <div className="hidden md:block">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('pageSubtitle')}
        </p>
      </div>

      {/* Account card */}
      <section className="border-b border-black/5 bg-card p-4 dark:border-white/5 md:rounded-xl md:border-0 md:p-5 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:ring-1 md:ring-black/5 md:dark:shadow-none md:dark:ring-white/5">
        <div className="flex items-start gap-3">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-foreground text-base font-semibold text-background ring-1 ring-black/5 dark:bg-white/[0.08] dark:text-foreground dark:ring-white/10">
            {profile.initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold text-foreground">
              {profile.name}
            </div>
            <div className="truncate text-[12px] text-muted-foreground">
              {roleLabel}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Building2 className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{storeName}</span>
            </div>
            <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
              {profile.email}
            </div>
          </div>
        </div>
      </section>

      {/* Activity — staff only. Owner's "sessions" count is 0 by design
       *  (owners don't run sessions), so the section hides for them. */}
      {isStaff && (
        <section className="border-b border-black/5 bg-card p-4 dark:border-white/5 md:rounded-xl md:border-0 md:p-5 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:ring-1 md:ring-black/5 md:dark:shadow-none md:dark:ring-white/5">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('activitySection')}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              icon={<UserCheck className="size-3.5 text-blue-600 dark:text-blue-300" />}
              label={t('statSessionsMonth')}
              value="—"
            />
            <StatTile
              icon={<Mic className="size-3.5 text-rose-600 dark:text-rose-300" />}
              label={t('statRecordingsMonth')}
              value="—"
            />
            <StatTile
              icon={<Shield className="size-3.5 text-green-600 dark:text-green-300" />}
              label={t('statConsentRate')}
              value="—"
            />
            <StatTile
              icon={<UsersIcon className="size-3.5 text-indigo-600 dark:text-indigo-300" />}
              label={t('statUniqueCustomers')}
              value="—"
            />
          </div>

          {/* 対応予定 hint — explains the em-dash placeholders so an
           *  empty stat strip doesn't read as "you had zero sessions
           *  this month" but as "data layer not wired yet". */}
          <div className="mt-3 flex gap-2 rounded-lg border border-dashed border-blue-300/60 bg-blue-50/40 p-3 dark:border-blue-500/30 dark:bg-blue-500/[0.06]">
            <Wand2
              className="mt-0.5 size-3 shrink-0 text-blue-500/80 dark:text-blue-300/80"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="mb-1 inline-flex items-center">
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  {t('scaffoldLabel')}
                </span>
              </div>
              <p className="text-[11px] italic leading-relaxed text-muted-foreground">
                {t('activityScaffoldBody')}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Quick links */}
      <section className="overflow-hidden border-b border-black/5 bg-card dark:border-white/5 md:rounded-xl md:border-0 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:ring-1 md:ring-black/5 md:dark:shadow-none md:dark:ring-white/5">
        <h2 className="px-4 pt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:px-5 md:pt-5">
          {t('quickLinksSection')}
        </h2>
        <div className="mt-2 divide-y divide-black/5 dark:divide-white/5">
          {isStaff && (
            <QuickLink
              href={`/${locale}/coaching/growth`}
              icon={<GraduationCap className="size-4 text-indigo-600 dark:text-indigo-300" />}
              label={t('linkMyGrowth')}
            />
          )}
          <QuickLink
            href={`/${locale}/coaching/data`}
            icon={<Shield className="size-4 text-slate-600 dark:text-slate-300" />}
            label={t('linkMyData')}
          />
          <QuickLink
            href={`/${locale}/settings`}
            icon={<SettingsIcon className="size-4 text-slate-600 dark:text-slate-300" />}
            label={t('linkOpenSettings')}
          />
        </div>
      </section>

      {/* Preferences — inline language toggle. Web-only (WebOnly, the same
       *  gate the plan-change CTA uses in StoresSection.tsx): the thin shell
       *  is a single-locale bundle with no second path segment to swap into,
       *  so the toggle is meaningless there. Web behavior is unchanged. */}
      <WebOnly>
        <section className="border-b border-black/5 bg-card p-4 dark:border-white/5 md:rounded-xl md:border-0 md:p-5 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:ring-1 md:ring-black/5 md:dark:shadow-none md:dark:ring-white/5">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('preferencesSection')}
          </h2>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[14px] text-foreground">{t('languageLabel')}</div>
            <div className="inline-flex items-center rounded-lg bg-gray-100 p-0.5 ring-1 ring-black/5 dark:bg-white/[0.04] dark:ring-white/10">
              <button
                type="button"
                onClick={() => handleLanguageChange('ja')}
                className={`inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium transition-colors ${
                  locale === 'ja'
                    ? 'bg-card text-foreground shadow-sm dark:ring-1 dark:ring-white/10'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
                aria-pressed={locale === 'ja'}
              >
                {t('languageJa')}
              </button>
              <button
                type="button"
                onClick={() => handleLanguageChange('en')}
                className={`inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium transition-colors ${
                  locale === 'en'
                    ? 'bg-card text-foreground shadow-sm dark:ring-1 dark:ring-white/10'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
                aria-pressed={locale === 'en'}
              >
                {t('languageEn')}
              </button>
            </div>
          </div>
        </section>
      </WebOnly>

      {/* Log out */}
      <section className="px-4 md:px-5">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-card font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10"
        >
          <LogOut className="size-4" />
          {signingOut ? t('logoutPending') : t('logoutButton')}
        </button>
      </section>

      {/* Version footer */}
      <footer className="pt-2 text-center text-[11px] tabular-nums text-muted-foreground">
        SYNQED Karute · {t('versionLabel')} 0.1.0
      </footer>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────
// Local helpers
// ─────────────────────────────────────────────────────────────

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.03]">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-foreground">
        {value}
      </div>
    </div>
  )
}

function QuickLink({
  href,
  icon,
  label,
}: {
  href: string
  icon: React.ReactNode
  label: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.02] active:bg-black/[0.02] dark:hover:bg-white/[0.03] dark:active:bg-white/[0.03] md:px-5"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-[14px] text-foreground">{label}</span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}
