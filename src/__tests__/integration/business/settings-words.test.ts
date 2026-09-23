import { settingsProps } from '@/app/[locale]/(business)/business/settings/settings-props'
import { STORE_A } from '@/business/lib/fixtures'
import { businessProfiles } from '@/business/lib/fixtures-settings'
import { wordsForStore } from '@/business/lib/resource-words'
import { blockingError, labelOfValue, searchTextOf, type RowValue, type SettingsBlock, type SettingsSection } from '@/business/lib/settings'
import {
  committedWordValues, fillWords, normalisedWordValues, overrideFromValues, wordsBlockingError,
  wordsBlockProblem, wordsLiveFact, wordsProblem, wordsReadout, wordsRoomBlock, wordsRoomOptions,
  wordsSentences, wordsTurnoverControl, wordsTurnoverFact,
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

  it('N3-5 T4 — a つ store prints 個 from ten in the example, the readout keeps つ', () => {
    const gymValues = { ...seed, [spec.typeId]: 'personal_gym' }
    const gymLabel = businessProfiles.find((p) => p.value === 'personal_gym')!.label
    const ten = wordsSentences({ ...spec, count: 10 }, gymValues, gymLabel)
    expect(ten.example).toBe('いまこの店舗にはブースが10個あります。')
    expect(ten.current).toContain('数え方 つ')
    expect(wordsSentences({ ...spec, count: 9 }, gymValues, gymLabel).example.endsWith('が9つあります。')).toBe(true)
    expect(wordsSentences({ ...spec, count: 10 }, values('ブース', 'つ'), label).example).toBe('いまこの店舗にはブースが10個あります。')
  })

  it('N3-5 T5 — a 台 store at ten keeps 台', () => {
    expect(wordsSentences({ ...spec, count: 10 }, seed, label).example.endsWith('が10台あります。')).toBe(true)
  })
})

describe('N3-4 room-class words seed and live copy', () => {
  const policyOf = (s: SettingsSection) => s.blocks.find((b) => b.id === 'people.room-policy')!
  const classControls = () => section.blocks.find((b) => b.id === 'people.equipment')!.rows
    .flatMap((r) => r.controls).filter((c) => c.id.startsWith('people.class-'))
  const optionsOf = (c: ReturnType<typeof classControls>[number]) => c.control.kind === 'segment' ? c.control.options : []
  const liveText = (v: Record<string, RowValue>) => {
    const policy = wordsRoomBlock(section, 'people.room-policy', v)!
    return [policy.title!, policy.note!, ...Object.values(policy.facts), wordsRoomBlock(section, 'people.words', v)!.facts[0]]
  }
  const liveLabels = (v: Record<string, RowValue>) => classControls().map((c) => wordsRoomOptions(section, c.id, optionsOf(c), v)!)

  it('N3-4 T1 every assembled seed equals its live copy', () => {
    const policy = policyOf(section)
    expect(wordsRoomBlock(section, 'people.room-policy', seed)).toEqual({
      title: policy.title, note: policy.note, facts: { 0: policy.facts[0], 1: policy.facts[1], 2: policy.facts[2] },
    })
    expect(policy.facts).toHaveLength(3)
    expect(wordsRoomBlock(section, 'people.words', seed)!.facts[0]).toBe(block.facts[0])
    expect(classControls().length).toBeGreaterThan(0)
    for (const c of classControls()) expect(wordsRoomOptions(section, c.id, optionsOf(c), seed)).toEqual(optionsOf(c))
  })

  it('N3-4 T2 a type change updates the noun everywhere and keeps the option values', () => {
    const hair = { ...seed, [spec.typeId]: 'hair_salon' }
    const noun = wordsForStore('hair_salon', null).resourceNoun
    const seedNoun = wordsReadout(spec, seed).current.resourceNoun
    expect(noun).not.toBe(seedNoun)
    const [title, note, f0, f1, f2, privateFact] = liveText(hair)
    for (const sentence of [title, note, f0]) {
      expect(sentence).toContain(noun)
      expect(sentence).not.toContain(seedNoun)
    }
    for (const sentence of [f0, f1, f2, privateFact]) expect(sentence).toContain(wordsForStore('hair_salon', null).privateWord!)
    expect(liveLabels(hair).map((o) => o.map((x) => x.value))).toEqual(classControls().map((c) => optionsOf(c).map((x) => x.value)))
  })

  it('N3-4 T3 a valid typed pair updates the noun and a one-sided or invalid pair resolves to base', () => {
    const typed = 'ソファ'
    const [title, note, f0] = liveText(values(typed, '台'))
    for (const sentence of [title, note, f0]) expect(sentence).toContain(typed)
    for (const v of [values(typed, ''), values('長'.repeat(9), '台')]) {
      expect(liveText(v)).toEqual(liveText(values()))
      expect(liveLabels(v)).toEqual(liveLabels(values()))
    }
  })

  it('N3-4 T4 an absent private word prints the fallback', () => {
    const yoga = { ...seed, [spec.typeId]: 'yoga_studio' }
    expect(wordsForStore('yoga_studio', null).privateWord).toBeNull()
    const fallback = spec.liveRoom.fallback
    expect(fallback.length).toBeGreaterThan(0)
    const [title, , f0, f1, f2, privateFact] = liveText(yoga)
    for (const sentence of [f0, f1, f2, privateFact]) expect(sentence).toContain(fallback)
    expect(title).toContain(wordsForStore('yoga_studio', null).resourceNoun)
    for (const options of liveLabels(yoga)) expect(options.find((o) => o.value === 'private')!.label).toBe(fallback)
  })

  it('N3-4 T5 other blocks, other controls, sections without a spec and unknown options stay null or unchanged', () => {
    for (const id of [...section.blocks.map((b) => b.id).filter((id) => !['people.room-policy', 'people.words'].includes(id)), 'absent']) {
      expect(wordsRoomBlock(section, id, seed)).toBeNull()
    }
    expect(wordsRoomOptions(section, 'people.cleanup-resource', [{ value: 'private', label: 'x' }], seed)).toBeNull()
    expect(wordsRoomOptions(section, 'x.people.class-resource', [{ value: 'private', label: 'x' }], seed)).toBeNull()
    const withoutSpec = { ...section, blocks: section.blocks.filter((b) => !b.words) }
    expect(wordsRoomBlock(withoutSpec, 'people.room-policy', seed)).toBeNull()
    expect(wordsRoomOptions(withoutSpec, 'people.class-resource', [{ value: 'private', label: 'x' }], seed)).toBeNull()
    expect(wordsRoomOptions(section, 'people.class-resource', [{ value: 'unknown', label: 'keep' }], seed)).toEqual([{ value: 'unknown', label: 'keep' }])
  })

  it('N3-4 the settings search finds the live room-policy title, not the seed', async () => {
    const { props } = await settingsProps({ locale: 'ja', store: STORE_A })
    const row = props.rail.find((r) => r.id === section.id)!
    const hair = { ...seed, [spec.typeId]: 'hair_salon' }
    const liveSection = { ...section, blocks: section.blocks.map((b) => ({ ...b, title: wordsRoomBlock(section, b.id, hair)?.title ?? b.title })) }
    expect(searchTextOf(row, liveSection)).toContain('セット面の自動割り当て')
    expect(searchTextOf(row, liveSection)).not.toContain('ベッドの自動割り当て')
    expect(searchTextOf(row, section)).toContain('ベッドの自動割り当て')
  })

  it('N3-4 T6 a slot token typed as the noun stays literal in one pass', () => {
    for (const typed of ['{noun}', '{name}']) {
      const v = values(typed, '台')
      expect(wordsProblem(spec, v)).toBeNull()
      const privateWord = wordsReadout(spec, v).current.privateWord!
      const policy = wordsRoomBlock(section, 'people.room-policy', v)!
      expect(policy.title).toBe(spec.copy.policyTitle.replace('{noun}', typed))
      expect(policy.facts[0]).toBe(spec.copy.policyFacts[0].split('{noun}').join(typed).split('{privateWord}').join(privateWord))
    }
    expect(fillWords('{noun}|{privateWord}', { noun: '{privateWord}', privateWord: 'P' })).toBe('{privateWord}|P')
  })
})
