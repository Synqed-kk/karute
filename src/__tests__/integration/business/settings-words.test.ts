import { settingsProps } from '@/app/[locale]/(business)/business/settings/settings-props'
import { STORE_A } from '@/business/lib/fixtures'
import { businessProfiles } from '@/business/lib/fixtures-settings'
import { wordsForStore } from '@/business/lib/resource-words'
import { blockingError, labelOfValue, type RowValue, type SettingsBlock, type SettingsSection } from '@/business/lib/settings'
import {
  committedWordValues, normalisedWordValues, overrideFromValues, wordsBlockingError,
  wordsBlockProblem, wordsLiveFact, wordsProblem, wordsReadout, wordsSentences,
  wordsTurnoverControl, wordsTurnoverFact,
} from '@/business/lib/settings-words'

let section: SettingsSection
let block: SettingsBlock
let spec: NonNullable<SettingsBlock['words']>
let seed: Record<string, RowValue>
let label: string
beforeAll(async () => {
  const { props } = await settingsProps({ locale: 'ja', store: STORE_A })
  section = props.sections.find((s) => s.id === 'people-equipment')!
  block = section.blocks.find((b) => b.id === 'people.words')!
  spec = block.words!
  seed = {}
  for (const s of props.sections) {
    for (const b of s.blocks) for (const r of b.rows) for (const c of r.controls) seed[c.id] = c.value
  }
  const type = section.blocks.flatMap((b) => b.rows.flatMap((r) => r.controls)).find((c) => c.id === spec.typeId)!
  label = labelOfValue(type.control, seed[spec.typeId])
})

describe('N3-3 turnover seeds and live copy', () => {
  const equipmentOf = (s: SettingsSection) => s.blocks.find((b) => b.id === 'people.equipment')!
  const cleanupOf = (s: SettingsSection) => equipmentOf(s).rows.flatMap((row) =>
    row.controls.filter((control) => control.id.startsWith('people.cleanup-')).map((control) => ({ row, control })))
  const liveCopy = (v: Record<string, RowValue>) => [
    wordsTurnoverFact(section, equipmentOf(section).id, v)!.sentence,
    ...cleanupOf(section).map(({ row, control }) => wordsTurnoverControl(section, control.id, row.label, v)!),
  ]
  const expectSeed = (s: SettingsSection, v: Record<string, RowValue>) => {
    const equipment = equipmentOf(s)
    expect(wordsTurnoverFact(s, equipment.id, v)).toEqual({ index: 1, sentence: equipment.facts[1] })
    const controls = cleanupOf(s)
    expect(controls.length).toBeGreaterThan(0)
    for (const { row, control } of controls) {
      expect(wordsTurnoverControl(s, control.id, row.label, v)).toBe(control.aria)
    }
  }

  it('N3-3 T1 every assembled seed equals its live copy', () => {
    expectSeed(section, seed)
  })

  it('N3-3 T1 a real dental assembly seeds its fact and every cleanup name from the store word', async () => {
    jest.doMock('@/business/lib/data', () => {
      const actual = jest.requireActual('@/business/lib/data')
      return { ...actual, listStoreOptions: async () => (await actual.listStoreOptions()).map((store: { id: string }) =>
        store.id === STORE_A ? { ...store, business_type: 'dental_clinic' } : store) }
    })
    try {
      await jest.isolateModulesAsync(async () => {
        const { settingsProps: assemble } = await import('@/app/[locale]/(business)/business/settings/settings-props')
        const { props } = await assemble({ locale: 'ja', store: STORE_A })
        const dental = props.sections.find((s) => s.id === section.id)!
        const dentalSeed = Object.fromEntries(dental.blocks.flatMap((b) => b.rows.flatMap((r) => r.controls.map((c) => [c.id, c.value]))))
        expectSeed(dental, dentalSeed)
        const word = wordsForStore('dental_clinic', null).turnoverWord!
        expect(word).not.toBe(wordsReadout(spec, seed).current.turnoverWord)
        expect(equipmentOf(dental).facts[1]).toBe(spec.copy.turnoverFact.replace('{turnoverName}', word))
        for (const { row, control } of cleanupOf(dental)) {
          expect(control.aria).toBe(spec.copy.turnoverControl.replace('{name}', row.label).replace('{turnoverName}', word))
        }
      })
    } finally { jest.dontMock('@/business/lib/data') }
  })

  it('N3-3 T2 a type change updates the fact and every cleanup name', () => {
    const word = wordsForStore('dental_clinic', null).turnoverWord!
    const seedWord = wordsReadout(spec, seed).current.turnoverWord!
    expect(word).not.toBe(seedWord)
    for (const sentence of liveCopy({ ...seed, [spec.typeId]: 'dental_clinic' })) {
      expect(sentence).toContain(word)
      expect(sentence).not.toContain(seedWord)
    }
  })

  it('N3-3 T3 a valid custom word updates both surfaces and invalid words resolve to base', () => {
    const custom = '換気'
    for (const sentence of liveCopy(values('', '', custom))) expect(sentence).toContain(custom)
    for (const invalid of ['休憩', '長'.repeat(9)]) {
      expect(liveCopy(values('', '', invalid))).toEqual(liveCopy(values()))
    }
  })

  it('N3-3 T4 absent turnover uses the fallback and ignores a typed word while the readout stays absent', () => {
    const yoga = { ...values(), [spec.typeId]: 'yoga_studio' }
    for (const sentence of liveCopy(yoga)) expect(sentence).toContain(spec.liveTurnover.fallback)
    const typed = { ...yoga, [spec.turnoverId]: '換気' }
    expect(liveCopy(typed)).toEqual(liveCopy(yoga))
    for (const v of [yoga, typed]) {
      expect(wordsReadout(spec, v).current.turnoverWord).toBeNull()
      expect(wordsSentences(spec, v, label).current).toContain(spec.copy.noTurnover)
    }
  })

  it('N3-3 T5 unrelated blocks, controls and sections without a spec return null', () => {
    for (const id of [...section.blocks.filter((b) => b.id !== equipmentOf(section).id).map((b) => b.id), 'absent']) {
      expect(wordsTurnoverFact(section, id, seed)).toBeNull()
    }
    expect(wordsTurnoverControl(section, 'people.class-resource', 'resource', seed)).toBeNull()
    const withoutSpec = { ...section, blocks: section.blocks.filter((b) => !b.words) }
    for (const s of [withoutSpec, { ...section, blocks: [] }]) {
      expect(wordsTurnoverFact(s, equipmentOf(section).id, seed)).toBeNull()
      expect(wordsTurnoverControl(s, 'people.cleanup-resource', 'resource', seed)).toBeNull()
    }
  })

  it('N3-3 T6 slot tokens inside a resource name stay literal', () => {
    const name = 'resource {turnoverName} {noun}'
    const word = wordsReadout(spec, seed).current.turnoverWord!
    expect(wordsTurnoverControl(section, 'people.cleanup-resource', name, seed))
      .toBe(spec.copy.turnoverControl.replace('{turnoverName}', word).replace('{name}', name))
  })
})

const values = (noun = '', counter = '', turnover = ''): Record<string, RowValue> => ({
  ...seed, [spec.nounId]: noun, [spec.counterId]: counter, [spec.turnoverId]: turnover,
})

describe('PKT-BUILD-N3-2 §3 H3 — the pure save door', () => {
  it('N3-2 §3 m1 — trim and normalise the three text values', () => {
    const v = values('\u3000ベッド\u3000', ' 台 ', '\u3000清掃\u3000')
    expect(normalisedWordValues(spec, v)).toEqual({
      [spec.nounId]: 'ベッド', [spec.counterId]: '台', [spec.turnoverId]: '清掃',
    })
    expect(overrideFromValues(spec, v)).toEqual({ resourceNoun: 'ベッド', counter: '台', turnoverWord: '清掃' })
  })

  it('N3-2 §3 H3 — empty, spaces-only and standard are absent; all absent returns null', () => {
    expect(overrideFromValues(spec, values('', ' \u3000 ', ''))).toBeNull()
    expect(overrideFromValues(spec, {})).toBeNull()
    expect(overrideFromValues(spec, { ...values(), [spec.fullId]: false })).toBeNull()
    expect(overrideFromValues(spec, values('ベッド'))).toEqual({ resourceNoun: 'ベッド' })
    expect(overrideFromValues(spec, values('', '台'))).toEqual({ counter: '台' })
  })

  it.each([
    ['ベッド', '', '', 'pair'],
    ['𠮷'.repeat(8), '台', '', null],
    ['𠮷'.repeat(9), '台', '', 'length'],
    ['a|b', '台', '', 'bar'],
    ['', '', '休憩', 'reserved'],
    ['ブ ース', '台', '', 'space'],
  ])('N3-2 §3 H3 — the one validator judges %j / %j / %j as %s', (noun, counter, turnover, problem) => {
    expect(wordsProblem(spec, values(noun!, counter!, turnover!))).toBe(problem)
  })

  it('N3-2 §3 H3 — full values pass through to the one validator', () => {
    expect(wordsProblem(spec, { ...values(), [spec.fullId]: 'unknown' })).toBe('full')
    expect(overrideFromValues(spec, { ...values(), [spec.fullId]: '満席' })).toEqual({ fullWord: '満席' })
  })

  it.each([
    ['middle', 'ブ\u200bース'],
    ['leading', '\u200bブース'],
  ])('PKT-FIX-N3-2-F1-c — %s zero-width space is rejected through the door', (_, noun) => {
    const v = values(noun, '台')
    expect(wordsProblem(spec, v)).toBe('space')
    const readout = wordsReadout(spec, v)
    expect(readout.current).toBe(readout.standard)
  })

  it('N3-2 §3 H3 — empty fields and a gym type preserve both base identities', () => {
    const readout = wordsReadout(spec, { ...values(), [spec.typeId]: 'personal_gym' })
    expect(readout.current).toBe(readout.standard)
    expect(readout.current).toBe(wordsForStore('personal_gym', null))
  })

  it('N3-2 §3 m5 — a typed pair survives a type change while standard full follows the type', () => {
    const v = values('ベッド', '台')
    expect(v[spec.fullId]).toBe('standard')
    expect(wordsReadout(spec, v).current.fullWord).toBe(wordsForStore('beauty_chiropractic', null).fullWord)
    v[spec.typeId] = 'personal_gym'
    const current = wordsReadout(spec, v).current
    expect(current.resourceNoun).toBe('ベッド')
    expect(current.counter).toBe('台')
    expect(current.fullWord).toBe(wordsForStore('personal_gym', null).fullWord)
    expect(v[spec.fullId]).toBe('standard')
  })

  it('N3-2 §3 H3 — null turnover stays null and prints the supplied no-turnover copy', () => {
    const v = { ...values('', '', '清掃'), [spec.typeId]: 'yoga_studio' }
    expect(wordsReadout(spec, v).current.turnoverWord).toBeNull()
    expect(wordsSentences(spec, v, label).current).toContain(spec.copy.noTurnover)
  })

  it('N3-2 §3 H3 — invalid overrides never enter a resolved row', () => {
    const readout = wordsReadout(spec, values('ブ ース', '台'))
    expect(readout.current).toBe(readout.standard)
  })

  it('N3-2 §3 H3 — zero equipment uses the zero sentence', () => {
    expect(wordsSentences({ ...spec, count: 0 }, seed, label).example).toBe('いまこの店舗にはベッドが登録されていません。')
  })

  it('N3-2 §3 H3 — reserved copy receives the normalised turnover value', () => {
    const v = values('', '', ' 休憩\u3000')
    expect(wordsBlockProblem(block, v)).toBe(spec.copy.problems.reserved.replace('{word}', '休憩'))
    expect(wordsBlockingError(section, v)).toBe(wordsBlockProblem(block, v))
  })

  it('PKT-FIX-N3-2-F1-b — an unsupplied problem slot stays literal', () => {
    const words = { ...spec, copy: { ...spec.copy, problems: { ...spec.copy.problems, pair: '{noun}が足りません' } } }
    const problem = wordsBlockProblem({ ...block, words }, values('ベッド'))
    expect(problem).toBe('{noun}が足りません')
    expect(problem).not.toContain('undefined')
  })

  it('N3-2 §3 m3 — live fact equals the real seed fact and follows a type change', () => {
    const equipment = section.blocks.find((b) => b.id === 'people.equipment')!
    expect(wordsLiveFact(section, equipment.id, seed, label)).toEqual({ index: 0, sentence: equipment.facts[0] })
    const gymLabel = businessProfiles.find((p) => p.value === 'personal_gym')!.label
    const changed = wordsLiveFact(section, equipment.id, { ...seed, [spec.typeId]: 'personal_gym' }, gymLabel)!
    expect(changed.index).toBe(0)
    expect(changed.sentence).toBe(`いまこの店舗には${wordsForStore('personal_gym', null).resourceNoun}が${spec.count}${wordsForStore('personal_gym', null).counter}あります。`)
    for (const other of section.blocks.filter((b) => b.id !== equipment.id)) {
      expect(wordsLiveFact(section, other.id, seed, label)).toBeNull()
    }
    expect(wordsLiveFact(section, 'absent', seed, label)).toBeNull()
  })

  it('N3-2 §3 m2 — composed blocked and the block agree on a pair, then clear together', () => {
    const v = values('ベッド')
    expect(wordsBlockProblem(block, v)).toBe(spec.copy.problems.pair)
    expect(blockingError(section, v) ?? wordsBlockingError(section, v)).toBe(spec.copy.problems.pair)
    v[spec.counterId] = '台'
    expect(wordsBlockProblem(block, v)).toBeNull()
    expect(blockingError(section, v) ?? wordsBlockingError(section, v)).toBeNull()
  })

  it('N3-2 §3 H3 — committed values contain exactly the three normalised text ids', () => {
    expect(committedWordValues(section, values(' ベッド ', '\u3000台\u3000', ' 清掃 '))).toEqual({
      [spec.nounId]: 'ベッド', [spec.counterId]: '台', [spec.turnoverId]: '清掃',
    })
    expect(committedWordValues({ ...section, blocks: [] }, seed)).toEqual({})
    expect(wordsBlockingError({ ...section, blocks: [] }, seed)).toBeNull()
  })

  it('N3-2 §3 H3 — single-pass filling keeps inserted {full} literal in all three sentences', () => {
    const v = values('{full}', '台')
    expect(wordsProblem(spec, v)).toBeNull()
    const sentences = wordsSentences(spec, v, '{full}')
    expect(sentences.current).toBe('呼び名 {full} ・ 数え方 台 ・ すべて埋まったとき 満室 ・ あいだの作業 清掃')
    expect(sentences.standard).toBe('{full}の標準: 呼び名 ベッド ・ 数え方 台 ・ すべて埋まったとき 満室 ・ あいだの作業 清掃')
    expect(sentences.example).toBe(`いまこの店舗には{full}が${spec.count}台あります。`)
  })
})
