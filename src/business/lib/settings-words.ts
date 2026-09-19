import { wordOverrideProblem, wordsForStore, type WordOverride, type ResourceWords } from './resource-words'
import type { RowValue, SettingsBlock, SettingsSection } from './settings'

type WordsSpec = NonNullable<SettingsBlock['words']>
type Values = Record<string, RowValue>

export function normalisedWordValues(spec: WordsSpec, values: Values): Record<string, string> {
  return Object.fromEntries([spec.nounId, spec.counterId, spec.turnoverId]
    .map((id) => [id, String(values[id] ?? '').normalize('NFC').trim()]))
}

export function overrideFromValues(spec: WordsSpec, values: Values): WordOverride | null {
  const normalised = normalisedWordValues(spec, values)
  const noun = normalised[spec.nounId], counter = normalised[spec.counterId], turnover = normalised[spec.turnoverId]
  const full = values[spec.fullId]
  const override: WordOverride = {
    ...(noun ? { resourceNoun: noun } : {}),
    ...(counter ? { counter } : {}),
    ...(turnover ? { turnoverWord: turnover } : {}),
    ...(typeof full === 'string' && full !== spec.standardValue ? { fullWord: full as NonNullable<WordOverride['fullWord']> } : {}),
  }
  return Object.keys(override).length === 0 ? null : override
}

export function wordsProblem(spec: WordsSpec, values: Values) {
  return wordOverrideProblem(overrideFromValues(spec, values))
}

export function wordsReadout(spec: WordsSpec, values: Values): { current: ResourceWords; standard: ResourceWords } {
  const type = String(values[spec.typeId] ?? '')
  return { standard: wordsForStore(type, null), current: wordsForStore(type, overrideFromValues(spec, values)) }
}

function fillWords(template: string, slots: Record<string, string>): string {
  return template.replace(/\{(noun|counter|full|turnover|typeLabel|n|word)\}/g, (_, slot: string) => slots[slot])
}

export function wordsSentences(spec: WordsSpec, values: Values, typeLabel: string): { current: string; standard: string; example: string } {
  const { current, standard } = wordsReadout(spec, values)
  const fill = (template: string, row: ResourceWords) => fillWords(template, {
    noun: row.resourceNoun, counter: row.counter, full: row.fullWord,
    turnover: row.turnoverWord ?? spec.copy.noTurnover, typeLabel, n: String(spec.count),
    word: normalisedWordValues(spec, values)[spec.turnoverId],
  })
  return {
    current: fill(spec.copy.current, current), standard: fill(spec.copy.standard, standard),
    example: fill(spec.count === 0 ? spec.copy.exampleZero : spec.copy.example, current),
  }
}

export function wordsBlockProblem(block: SettingsBlock, values: Values): string | null {
  const spec = block.words
  if (!spec) return null
  const code = wordsProblem(spec, values)
  return code === null ? null : fillWords(spec.copy.problems[code], { word: normalisedWordValues(spec, values)[spec.turnoverId] })
}

export function wordsBlockingError(section: SettingsSection, values: Values): string | null {
  for (const block of section.blocks) {
    const problem = wordsBlockProblem(block, values)
    if (problem !== null) return problem
  }
  return null
}

export function wordsLiveFact(section: SettingsSection, blockId: string, values: Values, typeLabel: string): { index: number; sentence: string } | null {
  const spec = section.blocks.find((block) => block.words?.liveFact.blockId === blockId)?.words
  return spec ? { index: spec.liveFact.index, sentence: wordsSentences(spec, values, typeLabel).example } : null
}

export function committedWordValues(section: SettingsSection, values: Values): Record<string, string> {
  return Object.assign({}, ...section.blocks.map((block) => block.words ? normalisedWordValues(block.words, values) : {}))
}
