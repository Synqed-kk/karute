// Next's own loading convention — no hand-rolled state. Invisible today (the
// fixture read resolves immediately) and correct once real reads return here.
import { businessStrings } from '@/business/i18n'

export default function Loading() {
  return (
    <p className="px-5 py-10 text-sm text-muted-foreground">{businessStrings.analytics.loading}</p>
  )
}
