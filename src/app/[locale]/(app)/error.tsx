'use client'

// Route-level error boundary for the authenticated app (dashboard, 顧客, カルテ,
// 予約, 設定 …). Catches any render/runtime crash in a page under (app) and shows
// a recoverable screen instead of the blank white page staff used to get — plus
// reports to Sentry so a crash is never silent. A layout-level crash is caught
// by the root global-error.tsx backstop instead.

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function AppError({
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
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-lg font-semibold text-foreground">
          問題が発生しました
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          画面の読み込み中にエラーが発生しました。もう一度お試しください。解決しない場合は、少し時間をおいてからアクセスしてください。
        </p>
        {error.digest && (
          <p className="text-[11px] text-muted-foreground/70">
            エラーID: {error.digest}
          </p>
        )}
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            もう一度読み込む
          </button>
          {/* Deliberate hard navigation (not next/link): we're inside a crash
           *  boundary, so the client router may itself be broken — a full page
           *  load is the reliable escape hatch. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-border bg-background text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            ホームに戻る
          </a>
        </div>
      </div>
    </div>
  )
}
