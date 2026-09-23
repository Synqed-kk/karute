// PKT-A1a — the Reserve member-card port's colour math, pinned to Reserve's OWN output.
// Every expectation below comes from reserve-card.expected-satin.json (beside this file), which the
// parity harness (scripts/business/reserve-card-parity/run.mjs) emits by running Reserve's src/lib/satin-material.ts @ c2a9f95 under node — nothing here
// is typed by hand except the inputs (the 12 curated values of W/CARD-LOOK-HANDOVER.json).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { memberTenantVars } from '@/business/lib/reserve-card/member-card-vars'
import { satinVars } from '@/business/lib/reserve-card/satin-material'

const EXPECTED: Record<string, Record<string, string>> = JSON.parse(
  readFileSync(join(process.cwd(), 'src/__tests__/integration/business/reserve-card.expected-satin.json'), 'utf8'),
).satinVars

const PALETTE = [
  '#1C2247', '#00304C', '#1F3D33', '#2D4722', '#26282B', '#4A2E22',
  '#6B1F2B', '#3B2A4F', '#EDE6D6', '#F2F4F3', '#F1D9DC', '#D7E6F2',
]

describe('reserve card port — satinVars equals Reserve @ c2a9f95', () => {
  it('the emitted file holds the 12 palette values and the 6 extra fixtures', () => {
    expect(Object.keys(EXPECTED)).toHaveLength(18)
    expect(Object.keys(EXPECTED)).toEqual(expect.arrayContaining(PALETTE))
  })

  it.each(Object.keys(EXPECTED))('%s', (hex) => {
    expect(satinVars(hex)).toEqual(EXPECTED[hex])
    expect(satinVars(hex.toLowerCase())).toEqual(EXPECTED[hex])
  })

  it('anything that is not a 6-digit hex falls back to Reserve\'s own #1c2247 (no DOM in node)', () => {
    for (const bad of [undefined, '', '#fff', '1C2247', '#1C224', '#1C2247FF', ' #1C2247']) {
      expect(satinVars(bad)).toEqual(EXPECTED['#1C2247'])
    }
  })
})

describe('reserve card port — memberTenantVars on the same inputs', () => {
  it.each(PALETTE)('cardColor %s wins; --tenant carries the brand colour', (hex) => {
    expect(memberTenantVars({ cardColor: hex, primaryColor: '#0d4a3a' })).toEqual({ '--tenant': '#0d4a3a', ...EXPECTED[hex] })
  })

  it.each(PALETTE)('no cardColor → the satin of primaryColor %s (Reserve: cardColor ?? primaryColor)', (hex) => {
    expect(memberTenantVars({ cardColor: undefined, primaryColor: hex })).toEqual({ '--tenant': hex, ...EXPECTED[hex] })
  })

  it('neither colour → satin\'s own fallback, and no --tenant', () => {
    expect(memberTenantVars({})).toEqual(EXPECTED['#1C2247'])
  })

  it('no theme at all → nothing (Reserve renders an unthemed tenant with no vars)', () => {
    expect(memberTenantVars(undefined)).toEqual({})
  })

  it('an authored second colour emits the gradient pair, primary last', () => {
    expect(memberTenantVars({ cardColor: '#1C2247', primaryColor: '#0d4a3a', brandColor2: '#1a6b55' })).toEqual({
      '--tenant': '#0d4a3a',
      ...EXPECTED['#1C2247'],
      '--tenant-g1': '#1a6b55',
      '--tenant-g2': '#0d4a3a',
    })
  })
})
