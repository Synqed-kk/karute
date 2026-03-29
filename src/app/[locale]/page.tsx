import { Link } from '@/i18n/navigation'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { LocaleToggle } from '@/components/layout/locale-toggle'

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <img src="/karute_logo.png" alt="Karute" className="h-10 object-contain dark:invert" />
        </div>
        <div className="flex items-center gap-2">
          <LocaleToggle />
          <ThemeToggle />
          <Link
            href={'/login' as Parameters<typeof Link>[0]['href']}
            className="rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-background hover:opacity-90 transition-opacity"
          >
            Log in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-20 text-center">
        <div className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary mb-6">
          AI-Powered Session Recording
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
          Never write a karute<br />by hand again
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Record your client sessions. Karute uses AI to transcribe, extract key details, and generate a complete karute — automatically.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href={'/signup' as Parameters<typeof Link>[0]['href']}
            className="rounded-full bg-foreground px-8 py-3.5 text-base font-semibold text-background hover:opacity-90 transition-opacity"
          >
            Get started free
          </Link>
          <a
            href="#how-it-works"
            className="rounded-full border border-border px-8 py-3.5 text-base font-medium text-foreground hover:bg-muted transition-colors"
          >
            See how it works
          </a>
        </div>
      </section>

      {/* Social proof bar */}
      <section className="border-y border-border/30 bg-muted/30 py-6">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-center gap-8 md:gap-16 text-sm text-muted-foreground flex-wrap">
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">500+</div>
            <div>Sessions recorded</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">98%</div>
            <div>Time saved</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">50+</div>
            <div>Salons & clinics</div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center mb-4">How it works</h2>
        <p className="text-center text-muted-foreground mb-14 max-w-lg mx-auto">
          Three simple steps to go from session to karute
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <StepCard
            step="1"
            title="Record"
            description="Hit record during your session. Karute captures the conversation in the background while you focus on your client."
            icon={<MicSvg />}
          />
          <StepCard
            step="2"
            title="AI Processes"
            description="Karute transcribes the audio, extracts preferences, treatments, and concerns, then generates a structured summary."
            icon={<SparklesSvg />}
          />
          <StepCard
            step="3"
            title="Review & Save"
            description="Review the AI-generated karute, make any edits, and save. It's linked to the customer and appointment automatically."
            icon={<CheckSvg />}
          />
        </div>
      </section>

      {/* Features grid */}
      <section className="bg-muted/30 border-y border-border/30 py-20">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center mb-14">Everything you need</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              title="Voice Recording"
              description="Record sessions with one tap. Works on any device with a microphone."
            />
            <FeatureCard
              title="AI Transcription"
              description="Accurate speech-to-text in Japanese and English, powered by Whisper."
            />
            <FeatureCard
              title="Smart Extraction"
              description="AI identifies preferences, treatments, health concerns, and more from the conversation."
            />
            <FeatureCard
              title="Appointment Sync"
              description="Link recordings to appointments. See your schedule and karute history in one place."
            />
            <FeatureCard
              title="Multi-Staff"
              description="Each staff member has their own profile, schedule, and karute records with PIN protection."
            />
            <FeatureCard
              title="Export & Share"
              description="Export karute as PDF or text. Share with your team or print for the client."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          Ready to automate your karute?
        </h2>
        <p className="text-muted-foreground text-lg mb-8 max-w-lg mx-auto">
          Join salons and clinics already saving hours every week with AI-powered session notes.
        </p>
        <Link
          href={'/signup' as Parameters<typeof Link>[0]['href']}
          className="inline-block rounded-full bg-foreground px-10 py-4 text-base font-semibold text-background hover:opacity-90 transition-opacity"
        >
          Get started free
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/30 py-8">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src="/karute_logo.png" alt="Karute" className="h-6 object-contain dark:invert" />
          </div>
          <p>&copy; {new Date().getFullYear()} Karute. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}

function StepCard({ step, title, description, icon }: { step: string; title: string; description: string; icon: React.ReactNode }) {
  return (
    <div className="text-center space-y-4">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/5 text-foreground">
        {icon}
      </div>
      <div>
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Step {step}</span>
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
