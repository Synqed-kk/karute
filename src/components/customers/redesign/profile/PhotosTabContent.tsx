import { Image as ImageIcon } from 'lucide-react'

export interface CustomerPhoto {
  id: string
  signedUrl: string | null
  category: string
  caption: string | null
}

interface PhotosTabContentProps {
  photos: CustomerPhoto[]
}

const CATEGORY_TONE: Record<string, { bg: string; text: string }> = {
  before: { bg: 'bg-sky-500/15', text: 'text-sky-300' },
  after: { bg: 'bg-emerald-500/15', text: 'text-emerald-300' },
  reference: { bg: 'bg-violet-500/15', text: 'text-violet-300' },
  progress: { bg: 'bg-cyan-500/15', text: 'text-cyan-300' },
}

function toneFor(category: string) {
  return (
    CATEGORY_TONE[category] ?? {
      bg: 'bg-muted',
      text: 'text-muted-foreground',
    }
  )
}

export function PhotosTabContent({ photos }: PhotosTabContentProps) {
  if (photos.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center shadow-sm md:px-8 md:py-16">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ImageIcon size={18} />
        </div>
        <p className="text-sm font-semibold text-foreground">No photos yet</p>
        <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
          Upload before / after / reference photos to track customer progress
          across sessions.
        </p>
      </section>
    )
  }
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 text-sky-300">
          <ImageIcon size={14} />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Photos</h3>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {photos.length} total
        </span>
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {photos.map((p) => {
          const tone = toneFor(p.category)
          return (
            <div
              key={p.id}
              className="flex flex-col gap-2 overflow-hidden rounded-xl border border-border bg-background/40"
            >
              <div className="relative aspect-square bg-muted">
                {p.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.signedUrl}
                    alt={p.caption ?? p.category}
                    className="h-full w-full object-cover"
                  />
                ) : null}
                <span
                  className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone.bg} ${tone.text}`}
                >
                  {p.category}
                </span>
              </div>
              {p.caption && (
                <p className="line-clamp-2 px-2 pb-2 text-[11px] text-muted-foreground">
                  {p.caption}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
