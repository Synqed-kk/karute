import { getTranslations, getMessages } from 'next-intl/server'
import { NextIntlClientProvider } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { LocaleToggle } from '@/components/layout/locale-toggle'
import { PAGE_PICKS, pickMessages } from '@/i18n/client-messages'

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  await params
  const t = await getTranslations('landing')

  return (
    <NextIntlClientProvider
      messages={pickMessages(await getMessages(), PAGE_PICKS.landing)}
    >
    <div className="min-h-screen bg-background">
      {/* Top bar — pt clears the iOS status bar / Dynamic Island once
          viewport-fit=cover is active (env inset = 0 in normal browsers, so this
          renders identically there). Without it the logo + login button jam
          under the notch in the WKWebView shell. */}
      <header className="flex items-center justify-between px-6 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <img src="/karute_logo.png" alt="Karute" className="h-10 object-contain dark:invert" />
        </div>
        <div className="flex items-center gap-2">
          <LocaleToggle />
          <ThemeToggle />
          <Link
            href={'/login' as Parameters<typeof Link>[0]['href']}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover transition-colors"
          >
            {t('header.login')}
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-20 text-center">
        <div className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary mb-6">
          {t('hero.badge')}
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
          {t('hero.title')}
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          {t('hero.subtitle')}
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href={'/signup' as Parameters<typeof Link>[0]['href']}
            className="rounded-full bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground hover:bg-primary-hover transition-colors"
          >
            {t('hero.ctaPrimary')}
          </Link>
          <a
            href="#how-it-works"
            className="rounded-full border border-border px-8 py-3.5 text-base font-medium text-foreground hover:bg-muted transition-colors"
          >
            {t('hero.ctaSecondary')}
          </a>
        </div>
      </section>

      {/* Social proof bar */}
      <section className="border-y border-border/30 bg-muted/30 py-6">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-center gap-8 md:gap-16 text-sm text-muted-foreground flex-wrap">
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">500+</div>
            <div>{t('stats.sessionsRecorded')}</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">98%</div>
            <div>{t('stats.timeSaved')}</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">50+</div>
            <div>{t('stats.salonsClinics')}</div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center mb-4">{t('howItWorks.heading')}</h2>
        <p className="text-center text-muted-foreground mb-14 max-w-lg mx-auto">
          {t('howItWorks.subtitle')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <StepCard
            stepLabel={t('howItWorks.stepPrefix', { step: '1' })}
            title={t('howItWorks.step1Title')}
            description={t('howItWorks.step1Description')}
            icon={<MicSvg />}
          />
          <StepCard
            stepLabel={t('howItWorks.stepPrefix', { step: '2' })}
            title={t('howItWorks.step2Title')}
            description={t('howItWorks.step2Description')}
            icon={<SparklesSvg />}
          />
          <StepCard
            stepLabel={t('howItWorks.stepPrefix', { step: '3' })}
            title={t('howItWorks.step3Title')}
            description={t('howItWorks.step3Description')}
            icon={<CheckSvg />}
          />
        </div>
      </section>

      {/* Features grid */}
      <section className="bg-muted/30 border-y border-border/30 py-20">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center mb-14">{t('features.heading')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              title={t('features.voiceRecording.title')}
              description={t('features.voiceRecording.description')}
            />
            <FeatureCard
              title={t('features.aiTranscription.title')}
              description={t('features.aiTranscription.description')}
            />
            <FeatureCard
              title={t('features.smartExtraction.title')}
              description={t('features.smartExtraction.description')}
            />
            <FeatureCard
              title={t('features.appointmentSync.title')}
              description={t('features.appointmentSync.description')}
            />
            <FeatureCard
              title={t('features.multiStaff.title')}
              description={t('features.multiStaff.description')}
            />
            <FeatureCard
              title={t('features.exportShare.title')}
              description={t('features.exportShare.description')}
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          {t('cta.heading')}
        </h2>
        <p className="text-muted-foreground text-lg mb-8 max-w-lg mx-auto">
          {t('cta.subtitle')}
        </p>
        <Link
          href={'/signup' as Parameters<typeof Link>[0]['href']}
          className="inline-block rounded-full bg-primary px-10 py-4 text-base font-semibold text-primary-foreground hover:bg-primary-hover transition-colors"
        >
          {t('cta.button')}
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/30 py-8">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src="/karute_logo.png" alt="Karute" className="h-6 object-contain dark:invert" />
          </div>
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
        </div>
      </footer>
    </div>
    </NextIntlClientProvider>
  )
}

function StepCard({ stepLabel, title, description, icon }: { stepLabel: string; title: string; description: string; icon: React.ReactNode }) {
  return (
    <div className="text-center space-y-4">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/5 text-foreground">
        {icon}
      </div>
      <div>
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{stepLabel}</span>
        <h3 className="text-lg font-semibold mt-1">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  )
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-border/30 bg-card p-6 space-y-2">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  )
}

function MicSvg() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
}

function SparklesSvg() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /></svg>
}

function CheckSvg() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
}
