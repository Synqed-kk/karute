// ─────────────────────────────────────────────────────────────
// VisitHistoryChain — recent-visits dot strip
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/customers/VisitHistoryChain.tsx
// A row of N dots representing the customer's last N intended
// visits (e.g. weekly maintenance). Filled = attended, empty =
// missed. Shown inline on customer list rows + profile header
// so staff scan "is this customer slipping?" at a glance.
//
// Caller decides the window size + which dots are filled.

import { useTranslations } from 'next-intl'

interface VisitHistoryChainProps {
  /** Most-recent-first array. Each boolean = attended (true) or
   *  missed (false). Length determines dot count. */
  chain: boolean[]
  /** Lifetime visit count, surfaced via aria-label only. */
  visitCount: number
}

export function VisitHistoryChain({
  chain,
  visitCount,
}: VisitHistoryChainProps) {
  const t = useTranslations('customers.visitHistoryChain')
  const filledCount = chain.filter(Boolean).length

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {chain.map((visited, i) => (
          <span
            key={i}
            className={`size-1.5 rounded-full ${
              visited
                ? 'bg-green-500'
                : 'border border-neutral-300 bg-neutral-200 dark:border-white/15'
            }`}
            aria-hidden
          />
        ))}
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {filledCount}/{chain.length}
      </span>
      <span className="sr-only">
        {t('aria', {
          window: chain.length,
          attended: filledCount,
          total: visitCount,
        })}
      </span>
    </div>
  )
}
