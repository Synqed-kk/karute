// Minutes -> localized "H時間M分" / "Hh Mm" — always through message keys,
// never a hand-built unit suffix (⚖ all-languages rule). Shared by the week
// rows' 予約時間/空き cells and the day line.

/** The shape of a next-intl translator, narrowed to what this module needs
 *  (key + optional interpolation values -> string). Values match use-intl's
 *  own TranslationValues (string | number | Date) — `unknown` here would make
 *  every real translator (whose values param is narrower) unassignable to
 *  this type.
 *
 *  The namespace hook is deliberately never spelled with its opening bracket
 *  anywhere in this file: i18n-client-messages-closure.test.ts walks it (it
 *  is now inside /appointments' client-dictionary closure) counting hook-name
 *  + bracket occurrences, and it strips only full-line `//` comments — so a
 *  doc-comment mention inside a block comment reads to that walk as an
 *  unscannable call site and fails the suite. */
export type Translate = (key: string, values?: Record<string, string | number | Date>) => string

/** 「4時間30分」(both nonzero) / 「4時間」(M=0 omits 分) / 「45分」(H=0) /
 *  「0分」(negative or NaN — never negative time, never a dash). */
export function formatHoursMinutes(minutes: number, t: Translate): string {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    // ponytail: 0 has no dedicated rule in the spec (only "negative or NaN"
    // is called out) — "0分" is the only sensible rendering, so it shares
    // this branch rather than a separate one.
    return t('minutes', { m: 0 })
  }
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return t('minutes', { m })
  if (m === 0) return t('hours', { h })
  // Two already-localized fragments joined — not a hand-built unit string.
  return `${t('hours', { h })}${t('minutes', { m })}`
}
