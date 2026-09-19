// 資源の言葉 — THE WORDS HOME, ⚖ D-53 (c) R4.
//
// Pure over its arguments; imports only the mirror (`./fixtures-settings`);
// names nothing from today/ or settings/; behaviour never reads this table
// yet (C5 — N1 pins zero readers under today/, item 9 of the build packet).
// N2 is the first reader (the board), N3 is the settings surface + the
// per-store override (C2/C6/C7 — no lever built here with no surface).
//
// The 26 rows are `VOCAB-DRAFT-27-TYPES.md` Table 1 with its HEAD block's
// nine folds applied, plus `NATIVE-PASS-N1-COUNTERS.md`'s counter per noun.
// `なし` → `null` (a first-class 「does not apply」, C1 — never a blank
// string). `chiropractic` and `massage` are byte-identical to `other` (C9 —
// today's words, unchanged).

import { businessProfiles, type BusinessProfileKey } from './fixtures-settings'

export interface ResourceWords {
  readonly resourceNoun: string
  readonly counter: string
  readonly groupLabel: string
  readonly tabWord: string
  readonly privateWord: string | null
  readonly fullWord: string
  readonly turnoverWord: string | null
}

export const GENERIC_WORDS: ResourceWords = Object.freeze({
  resourceNoun: '設備', counter: '台', groupLabel: '設備', tabWord: '設備',
  privateWord: null, fullWord: '空きなし', turnoverWord: '清掃',
})

export interface WordOverride {
  readonly resourceNoun?: string
  readonly counter?: string
  readonly fullWord?: '満室' | '満席' | '空きなし'
  readonly turnoverWord?: string
}

export const WORD_MAX_CHARS = 8

export function wordOverrideProblem(o: WordOverride | null): 'pair' | 'empty' | 'trim' | 'space' | 'length' | 'bar' | 'full' | 'reserved' | null {
  if (o === null) return null
  if ((o.resourceNoun !== undefined) !== (o.counter !== undefined)) return 'pair'
  const values = [o.resourceNoun, o.counter, o.fullWord, o.turnoverWord]
    .filter((value): value is string => value !== undefined)
  if (values.some((value) => value.trim().length === 0)) return 'empty'
  if (values.some((value) => value !== value.trim())) return 'trim'
  if (values.some((value) => /[\s\u200B\uFEFF]/u.test(value))) return 'space'
  if (values.some((value) => Array.from(value).length > WORD_MAX_CHARS)) return 'length'
  if (values.some((value) => value.includes('|'))) return 'bar'
  if (o.fullWord !== undefined && !['満室', '満席', '空きなし'].includes(o.fullWord)) return 'full'
  if (o.turnoverWord !== undefined && ['休憩', '準備', '記録', 'ミーティング'].includes(o.turnoverWord)) return 'reserved'
  return null
}

export const RESOURCE_WORDS: Record<BusinessProfileKey, ResourceWords> = {
  esthetic_salon: { resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
  hair_salon: { resourceNoun: 'セット面', counter: '面', groupLabel: 'セット面・設備', tabWord: '設備', privateWord: '個室', fullWord: '満席', turnoverWord: '片付け' },
  nail_salon: { resourceNoun: 'ブース', counter: 'つ', groupLabel: 'ブース・設備', tabWord: '設備', privateWord: '個室', fullWord: '満席', turnoverWord: '消毒' },
  eyelash_salon: { resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
  massage: { resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
  chiropractic: { resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
  beauty_chiropractic: { resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
  acupuncture: { resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
  osteopathy: { resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
  yoga_studio: { resourceNoun: 'マット', counter: '枚', groupLabel: 'マット・設備', tabWord: '設備', privateWord: null, fullWord: '満席', turnoverWord: null },
  pilates_studio: { resourceNoun: 'マシン', counter: '台', groupLabel: 'マシン・設備', tabWord: '設備', privateWord: '個室', fullWord: '満席', turnoverWord: '清掃' },
  personal_gym: { resourceNoun: 'ブース', counter: 'つ', groupLabel: 'ブース・設備', tabWord: '設備', privateWord: '個室', fullWord: '満席', turnoverWord: '清掃' },
  dental_clinic: { resourceNoun: 'ユニット', counter: '台', groupLabel: 'ユニット・設備', tabWord: 'ユニット', privateWord: '個室', fullWord: '空きなし', turnoverWord: '消毒' },
  medical_clinic: { resourceNoun: '診察室', counter: '室', groupLabel: '診察室・設備', tabWord: '診察室', privateWord: null, fullWord: '満室', turnoverWord: '消毒' },
  dermatology: { resourceNoun: '診察室', counter: '室', groupLabel: '診察室・設備', tabWord: '診察室', privateWord: null, fullWord: '満室', turnoverWord: '消毒' },
  cosmetic_surgery: { resourceNoun: '施術室', counter: '室', groupLabel: '施術室・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '消毒' },
  physical_therapy: { resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
  foot_care: { resourceNoun: 'チェア', counter: '台', groupLabel: 'チェア・設備', tabWord: '設備', privateWord: '個室', fullWord: '満席', turnoverWord: '消毒' },
  relaxation: { resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
  aroma: { resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
  wellness_clinic: { resourceNoun: '施術室', counter: '室', groupLabel: '施術室・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
  mental_health: { resourceNoun: '面談室', counter: '室', groupLabel: '面談室・設備', tabWord: '面談室', privateWord: null, fullWord: '満室', turnoverWord: null },
  veterinary: { resourceNoun: '診察室', counter: '室', groupLabel: '診察室・設備', tabWord: '診察室', privateWord: null, fullWord: '満室', turnoverWord: '消毒' },
  pet_grooming: { resourceNoun: 'ケージ', counter: '台', groupLabel: 'ケージ・設備', tabWord: '設備', privateWord: null, fullWord: '空きなし', turnoverWord: '清掃' },
  training_school: { resourceNoun: '教室', counter: '室', groupLabel: '教室・設備', tabWord: '設備', privateWord: null, fullWord: '満席', turnoverWord: null },
  other: { resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備', privateWord: '個室', fullWord: '満室', turnoverWord: '清掃' },
}

// ⚖ D-53 (c) R4 — one truth, immutable: a caller can never poison `other`'s row for the next lookup
for (const row of Object.values(RESOURCE_WORDS)) Object.freeze(row)
Object.freeze(RESOURCE_WORDS)

/** The words for a store's type, or `other`'s row for anything that is not a
 *  member of the mirror (never a bare index — `'constructor'`/`'toString'`/
 *  `'__proto__'` would otherwise return an inherited property). */
export function resourceWordsFor(type: string | null | undefined): ResourceWords {
  return businessProfiles.some(({ value }) => value === type)
    ? RESOURCE_WORDS[type as BusinessProfileKey]
    : RESOURCE_WORDS.other
}

export function wordsForStore(type: string, override: WordOverride | null): ResourceWords {
  const base = Object.prototype.hasOwnProperty.call(RESOURCE_WORDS, type) ? resourceWordsFor(type) : GENERIC_WORDS
  if (override === null || Object.keys(override).length === 0 || wordOverrideProblem(override) !== null) return base
  const paired = override.resourceNoun !== undefined && override.counter !== undefined
  return Object.freeze({
    ...base,
    ...(paired ? {
      resourceNoun: override.resourceNoun!, counter: override.counter!,
      groupLabel: `${override.resourceNoun}・設備`,
    } : {}),
    ...(override.fullWord !== undefined ? { fullWord: override.fullWord } : {}),
    ...(base.turnoverWord !== null && override.turnoverWord !== undefined ? { turnoverWord: override.turnoverWord } : {}),
  })
}

/** ⚖ D-53 (n) C7 — the board's CHROME words under a mixed board: every row
 *  the caller hands in (already resolved via `resourceWordsFor`) agrees on
 *  all seven fields → that row; disagreement, or nothing to agree on at all
 *  (`[]`), → the neutral row. Pure — reads no store, calls nothing. */
export function chromeWords(rows: readonly ResourceWords[]): ResourceWords {
  if (rows.length === 0) return GENERIC_WORDS
  const [first, ...rest] = rows
  const agree = rest.every(
    (row) =>
      row.resourceNoun === first.resourceNoun &&
      row.counter === first.counter &&
      row.groupLabel === first.groupLabel &&
      row.tabWord === first.tabWord &&
      row.privateWord === first.privateWord &&
      row.fullWord === first.fullWord &&
      row.turnoverWord === first.turnoverWord,
  )
  return agree ? first : GENERIC_WORDS
}
