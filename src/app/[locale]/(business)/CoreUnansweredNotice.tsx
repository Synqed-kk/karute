// P2 — the one notice for a core read that did not answer within the bound, shared by the Business layout (the shell's
// own reads) and the segment's error.tsx (a page's reads). Plain words + the reference number the black-box line
// carries; no numbers, no button, no English. Server-safe: no hooks, no client-only import.
import { businessStrings } from '@/business/i18n'

export function CoreUnansweredNotice({ reference }: { reference: string | undefined }) {
  const s = businessStrings.coreUnanswered
  const [before, after] = s.reference.split('{ref}')
  return (
    <div role="alert" className="px-5 py-10 text-sm text-muted-foreground">
      <p>{s.unloaded}</p>
      <p>{s.ifReloadFails}</p>
      {reference ? (
        <p>
          {before}
          <span className="font-mono select-all">{reference}</span>
          {after}
        </p>
      ) : null}
    </div>
  )
}
