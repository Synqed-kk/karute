// Business owns its strings — root messages/*.json is phone-owned and rides
// the thin bundle. Plain import, no next-intl provider changes.
// ponytail: Japanese only; add a locale map when a second locale exists.
import ja from './ja.json'

export const businessStrings = ja

/** ⚖ PR-3 §v3 — the 「サンプル」 mark's two words for its form, ONE home for
 *  both rooms that draw it (設定, 今日の運営): the note under the chip and the
 *  first line of its explanation. `whole` = the block's content is sample;
 *  `part` = only the named parts are ({部分} = the labels joined by partJoin). */
export function sampleMarkLines(mark: { form: 'whole' } | { form: 'part'; labels: readonly string[] }): { note: string; pop1: string } {
  const m = ja.sampleMark
  if (mark.form === 'whole') return { note: m.markNote, pop1: m.popLine1 }
  const part = mark.labels.join(m.partJoin)
  return { note: m.markNotePart.replace('{部分}', part), pop1: m.popLine1Part.replace('{部分}', part) }
}
