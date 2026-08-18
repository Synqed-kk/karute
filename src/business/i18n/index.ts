// Business owns its strings — root messages/*.json is phone-owned and rides
// the thin bundle. Plain import, no next-intl provider changes.
// ponytail: Japanese only; add a locale map when a second locale exists.
import ja from './ja.json'

export const businessStrings = ja
