'use client'

// Last-resort backstop: catches crashes in the ROOT layout itself (the one place
// the (app)/error.tsx boundary can't reach). Because it REPLACES the root layout,
// it must render its own <html>/<body> — and it can't assume the Tailwind bundle
// or theme provider loaded, so it uses inline styles only. Still reports to Sentry.

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
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
          {error.digest && (
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 16px' }}>
              エラーID: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
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
      </body>
    </html>
  )
}
