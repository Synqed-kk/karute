// Router-content-scoped error boundary (white-screen insurance, field report
// 2026-07-28): the audit-viewer white screen (tap an actor name, scroll deep,
// viewport lands past the collapsed content) is one cause of an unrecoverable
// blank screen — a render THROW is another, and the bundle had no boundary
// around the router at all. src/lib/app-root/ErrorBoundary.tsx already exists,
// but it wraps the ENTIRE AppRoot tree (see AppRoot.tsx) — chrome and tab bar
// included — so a catch there blanks the nav too, with nothing left to tap.
// This one wraps ONLY <ThinRouter/> (thin/main.tsx, inside ThinChromeContent),
// so the chrome/tab bar survive a screen-render crash: tapping another tab is
// the actual escape route Liam used in the field, and ContentErrorBoundary is
// keyed by pathname so that tap auto-recovers (a route change remounts this
// instance, clearing the caught error AND remounting the crashed subtree).
import { Component, type ReactNode } from 'react'
import { usePathname } from './ports/nav.vite'

type Props = { children: ReactNode }
type State = { hasError: boolean }

class Boundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    // Stable prefix so it's greppable in device logs — no Sentry wiring at
    // this tier (the AppRoot-level boundary owns that for the fatal case).
    console.error('[thin-boundary]', error)
  }

  // A real reload, not a state reset (Greptile #637 P1): clearing hasError
  // just re-renders the same crashed subtree — a deterministic throw bounced
  // straight back to this card. The shell's bundle is local (offline first
  // paint), so a full reload is fast and honestly matches the button label.
  private reset = () => window.location.reload()

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-foreground">画面の表示に失敗しました</p>
        <button
          type="button"
          onClick={this.reset}
          className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
        >
          再読み込み
        </button>
      </div>
    )
  }
}

export function ContentErrorBoundary({ children }: Props) {
  const pathname = usePathname()
  return <Boundary key={pathname}>{children}</Boundary>
}
