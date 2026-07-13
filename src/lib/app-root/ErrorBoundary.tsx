'use client'

// Fatal-error recovery for the thin target — the AppRoot-level equivalent of the
// web app's `global-error.tsx` (which only exists because Next replaces the root
// layout on a layout crash). The bundle has no Next error convention, so this
// React error boundary is the parity piece: inline-styled recovery UI (can't
// assume Tailwind/theme survived the crash), splash release so the native launch
// screen can't sit on top of the recovery UI, and an injected error reporter
// (default console) so this module stays platform-neutral — the Next host passes
// Sentry.captureException, the bundle can pass its own.

import { Component, type ReactNode } from 'react'
import { hideNativeSplash } from './splash'

type Props = {
  children: ReactNode
  onError?: (error: Error) => void
}
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
    // The recovery UI replaces the app; SplashHide never runs — drop the native
    // launch screen now so the user isn't stranded on splash. No-op in browsers.
    hideNativeSplash()
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif',
          background: '#ffffff',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: 360, width: '100%', textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px' }}>
            問題が発生しました
          </h1>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: '#64748b',
              margin: '0 0 20px',
            }}
          >
            アプリの読み込み中にエラーが発生しました。もう一度お試しください。
          </p>
          <button
            type="button"
            onClick={this.reset}
            style={{
              width: '100%',
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              color: '#ffffff',
              background: '#0f172a',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            もう一度読み込む
          </button>
        </div>
      </div>
    )
  }
}
