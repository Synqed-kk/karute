// お店ページ — the 業種 select's labels, kept OUT of the model's run-time graph (S57 P5b, F4): only the 業種 control
// (StorePageType.tsx) and tests import this module, so model.ts / copy.ts reach no fixtures module.

import { businessProfiles } from '../fixtures-settings'
import type { BusinessTypeKey } from './model'

/** ⚖ R140 / R142 / B13 — the 業種 select's 26 labels: `businessProfiles`' own labels (the signup wording, no emoji),
 *  DERIVED from that list, never retyped (R82). Keys = BUSINESS_TYPE_KEYS (P1 pins the two lists equal). TYPE_JA in
 *  copy.ts stays the internal five-family wording; no Business surface draws it any more. NIT 3: no prototype keys
 *  (built on Object.create(null), then frozen). */
export const TYPE_LABEL: Readonly<Record<BusinessTypeKey, string>> = Object.freeze(
  Object.assign(
    Object.create(null) as Record<BusinessTypeKey, string>,
    Object.fromEntries(businessProfiles.map((p) => [p.value, p.label])),
  ),
)

export const labelOf = (t: BusinessTypeKey): string => TYPE_LABEL[t] ?? t
