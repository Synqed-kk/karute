// ⚖ D-53 (c) R4/R8 — the words home, and its census baseline.
//
// The scanner below (stripComments/consumeTemplate) is hand-rolled rather
// than a parser package: this file is Business territory's OWN test, so its
// import inventory rides the same isolation allowlist as production code
// (node:fs/node:path + the two modules under test).

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { businessProfiles, type BusinessProfileKey } from '@/business/lib/fixtures-settings'
import { stores } from '@/business/lib/fixtures'
import { RESOURCE_WORDS, GENERIC_WORDS, WORD_MAX_CHARS, resourceWordsFor, wordsForStore, wordOverrideProblem, chromeWords, type ResourceWords, type WordOverride } from '@/business/lib/resource-words'

// ── the folded VOCAB draft + native-pass counters, spelled out here as the
//    ORACLE (the test is the record of the native pass, not a second truth) ──
const EXPECTED: Record<BusinessProfileKey, ResourceWords> = {
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

describe('resource-words — ⚖ D-53 (c) R4, the words home', () => {
  it('P13 — every mirror key resolves to a complete row at RUNTIME, not just at compile time', () => {
    for (const { value } of businessProfiles) {
      const words = resourceWordsFor(value)
      expect(Object.keys(words).sort()).toEqual(
        ['counter', 'fullWord', 'groupLabel', 'privateWord', 'resourceNoun', 'tabWord', 'turnoverWord'].sort(),
      )
      expect(words.resourceNoun).toEqual(expect.stringMatching(/.+/))
      expect(words.counter).toEqual(expect.stringMatching(/.+/))
      expect(words.groupLabel).toEqual(expect.stringMatching(/.+/))
      expect(words.tabWord).toEqual(expect.stringMatching(/.+/))
      expect(words.fullWord).toEqual(expect.stringMatching(/.+/))
      expect(words.privateWord === null || (typeof words.privateWord === 'string' && words.privateWord !== '')).toBe(true)
      expect(words.turnoverWord === null || (typeof words.turnoverWord === 'string' && words.turnoverWord !== '')).toBe(true)
    }
  })

  it('an unknown, empty or inherited-property key falls back to other’s row (m2)', () => {
    for (const bad of ['no-such-type', '', 'constructor', 'toString', '__proto__', null, undefined]) {
      expect(resourceWordsFor(bad as string | null | undefined)).toEqual(RESOURCE_WORDS.other)
    }
  })

  it('⚖ C9 — chiropractic, massage and other are byte-identical to today’s actual words (m3)', () => {
    const todaysWords: ResourceWords = {
      resourceNoun: 'ベッド', counter: '台', groupLabel: 'ベッド・設備', tabWord: '設備',
      privateWord: '個室', fullWord: '満室', turnoverWord: '清掃',
    }
    expect(resourceWordsFor('chiropractic')).toEqual(todaysWords)
    expect(resourceWordsFor('massage')).toEqual(todaysWords)
    expect(RESOURCE_WORDS.other).toEqual(todaysWords)
  })

  it('the closed 26-row table matches the folded VOCAB draft + native-pass counters, row for row', () => {
    expect(Object.keys(RESOURCE_WORDS).sort()).toEqual(businessProfiles.map((p) => p.value).slice().sort())
    for (const key of Object.keys(EXPECTED) as BusinessProfileKey[]) {
      expect(RESOURCE_WORDS[key]).toEqual(EXPECTED[key])
    }
  })

  it('every fixture store’s business_type is a real key of the mirror, and the three play-phase values are chiropractic/massage/personal_gym', () => {
    for (const s of stores) {
      expect(businessProfiles.some((p) => p.value === s.business_type)).toBe(true)
    }
    expect(stores.map((s) => s.business_type)).toEqual(['chiropractic', 'massage', 'personal_gym'])
  })

  it('the counter matches the native pass’s sentence-proofed nouns: ベッド・セット面・ブース・教室 (m4 covers a business_type that is not a key)', () => {
    expect(resourceWordsFor('chiropractic').counter).toBe('台') // ベッド family
    expect(resourceWordsFor('hair_salon').counter).toBe('面') // セット面
    expect(resourceWordsFor('nail_salon').counter).toBe('つ') // ブース
    expect(resourceWordsFor('training_school').counter).toBe('室') // 教室
    for (const s of stores) {
      expect(businessProfiles.some((p) => p.value === s.business_type)).toBe(true)
    }
  })

  it('⚖ D-53 (c) R4 — the table and every row are frozen at runtime; a write attempt throws and leaves `other` unchanged', () => {
    expect(Object.isFrozen(RESOURCE_WORDS)).toBe(true)
    expect(Object.isFrozen(resourceWordsFor('no-such'))).toBe(true)
    expect(Object.isFrozen(RESOURCE_WORDS.personal_gym)).toBe(true)
    expect(() => {
      (RESOURCE_WORDS.other as { counter: string }).counter = '名'
    }).toThrow()
    expect(RESOURCE_WORDS.other).toEqual(EXPECTED.other)
  })
})

describe('§3/H1 — the neutral row and the pure store resolver', () => {
  it('§3/H1 — the neutral row is frozen, has no bed noun, and has no private word', () => {
    expect(GENERIC_WORDS).toEqual({
      resourceNoun: '設備', counter: '台', groupLabel: '設備', tabWord: '設備',
      privateWord: null, fullWord: '空きなし', turnoverWord: '清掃',
    })
    expect(Object.isFrozen(GENERIC_WORDS)).toBe(true)
    expect(JSON.stringify(GENERIC_WORDS)).not.toContain('ベッド')
  })

  it('§3/H1 m2 — null and empty overrides preserve all 26 frozen row identities', () => {
    expect(businessProfiles).toHaveLength(26)
    for (const { value } of businessProfiles) {
      expect(wordsForStore(value, null)).toBe(resourceWordsFor(value))
      expect(wordsForStore(value, {})).toBe(resourceWordsFor(value))
      expect(Object.isFrozen(wordsForStore(value, null))).toBe(true)
    }
  })

  it('§3/H1 — unknown and inherited keys resolve to the neutral row', () => {
    for (const type of ['no-such-type', '', 'constructor', 'toString', '__proto__']) {
      expect(wordsForStore(type, null)).toBe(GENERIC_WORDS)
      expect(wordsForStore(type, {})).toBe(GENERIC_WORDS)
    }
  })

  it('§3/H1 m1 — noun and counter apply together, and either half is rejected', () => {
    const base = resourceWordsFor('personal_gym')
    expect(wordsForStore('personal_gym', { resourceNoun: '設備' })).toBe(base)
    expect(wordsForStore('personal_gym', { counter: '台' })).toBe(base)
    const override = Object.freeze({ resourceNoun: '設備', counter: '台' })
    const resolved = wordsForStore('personal_gym', override)
    expect(resolved).toEqual({ ...base, resourceNoun: '設備', counter: '台', groupLabel: '設備・設備' })
    expect(resolved).not.toBe(base)
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(override).toEqual({ resourceNoun: '設備', counter: '台' })
    expect(base).toEqual(EXPECTED.personal_gym)
  })

  it('§3/H1 — full and turnover words can be overridden independently while tab and private words stay fixed', () => {
    const base = resourceWordsFor('hair_salon')
    expect(wordsForStore('hair_salon', { fullWord: '空きなし' })).toEqual({ ...base, fullWord: '空きなし' })
    expect(wordsForStore('hair_salon', { turnoverWord: '清掃' })).toEqual({ ...base, turnoverWord: '清掃' })
    const all = wordsForStore('hair_salon', { resourceNoun: '設備', counter: '台', fullWord: '満室', turnoverWord: '清掃' })
    expect(all).toEqual({ ...base, resourceNoun: '設備', counter: '台', groupLabel: '設備・設備', fullWord: '満室', turnoverWord: '清掃' })
    expect(all.tabWord).toBe(base.tabWord)
    expect(all.privateWord).toBe(base.privateWord)
    expect(Object.isFrozen(all)).toBe(true)
  })

  it('§3/H1 — an override cannot introduce turnover where the base has none', () => {
    for (const type of ['yoga_studio', 'mental_health', 'training_school']) {
      const resolved = wordsForStore(type, { turnoverWord: '清掃' })
      expect(resolved).toEqual(resourceWordsFor(type))
      expect(resolved.turnoverWord).toBeNull()
      expect(resolved).not.toBe(resourceWordsFor(type))
      expect(Object.isFrozen(resolved)).toBe(true)
    }
  })

  const invalid: [WordOverride, Exclude<ReturnType<typeof wordOverrideProblem>, null>][] = [
    [{ resourceNoun: '' }, 'pair'],
    [{ counter: '台' }, 'pair'],
    [{ resourceNoun: '設備', counter: ' ', turnoverWord: '123456789|' }, 'empty'],
    [{ turnoverWord: '' }, 'empty'],
    [{ resourceNoun: ' ブース', counter: 'つ' }, 'trim'],
    [{ turnoverWord: ' 123456789' }, 'trim'],
    [{ turnoverWord: '123456789|' }, 'length'],
    [{ resourceNoun: '123456789', counter: '台' }, 'length'],
    [{ resourceNoun: '設備', counter: '123456789' }, 'length'],
    [{ turnoverWord: '𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷' }, 'length'],
    [{ turnoverWord: '清掃|' }, 'bar'],
    [{ resourceNoun: '設備|', counter: '台' }, 'bar'],
    [{ resourceNoun: '設備', counter: '台|' }, 'bar'],
    [{ fullWord: '満員' as never }, 'full'],
    [{ turnoverWord: '休憩' }, 'reserved'],
    [{ turnoverWord: '準備' }, 'reserved'],
    [{ turnoverWord: '記録' }, 'reserved'],
    [{ turnoverWord: 'ミーティング' }, 'reserved'],
  ]

  it.each(invalid)('§3/H1 — first validation problem for %j is %s, and invalid overrides preserve base identity', (override, problem) => {
    expect(wordOverrideProblem(override)).toBe(problem)
    expect(wordsForStore('personal_gym', override)).toBe(resourceWordsFor('personal_gym'))
    expect(wordsForStore('no-such-type', override)).toBe(GENERIC_WORDS)
  })

  it('F1-b mB — an unknown full word preserves the chiropractic base row by identity', () => {
    expect(wordsForStore('chiropractic', { fullWord: '満員' as never })).toBe(resourceWordsFor('chiropractic'))
  })

  it('§3/H1 — null, empty, valid pairs and independent full/turnover words have no problem; eight characters are allowed', () => {
    expect(WORD_MAX_CHARS).toBe(8)
    for (const override of [null, {}, { resourceNoun: '設備', counter: '台' }, { fullWord: '満室' as const }, { fullWord: '満席' as const }, { fullWord: '空きなし' as const }, { turnoverWord: '12345678' }, { turnoverWord: '𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷' }]) {
      expect(wordOverrideProblem(override)).toBeNull()
    }
    expect(wordsForStore('chiropractic', { turnoverWord: '𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷' }).turnoverWord).toBe('𠮷𠮷𠮷𠮷𠮷𠮷𠮷𠮷')
  })

  it('§3/H1 — agreeing chrome returns the original row by identity', () => {
    for (const { value } of businessProfiles) {
      const row = resourceWordsFor(value)
      expect(chromeWords([row])).toBe(row)
      expect(chromeWords([row, { ...row }])).toBe(row)
    }
  })

  it('§3/H1 m5 — every disagreement permutation and empty chrome resolves to the neutral row', () => {
    const a = resourceWordsFor('chiropractic')
    const b = resourceWordsFor('massage')
    const c = resourceWordsFor('personal_gym')
    for (const rows of [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]]) {
      expect(chromeWords(rows)).toBe(GENERIC_WORDS)
    }
    expect(chromeWords([])).toBe(GENERIC_WORDS)
  })
})

// ── the census scanner (hand-rolled: no parser package on the isolation
//    allowlist) — strips syntactic comments while leaving every string
//    literal, template chunk, JSX attribute string and JSX text byte-for-byte
//    intact, then counts the four target words in what remains. ──

const REGEX_PRECEDING_CHARS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])
// the grammar's expression-opening keywords, complete — a parser package cannot be imported here (business-isolation.test.ts allowlist), so the list is spelled and pinned
// ⚖ the grammar list, third pass (Greptile #936 ×2): return typeof case in of void delete throw yield await new instanceof do else default extends — a keyword after which an ExpressionStatement / AssignmentExpression may begin
const REGEX_PRECEDING_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'yield', 'await', 'new', 'instanceof', 'do', 'else', 'default', 'extends'])

/** True when a `/` at this point opens a regex literal rather than a
 *  division: the previous non-whitespace character in `out` is an
 *  operator/punctuator that cannot end an expression, `out` is empty (start
 *  of text), or the previous token is a keyword that expects an expression
 *  next. A `/` after an identifier/number/`)`/`]` is division, and is left
 *  for the default branch to copy as-is. */
function regexMayOpenHere(out: string): boolean {
  const trimmed = out.replace(/\s+$/, '')
  if (trimmed.length === 0) return true
  const last = trimmed[trimmed.length - 1]
  // `</` is a JSX closing tag's slash, never a regex open; `x < /re/` is not
  // a shape this corpus writes.
  if (last === '<') return false
  if (REGEX_PRECEDING_CHARS.has(last)) return true
  const word = trimmed.match(/[A-Za-z_$][A-Za-z0-9_$]*$/)
  if (word === null || !REGEX_PRECEDING_WORDS.has(word[0])) return false
  // a keyword-shaped property name after `.` (`x.void`) is an identifier,
  // not the keyword — only a bare keyword opens a regex.
  const before = trimmed.length - word[0].length - 1
  return before < 0 || trimmed[before] !== '.'
}

/** Consumes a regex literal starting at `src[start] === '/'`, honouring `\`
 *  escapes and `[...]` classes (where `/` does not close the literal), plus
 *  trailing flag letters. Returns the index just past the flags and the
 *  literal's own text verbatim — it is source text, not a comment, so its
 *  contents are copied through unexamined for the word count that follows. */
function consumeRegex(src: string, start: number): [number, string] {
  let i = start + 1
  const n = src.length
  let inClass = false
  while (i < n) {
    const c = src[i]
    if (c === '\\') { i += 2; continue }
    if (c === '[') { inClass = true; i++; continue }
    if (c === ']') { inClass = false; i++; continue }
    if (c === '/' && !inClass) { i++; break }
    if (c === '\n') break
    i++
  }
  while (i < n && /[a-z]/i.test(src[i])) i++
  return [i, src.slice(start, i)]
}

/** Consumes a template literal starting at `src[start] === '`'`, recursing
 *  into every `${…}` (which may itself hold strings, comments or nested
 *  templates) so a comment inside an interpolation is stripped and a target
 *  word is never split or double-counted across the `${}` boundary. Returns
 *  the index just past the closing backtick and the literal's own text (with
 *  its interior comments already stripped). */
function consumeTemplate(src: string, start: number): [number, string] {
  let i = start + 1
  let out = '`'
  const n = src.length
  while (i < n) {
    if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
    if (src[i] === '`') { out += '`'; i++; break }
    if (src[i] === '$' && src[i + 1] === '{') {
      let depth = 1
      let j = i + 2
      let expr = '${'
      while (j < n && depth > 0) {
        const cj = src[j]
        if (cj === '{') { depth++; expr += cj; j++; continue }
        if (cj === '}') { depth--; expr += cj; j++; continue }
        if (cj === '/' && src[j + 1] !== '/' && src[j + 1] !== '*' && src[j + 1] !== '>' && regexMayOpenHere(expr)) {
          const [consumed, text] = consumeRegex(src, j)
          expr += text
          j = consumed
          continue
        }
        if (cj === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; continue }
        if (cj === '/' && src[j + 1] === '*') { j += 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; j += 2; continue }
        if (cj === "'" || cj === '"') {
          const quote = cj
          expr += cj; j++
          while (j < n && src[j] !== quote) {
            if (src[j] === '\\') { expr += src[j] + (src[j + 1] ?? ''); j += 2; continue }
            expr += src[j]; j++
          }
          expr += src[j] ?? ''; j++
          continue
        }
        if (cj === '`') {
          const [consumed, text] = consumeTemplate(src, j)
          expr += text
          j = consumed
          continue
        }
        expr += cj
        j++
      }
      out += expr
      i = j
      continue
    }
    out += src[i]
    i++
  }
  return [i, out]
}

/** Strips `//…` and `/*…*​/` comments while leaving every string literal and
 *  template literal (interior included) exactly as written, so a comment
 *  marker inside a quoted string can never delete real text. */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && src[i + 1] !== '>' && regexMayOpenHere(out)) {
      const [consumed, text] = consumeRegex(src, i)
      out += text
      i = consumed
      continue
    }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    if (c === "'" || c === '"') {
      const quote = c
      out += c; i++
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        out += src[i]; i++
      }
      out += src[i] ?? ''; i++
      continue
    }
    if (c === '`') {
      const [consumed, text] = consumeTemplate(src, i)
      out += text
      i = consumed
      continue
    }
    out += c
    i++
  }
  return out
}

/** Non-overlapping occurrences of `needle` in `text`. */
function countOccurrences(text: string, needle: string): number {
  let count = 0
  let idx = text.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = text.indexOf(needle, idx + needle.length)
  }
  return count
}

/** Every `.ts`/`.tsx` SOURCE file under `dir`, recursively, excluding tests. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { out.push(...listSourceFiles(full)); continue }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (/\.test\.tsx?$/.test(entry.name)) continue
    out.push(full)
  }
  return out
}

const TODAY_DIR = join(process.cwd(), 'src/app/[locale]/(business)/business/today')
const TARGET_WORDS = ['ベッド', '個室', '満室', '清掃']
// ⚖ D-53 (ak)/(al) R-6 — the two frozen word-minting files under
// src/business/lib/, scanned explicitly (they sit outside TODAY_DIR, so
// `listSourceFiles(TODAY_DIR)` cannot reach them on its own).
const EXTRA_SCANNED_FILES = [
  join(process.cwd(), 'src/business/lib/today-board.ts'),
  join(process.cwd(), 'src/business/lib/canon-logic/drag-rules.ts'),
]

describe('⚖ D-53 (c) R4/R8 — today/’s resource-word census', () => {
  it('counts ベッド・個室・満室・清掃 in today/ source text outside comments (string, template and JSX text included), per file', () => {
    const byFile: Record<string, number> = {}
    let offenders = 0
    // ⚖ D-53 (ak)/(al) R-6 — the scanned set widens to the two frozen
    // word-minting files from N2c-2 on; the key switches to
    // `relative(process.cwd(), file)` for EVERY scanned file so the two new
    // ones pin as `src/business/lib/…` (the today/ key never appeared at
    // zero, so the existing zero pin is untouched by the key change).
    const scanned = [...listSourceFiles(TODAY_DIR), ...EXTRA_SCANNED_FILES]
    for (const file of scanned) {
      const stripped = stripComments(readFileSync(file, 'utf8'))
      const count = TARGET_WORDS.reduce((sum, w) => sum + countOccurrences(stripped, w), 0)
      if (count > 0) byFile[relative(process.cwd(), file)] = count
      offenders += count
    }
    console.log('census:', JSON.stringify({ offenders, byFile }))
    // ⚖ D-53 (n) — DISCLOSED PIN MOVE: N2a (PKT-BUILD-N2A-BOARD-WORDS.md)
    // converted page.tsx's 2 and TodayScreen.tsx's 28 sites to read the
    // resource-words table; today-interactions.ts's 19 are N2b's.
    // ⚖ D-53 (u)/(n2b1) — DISCLOSED PIN MOVE: N2b-1 (PKT-BUILD-N2B1-SINGLE-LANE.md)
    // converted blockChrome / withheldSub / parkChipText / landingVerdict
    // (6 occurrences: #33, #35, #42, #47, #48, #49); the remaining 13 are
    // N2b-2's map sites (9) and N2c's parked allocator sites (4).
    // ⚖ D-53 (u)/(n2b2) — DISCLOSED PIN MOVE: N2b-2 (PKT-BUILD-N2B2-BOARD-MAP.md)
    // converted the map sites' own literals (#31/#32 `withTrailingCleanup`/
    // `cleanupShell`, #34 `railCell`'s R-UNAVAILABLE branch, #36 `reseatSentence`,
    // #37-40 `railExplain`'s two chip ternaries, #41 the taker clause — 9
    // occurrences); the remaining 4 were N2c's parked allocator sites.
    // ⚖ D-53 (ak)/(al) — DISCLOSED PIN MOVE: N2c-1 (PKT-BUILD-N2C1-ALLOCATOR-WORDS.md)
    // converted `fullRoomsRefusal`'s last 4 occurrences (#43-46) — the allocator's
    // refusal text now reads the words handed to `allocateBed`. N2c-2
    // (PKT-BUILD-N2C2-BOARD-AND-RULES-WORDS.md) widens the scanner to
    // today-board.ts (3 occurrences: bookingItem's private-room slot, the
    // cleanup title and label) and drag-rules.ts (2 occurrences: the
    // yielded-derived check label's two slots) and converts both — the
    // widened census is 0 everywhere.
    expect(byFile).toEqual({})
    expect(offenders).toBe(0)
    // ⚖ mutant b6 catch — the {}/0 pins above cannot tell "both files scanned
    // and clean" from "widening dropped back to today/-only", since a fixed
    // today-board.ts/drag-rules.ts would ALSO read 0 if never scanned. This
    // inspects the array actually iterated, so dropping the widening fails
    // here regardless of the two files' own content.
    expect(scanned.map((f) => relative(process.cwd(), f)).sort()).toEqual(
      expect.arrayContaining(['src/business/lib/canon-logic/drag-rules.ts', 'src/business/lib/today-board.ts']),
    )
  })

  it('the scanner keeps regex literals and comment markers inside them out of the comment stripper (L1 MINOR-2)', () => {
    const countIn = (src: string) => TARGET_WORDS.reduce((sum, w) => sum + countOccurrences(stripComments(src), w), 0)
    expect(countIn("const r = /a\\/*b/; 'ベッド'")).toBe(1)
    expect(countIn("const r = /[']/; // ベッド\n'個室'")).toBe(1)
    expect(countIn("const u = /https?:\\/\\//; '満室'")).toBe(1)
    expect(countIn("/* ' */ '清掃'")).toBe(1)
    expect(countIn("`${x ? 'ベッド' : \"個室\"} 満室`")).toBe(3)
    expect(countIn("const d = a / b; 'ベッド' // 個室")).toBe(1)
  })

  it('the scanner opens a regex after every expression-opening keyword (Greptile #936)', () => {
    // hardcoded independently of REGEX_PRECEDING_WORDS — the grammar's own
    // list, so a keyword dropped from the implementation's set fails HERE.
    const EXPRESSION_OPENING_KEYWORDS = ['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'yield', 'await', 'new', 'instanceof', 'do', 'else', 'default', 'extends']
    const countIn = (src: string) => TARGET_WORDS.reduce((sum, w) => sum + countOccurrences(stripComments(src), w), 0)
    const results = EXPRESSION_OPENING_KEYWORDS.map((kw) => countIn(`${kw} /https?:\\/\\//; 'ベッド'`))
    console.log('keyword-regex-open:', JSON.stringify({ keywords: EXPRESSION_OPENING_KEYWORDS, results }))
    expect(results).toEqual(EXPRESSION_OPENING_KEYWORDS.map(() => 1))
    expect(countIn("x.void / 2; 'ベッド'")).toBe(1)
    expect(countIn("await(x) / 2; '個室'")).toBe(1)
    expect(countIn("export default /https?:\\/\\//; 'ベッド'")).toBe(1)
    expect(countIn("class C extends /https?:\\/\\// {} 'ベッド'")).toBe(1)
  })

  it('the scanner leaves JSX tag slashes alone (F1 delta-verify NOTE-A)', () => {
    const countIn = (src: string) => TARGET_WORDS.reduce((sum, w) => sum + countOccurrences(stripComments(src), w), 0)
    const results = [
      countIn('</div> {/* ベッド */}'),
      countIn('<Foo bar={x} /> {/* 個室 */}'),
      countIn('</div>\n{/* 満室\n */}'),
      countIn('</div> // 清掃'),
      countIn("const r = /[<>]/; 'ベッド'"),
      countIn("if (a < b) { 'ベッド' }"),
    ]
    console.log('jsx-tag-slashes:', JSON.stringify(results))
    expect(results).toEqual([0, 0, 0, 0, 1, 1])
  })

  // §3 C5 — one page assembler owns both calls; the screen only imports a type.
  it('§3 C5 — resourceWordsFor/wordsForStore/business_type/resource-words occur under today/ only in page.tsx, and in TodayScreen.tsx only as the authorized type import', () => {
    const TYPE_IMPORT_LINE = "import type { ResourceWords } from '@/business/lib/resource-words'"
    const PATTERN = /business_type|resourceWordsFor|wordsForStore|resource-words/
    const hits: string[] = []
    for (const file of listSourceFiles(TODAY_DIR)) {
      const rel = relative(TODAY_DIR, file)
      let stripped = stripComments(readFileSync(file, 'utf8'))
      if (rel === 'TodayScreen.tsx') {
        // exactly ONE authorized type-only import line — assert it, then
        // remove ONLY that validated line before scanning for anything else.
        expect(countOccurrences(stripped, TYPE_IMPORT_LINE)).toBe(1)
        stripped = stripped.split(TYPE_IMPORT_LINE).join('')
      }
      if (PATTERN.test(stripped)) hits.push(rel)
    }
    expect(hits).toEqual(['page.tsx'])

    // §3 C5 — each lookup has one import and one call; only the map reads the column.
    const pageStripped = stripComments(readFileSync(join(TODAY_DIR, 'page.tsx'), 'utf8'))
    expect(countOccurrences(pageStripped, 'resourceWordsFor')).toBe(2)
    expect((pageStripped.match(/resourceWordsFor\(/g) ?? []).length).toBe(1)
    expect(countOccurrences(pageStripped, 'wordsForStore')).toBe(2)
    expect((pageStripped.match(/wordsForStore\(/g) ?? []).length).toBe(1)
    expect(countOccurrences(pageStripped, 'business_type')).toBe(1)
  })
})
