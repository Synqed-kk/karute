/**
 * The find-or-create identity ladder — what replaces the name-only matcher that
 * minted 187 duplicates in a day. Pins: QR-id wins, phone only on a UNIQUE match,
 * email-conflict refuses to fuse, name is byte-exact AND unambiguous, and an
 * ambiguous same-name with no confirmer CREATES (never guesses a wrong merge).
 */
import {
  resolveByQrIdentity,
  buildCustomerIndex,
  candidatesFor,
  addToIndex,
  type IdentityCandidates,
} from '@/lib/sync/qr-identity'

const base: IdentityCandidates = { byQrId: null, byPhoneExact: [], byEmailExact: null, byNameExact: [] }

describe('resolveByQrIdentity', () => {
  it('QR customer id wins over everything', () => {
    const r = resolveByQrIdentity({ ...base, byQrId: 'C1', byPhoneExact: ['C2'], byEmailExact: 'C3', byNameExact: ['C4'] })
    expect(r).toEqual({ customerId: 'C1', reason: 'qr-id' })
  })

  it('matches by phone when it resolves to EXACTLY one customer', () => {
    expect(resolveByQrIdentity({ ...base, byPhoneExact: ['C2'] })).toEqual({ customerId: 'C2', reason: 'phone' })
  })

  it('does NOT match by phone when >1 customer shares the phone (household) — falls through', () => {
    // ambiguous phone + no other signal → create, never guess.
    expect(resolveByQrIdentity({ ...base, byPhoneExact: ['C2', 'C9'] })).toEqual({ customerId: null, reason: 'create' })
  })

  it('phone wins but FLAGS when email points at a different customer (no fusion)', () => {
    const r = resolveByQrIdentity({ ...base, byPhoneExact: ['C2'], byEmailExact: 'C7' })
    expect(r).toEqual({ customerId: 'C2', reason: 'phone-email-conflict' })
  })

  it('phone + matching email is a clean phone match', () => {
    expect(resolveByQrIdentity({ ...base, byPhoneExact: ['C2'], byEmailExact: 'C2' })).toEqual({ customerId: 'C2', reason: 'phone' })
  })

  it('matches by email when there is no phone match (phone-less record)', () => {
    expect(resolveByQrIdentity({ ...base, byEmailExact: 'C3' })).toEqual({ customerId: 'C3', reason: 'email' })
  })

  it('matches by byte-exact name only when EXACTLY one customer has it', () => {
    expect(resolveByQrIdentity({ ...base, byNameExact: ['C4'] })).toEqual({ customerId: 'C4', reason: 'name' })
  })

  it('CREATES (never guesses) when two real people share the exact name + no confirmer', () => {
    // 同姓同名 with no phone/email → creating a recoverable dup beats a wrong merge.
    expect(resolveByQrIdentity({ ...base, byNameExact: ['C4', 'C5'] })).toEqual({ customerId: null, reason: 'create-ambiguous-name' })
  })

  it('creates when nothing matches', () => {
    expect(resolveByQrIdentity(base)).toEqual({ customerId: null, reason: 'create' })
  })
})

describe('buildCustomerIndex + candidatesFor (the route wiring)', () => {
  const existing = [
    { id: 'A', name: '田中 美咲', phone: '08011112222', email: 'misaki@x.jp' },
    { id: 'B', name: '佐藤 健', phone: null, email: null },
    { id: 'C', name: '佐藤 健', phone: '08033334444', email: null }, // 同姓同名 with B
    { id: 'D', name: '鈴木 花', phone: null, email: 'hana@x.jp' },
  ]

  it('indexes same-name to multiple ids, exact phone, unique email; skips blanks', () => {
    const idx = buildCustomerIndex(existing)
    expect(idx.idsByName.get('佐藤 健')).toEqual(['B', 'C'])
    expect(idx.idsByPhone.get('08011112222')).toEqual(['A'])
    expect(idx.idByEmail.get('hana@x.jp')).toBe('D')
    expect(idx.idsByPhone.has('')).toBe(false) // null phones never indexed
  })

  it('RETURNING customer with exact phone resolves to the existing id (NOT a new mint)', () => {
    const idx = buildCustomerIndex(existing)
    const r = resolveByQrIdentity(candidatesFor(idx, { customerName: '田中 美咲', customerPhone: '08011112222', customerEmail: 'misaki@x.jp' }))
    expect(r).toEqual({ customerId: 'A', reason: 'phone' })
  })

  it('RETURNING customer with a UNIQUE exact name (no phone/email) resolves, not creates', () => {
    const idx = buildCustomerIndex(existing)
    const r = resolveByQrIdentity(candidatesFor(idx, { customerName: '田中 美咲', customerPhone: null, customerEmail: null }))
    expect(r).toEqual({ customerId: 'A', reason: 'name' })
  })

  it('AMBIGUOUS same-name (佐藤 健) with no confirmer creates instead of guessing', () => {
    const idx = buildCustomerIndex(existing)
    const r = resolveByQrIdentity(candidatesFor(idx, { customerName: '佐藤 健', customerPhone: null, customerEmail: null }))
    expect(r).toEqual({ customerId: null, reason: 'create-ambiguous-name' })
  })

  it('a NEW customer creates, and after addToIndex a SECOND reservation matches it (no re-mint in one run)', () => {
    const idx = buildCustomerIndex(existing)
    const newRes = { customerName: '新顔 太郎', customerPhone: '08099998888', customerEmail: null }
    // first sighting → no match → create
    expect(resolveByQrIdentity(candidatesFor(idx, newRes))).toEqual({ customerId: null, reason: 'create' })
    // route registers the freshly-created row...
    addToIndex(idx, { id: 'NEW1', name: newRes.customerName, phone: newRes.customerPhone, email: null })
    // ...so the same customer's next reservation this run resolves instead of minting again
    expect(resolveByQrIdentity(candidatesFor(idx, newRes))).toEqual({ customerId: 'NEW1', reason: 'phone' })
  })
})
