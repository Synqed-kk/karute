/**
 * matchKaruteNumber (P3 cross-branch search, ⚖ Liam 2026-09-16): the ONE
 * place that decides a search term is a karute-number query and does the
 * match — shared by listAllCustomers and the company-wide picker search.
 */
import { matchKaruteNumber, foldSearchDigits } from '@/lib/customers/karute-number-match'

const rows = [
  { id: 'a', karute_number: 42 },
  { id: 'b', karute_number: 7 },
  { id: 'c', karute_number: null },
]

describe('matchKaruteNumber', () => {
  it('finds an exact karute_number match', () => {
    expect(matchKaruteNumber('0042', rows).map((r) => r.id)).toEqual(['a'])
  })

  it('folds full-width digits the same way phone search already does', () => {
    expect(matchKaruteNumber('４２', rows).map((r) => r.id)).toEqual(['a'])
    expect(foldSearchDigits('４２')).toBe('42')
  })

  it('rejects a non-digit term (a name search, not a chart number)', () => {
    expect(matchKaruteNumber('山田', rows)).toEqual([])
  })

  it('rejects a term over 6 digits (never a real karute number at salon scale)', () => {
    const withBigNumber = [{ id: 'z', karute_number: 1234567 }]
    expect(matchKaruteNumber('1234567', withBigNumber)).toEqual([])
  })

  it('an empty/whitespace term never matches', () => {
    expect(matchKaruteNumber('   ', rows)).toEqual([])
  })

  it('home address is never a search key: a row whose address contains the term is not returned unless karute_number itself matches', () => {
    const withAddress = [{ id: 'a', karute_number: 99, address: '1500001 Tokyo' }]
    expect(matchKaruteNumber('1500001', withAddress)).toEqual([])
  })
})
