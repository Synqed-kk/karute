import { GraduationCap, Sparkles } from 'lucide-react'

export default function CoachingPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
            <GraduationCap size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[26px]">
              Coaching
            </h1>
            <p className="text-xs text-muted-foreground md:text-sm">
              Team-wide performance coaching, derived from karute patterns.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200">
          <Sparkles size={12} />
          Coming soon
        </span>
      </header>

      <section className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center shadow-sm md:p-12">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/15 text-violet-300">
          <GraduationCap size={22} />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          Coaching is on the roadmap
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          We&apos;re building per-staff performance trends, anonymized
          top-performer pattern libraries, and per-category coaching focus
          surfaced from your team&apos;s karute. Watch this space.
        </p>

        <ul className="mx-auto mt-6 grid max-w-md gap-2 text-left text-xs text-muted-foreground">
          {[
            'Store-wide close + rebooking + satisfaction trends',
            'Per-stylist drilldown with team-relative percentile',
            'Top-performer pattern library shared anonymously across staff',
            'Per-category coaching focus (question depth, closing timing, rebooking conversation)',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
