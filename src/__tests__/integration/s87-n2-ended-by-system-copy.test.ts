/** @jest-environment node */
// model: claude-opus-5-5 · S87 N-2 (R-S87-5 amended): the line says only what
// the phone knows — sentence one alone; the unverified 'saved' claim is gone.
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

const line = (m: unknown): string => {
  const hit = JSON.stringify(m).match(/"captureEndedBySystem":"([^"]*)"/)
  if (!hit) throw new Error('captureEndedBySystem missing')
  return hit[1]
}

describe('S87 N-2 — captureEndedBySystem', () => {
  it('ja: one sentence, 録音 once, no claim that anything was saved', () => {
    expect(line(ja)).toBe('録音中に端末側で中断された可能性があります。')
    expect(line(ja)).not.toMatch(/保存/)
    expect(line(ja).match(/録音/g)).toHaveLength(1)
  })
  it('en: one sentence, no claim that anything was kept', () => {
    expect(line(en)).toBe('The device may have interrupted this recording.')
    expect(line(en)).not.toMatch(/kept|saved/i)
  })
})
