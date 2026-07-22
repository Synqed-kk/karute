'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import {
  AlertCircle,
  Building,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Globe,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react'

import { completeOnboarding } from '@/actions/org-settings'
import { WebOnly } from '@/components/shell/WebOnly'
import {
  BUSINESS_TYPES,
  DISCLOSURE_MODES,
  getBusinessProfile,
  type DisclosureMode,
} from '@/lib/welcome/business-types'

type WizardLocale = 'en' | 'ja'

interface WelcomeWizardProps {
  initialBusinessName: string
  initialBusinessType: string
  initialDisclosureMode: 'A' | 'B' | 'C' | null
}

const MODE_ICONS: Record<DisclosureMode['mode'], typeof Eye> = {
  A: Eye,
  B: MessageCircle,
  C: ShieldAlert,
}

export function WelcomeWizard({
  initialBusinessName,
  initialBusinessType,
  initialDisclosureMode,
}: WelcomeWizardProps) {
  const router = useRouter()
  const currentLocale = useLocale() as WizardLocale
  const t = useTranslations('welcome')
  const [step, setStep] = useState(1)
  const [businessName, setBusinessName] = useState(initialBusinessName)
  const [businessType, setBusinessType] = useState(initialBusinessType)
  // Defaults to whichever locale the user landed on. Switching this updates
  // the post-onboarding redirect; the wizard chrome itself stays in the
  // current URL locale to avoid a mid-flow page reload that'd reset state.
  const [language, setLanguage] = useState<WizardLocale>(currentLocale)
  const [disclosureMode, setDisclosureMode] = useState<'A' | 'B' | 'C' | null>(
    initialDisclosureMode,
  )
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const step1Valid = businessName.trim().length > 0 && !!businessType
  const step2Valid =
    !!disclosureMode && (disclosureMode !== 'A' || privacyConfirmed)

  const profile = businessType ? getBusinessProfile(businessType) : null
  const chosenMode = disclosureMode
    ? DISCLOSURE_MODES.find((m) => m.mode === disclosureMode)
    : null

  function handleNext() {
    if (step === 1 && !step1Valid) return
    if (step === 2 && !step2Valid) return
    setStep((s) => Math.min(3, s + 1))
  }

  function handleBack() {
    setStep((s) => Math.max(1, s - 1))
  }

  async function handleFinish() {
    if (!step2Valid || !disclosureMode) return
    setSubmitting(true)
    setError(null)
    const result = await completeOnboarding({
      businessName,
      businessType,
      disclosureMode,
      privacyConfirmed,
    })
    if ('error' in result) {
      setError(result.error)
      setSubmitting(false)
      return
    }
    // Use the i18n router so the chosen language sticks for the rest of the
    // session (the cookie + URL prefix get set by next-intl on push).
    router.push('/dashboard', { locale: language })
    router.refresh()
  }

  return (
    <div className="min-h-svh bg-background px-4 py-8 md:px-6 md:py-12">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500">
            <Sparkles size={18} />
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              SYNQED Karute
            </div>
            <h1 className="text-xl font-semibold text-foreground md:text-2xl">
              {t('title')}
            </h1>
          </div>
        </header>

        <ProgressPills
          current={step}
          labels={[t('steps.business'), t('steps.disclosure'), t('steps.review')]}
        />

        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
          {step === 1 && (
            <Step1Business
              t={t}
              businessName={businessName}
              setBusinessName={setBusinessName}
              businessType={businessType}
              setBusinessType={setBusinessType}
              profile={profile}
              language={language}
              setLanguage={setLanguage}
            />
          )}
          {step === 2 && (
            <Step2Disclosure
              t={t}
              disclosureMode={disclosureMode}
              setDisclosureMode={setDisclosureMode}
              privacyConfirmed={privacyConfirmed}
              setPrivacyConfirmed={setPrivacyConfirmed}
            />
          )}
          {step === 3 && (
            <Step3Review
              t={t}
              businessName={businessName}
              profile={profile}
              chosenMode={chosenMode ?? null}
            />
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <footer className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={step === 1 || submitting}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={13} />
            <span>{t('back')}</span>
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={
                (step === 1 && !step1Valid) || (step === 2 && !step2Valid)
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-sky-500 px-4 text-xs font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span>{t('next')}</span>
              <ChevronRight size={13} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={submitting}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-sky-500 px-4 text-xs font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckCircle size={13} />
              <span>{submitting ? t('saving') : t('finish')}</span>
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function ProgressPills({
  current,
  labels,
}: {
  current: number
  labels: string[]
}) {
  return (
    <ol className="flex items-center gap-3">
      {[1, 2, 3].map((n) => {
        const active = n === current
        const done = n < current
        return (
          <li key={n} className="flex flex-1 items-center gap-3 last:flex-initial">
            <div className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  done
                    ? 'bg-sky-500 text-white'
                    : active
                      ? 'bg-sky-500/15 text-sky-500 ring-2 ring-sky-500/40'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {done ? <Check size={13} /> : n}
              </div>
              <span
                className={`hidden text-xs font-medium md:inline ${
                  active
                    ? 'text-foreground'
                    : done
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/60'
                }`}
              >
                {labels[n - 1]}
              </span>
            </div>
            {n < 3 && (
              <div
                className={`h-px flex-1 ${done ? 'bg-sky-500/60' : 'bg-border'}`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type T = any

function Step1Business({
  t,
  businessName,
  setBusinessName,
  businessType,
  setBusinessType,
  profile,
  language,
  setLanguage,
}: {
  t: T
  businessName: string
  setBusinessName: (v: string) => void
  businessType: string
  setBusinessType: (v: string) => void
  profile: ReturnType<typeof getBusinessProfile> | null
  language: WizardLocale
  setLanguage: (v: WizardLocale) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Building size={12} />
        <span>{t('steps.business')}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t('step1.intro')}</p>

      <div className="flex flex-col gap-4">
        <WebOnly>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Globe size={11} />
              {t('step1.appLanguage')}
            </legend>
            <div
              className="grid grid-cols-2 gap-2"
              role="radiogroup"
              aria-label={t('step1.appLanguageAria')}
            >
              {([
                { value: 'ja', label: '日本語' },
                { value: 'en', label: 'English' },
              ] as const).map((opt) => {
                const active = language === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setLanguage(opt.value)}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'border-sky-500/60 bg-sky-500/10 text-foreground'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {active && <Check size={13} className="text-sky-400" />}
                    <span>{opt.label}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              {t('step1.languageHint')}
            </p>
          </fieldset>
        </WebOnly>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">
            {t('step1.storeName')} <span className="text-red-400">*</span>
          </span>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder={t('step1.storeNamePlaceholder')}
            maxLength={100}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-sky-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">
            {t('step1.businessType')} <span className="text-red-400">*</span>
          </span>
          <select
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-sky-500 focus:outline-none"
          >
            <option value="" disabled>
              {t('step1.selectBusinessType')}
            </option>
            {BUSINESS_TYPES.map((bt) => (
              <option key={bt.value} value={bt.value}>
                {bt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {profile && businessType && (
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-sky-300">
            <Target size={11} />
            <span>{t('step1.aiTuningHeading')}</span>
          </div>
          <div className="text-sm font-semibold text-foreground">
            {profile.label}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{profile.tagline}</p>
          <div className="mt-3 text-xs font-medium text-foreground">
            {t('step1.includedInProfile')}
          </div>
          <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
            <li>· {t('step1.priorityTopics', { n: profile.priorityTopics })}</li>
            <li>· {t('step1.coachingFocus', { n: profile.coachingFocus })}</li>
            <li>· {t('step1.topPatterns', { n: profile.topPatterns })}</li>
            <li>· {t('step1.quickStartPrompts', { n: profile.consultationPrompts })}</li>
          </ul>
          <p className="mt-3 text-[11px] italic text-muted-foreground/70">
            {t('step1.customizeHint')}
          </p>
        </div>
      )}
    </div>
  )
}

function Step2Disclosure({
  t,
  disclosureMode,
  setDisclosureMode,
  privacyConfirmed,
  setPrivacyConfirmed,
}: {
  t: T
  disclosureMode: 'A' | 'B' | 'C' | null
  setDisclosureMode: (v: 'A' | 'B' | 'C') => void
  privacyConfirmed: boolean
  setPrivacyConfirmed: (v: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <ShieldAlert size={12} />
        <span>{t('steps.disclosure')}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t('step2.intro')}</p>

      <div className="flex flex-col gap-3">
        {DISCLOSURE_MODES.map((m) => {
          const Icon = MODE_ICONS[m.mode]
          const active = disclosureMode === m.mode
          return (
            <button
              key={m.mode}
              type="button"
              onClick={() => setDisclosureMode(m.mode)}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                active
                  ? 'border-sky-500/60 bg-sky-500/5'
                  : 'border-border bg-card hover:bg-muted/50'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  active
                    ? 'bg-sky-500 text-white'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icon size={15} />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase text-sky-400">
                    {t('step2.modeLabel', { mode: m.mode })}
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {m.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{m.summary}</p>
                {active && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {m.description}
                  </p>
                )}
                <p className="text-[11px] italic text-muted-foreground/70">
                  {m.recommendedFor}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      {disclosureMode === 'A' && (
        <label className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <input
            type="checkbox"
            checked={privacyConfirmed}
            onChange={(e) => setPrivacyConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border bg-background accent-sky-500"
          />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
              <AlertCircle size={12} />
              <span>{t('step2.privacyConfirm')}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('step2.modeAWarning')}
            </p>
          </div>
        </label>
      )}
    </div>
  )
}

function Step3Review({
  t,
  businessName,
  profile,
  chosenMode,
}: {
  t: T
  businessName: string
  profile: ReturnType<typeof getBusinessProfile> | null
  chosenMode: DisclosureMode | null
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <CheckCircle size={12} />
        <span>{t('steps.review')}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t('step3.intro')}</p>

      <div className="flex flex-col gap-3">
        <ReviewRow
          icon={<Building size={13} />}
          label={t('step3.storeName')}
          value={businessName}
        />
        <ReviewRow
          icon={<Target size={13} />}
          label={t('step3.businessType')}
          value={profile?.label ?? '—'}
          sublabel={profile?.tagline ?? null}
        />
        <ReviewRow
          icon={<ShieldAlert size={13} />}
          label={t('step3.disclosureMode')}
          value={
            chosenMode
              ? t('step3.modeValue', { mode: chosenMode.mode, label: chosenMode.label })
              : '—'
          }
          sublabel={chosenMode?.summary ?? null}
        />
      </div>

      <p className="text-[11px] italic text-muted-foreground/70">
        {t('step3.footnote')}
      </p>
    </div>
  )
}

function ReviewRow({
  icon,
  label,
  value,
  sublabel,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sublabel?: string | null
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-sm font-semibold text-foreground">{value}</div>
        {sublabel && (
          <div className="text-xs text-muted-foreground">{sublabel}</div>
        )}
      </div>
    </div>
  )
}
