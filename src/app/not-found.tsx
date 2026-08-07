// Global 404 for any unmatched URL. Renders inside the root layout, so it
// inherits the theme, fonts and <html>/<body> — only a centered card is needed.
// Server component (no interactivity beyond a link back home).

import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-sm space-y-4">
        <p className="text-4xl font-semibold tabular-nums text-muted-foreground/60">
          404
        </p>
        <h1 className="text-lg font-semibold text-foreground">
          ページが見つかりません
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          お探しのページは移動または削除された可能性があります。
        </p>
        <Link
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          ホームに戻る
        </Link>
      </div>
    </div>
  )
}
