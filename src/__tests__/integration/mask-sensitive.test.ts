// mask-sensitive.ts must stay import-free: it runs in the browser and on edge
// through the Sentry exit (item 102). errors.ts pulls node:crypto via
// verify-bearer.ts, which is why maskSensitive was moved out of it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { masked, maskSensitive, UUID_RE } from '@/lib/text/mask-sensitive'
import { F1_FORMS, LABEL_FORMS, S2_CUT_SHAPES, residue } from './helpers/sentry-exit-plants'

const SRC = readFileSync(join(process.cwd(), 'src/lib/text/mask-sensitive.ts'), 'utf8')

describe('mask-sensitive.ts — no imports at all', () => {
  it('has no import statement and no require call', () => {
    expect(SRC).not.toMatch(/^\s*import\b/m)
    expect(SRC).not.toMatch(/\bimport\s*\(/)
    expect(SRC).not.toMatch(/\brequire\s*\(/)
  })

  it('negative control: the same checks catch an import and a require', () => {
    expect("import { x } from 'y'\n").toMatch(/^\s*import\b/m)
    expect("const a = require('b')").toMatch(/\brequire\s*\(/)
    expect('await import("c")').toMatch(/\bimport\s*\(/)
  })
})

describe('mask-sensitive.ts — the moved function behaves as before', () => {
  it('masks the same shapes errors.ts masked', () => {
    const at = ['tanaka', 'example.com'].join('@')
    expect(maskSensitive(`mail ${at}`)).toBe('mail <email>')
    expect(maskSensitive('customer 田中花子')).toBe('customer <text>')
    expect(maskSensitive('call 090-1234-5678')).toBe('call <phone>')
    expect(maskSensitive('https://x.test/a?q=1')).toBe('https://x.test/a')
  })

  it('UUID_RE is the unanchored canonical-UUID pattern', () => {
    expect(UUID_RE.test('x3f2b1c4d-1111-4222-8333-444455556666y')).toBe(true)
    expect(UUID_RE.test('not-a-uuid')).toBe(false)
  })
})

describe('mask-sensitive.ts — NFKC, email and phone before the text rule (R-S112-5 F1)', () => {
  it.each(F1_FORMS)('%j: no digit and no local part survive', (form) => {
    const out = maskSensitive(form)
    expect(out).not.toMatch(/\d/)
    expect(out).not.toMatch(/tanaka|hanako/i)
  })

  it('a separated run below 10 digits and a date stay readable', () => {
    expect(maskSensitive('retry 3 of 5 at 2026-10-08')).toBe('retry 3 of 5 at 2026-10-08')
    expect(maskSensitive('03-123-4567')).toBe('<phone>')
  })
})

describe('R-S115-1 harness plants: label forms and S2 look-alike cuts', () => {
  const secret = ['Zk4', 'pVw9'].join('')
  it.each(LABEL_FORMS.map((f) => [f(secret)]))('%s: maskSensitive loses the value', (form) => {
    expect(maskSensitive(`login failed ${form} again`)).not.toContain(secret)
  })
  it.each(S2_CUT_SHAPES)('%s cut at 2000 after Japanese text: no letter or digit leaves', (_n, shape) => {
    for (let k = 1965; k <= 1999; k++) {
      expect(residue(masked('あ'.repeat(k) + shape + 'ん'.repeat(60), 5000) ?? '')).toBe('')
    }
  })
})
