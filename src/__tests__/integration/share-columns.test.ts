// readSharedAt (src/lib/recording/share-columns.ts) — the SDK-1.34 trust-
// boundary read of core's shared_at column, which the installed client's own
// types don't carry yet. Every non-string/unreadable shape must close to
// null, never throw and never widen.
import { readSharedAt } from '@/lib/recording/share-columns'

describe('readSharedAt', () => {
  it('a genuine ISO string passes through', () => {
    expect(readSharedAt({ shared_at: '2026-09-14T00:00:00.000Z' })).toBe(
      '2026-09-14T00:00:00.000Z',
    )
  })

  it('null shared_at → null', () => {
    expect(readSharedAt({ shared_at: null })).toBeNull()
  })

  it('missing shared_at key → null', () => {
    expect(readSharedAt({})).toBeNull()
  })

  it('undefined row → null', () => {
    expect(readSharedAt(undefined)).toBeNull()
  })

  it('a number → null (not a cast)', () => {
    expect(readSharedAt({ shared_at: 1234567890 })).toBeNull()
  })

  it('a garbage string that Date.parse cannot read → null', () => {
    expect(readSharedAt({ shared_at: 'not-a-date' })).toBeNull()
  })

  it('an empty string → null', () => {
    expect(readSharedAt({ shared_at: '' })).toBeNull()
  })

  it('the row itself not an object (a bare string) → null', () => {
    expect(readSharedAt('2026-09-14T00:00:00.000Z')).toBeNull()
  })

  it('the row itself null → null', () => {
    expect(readSharedAt(null)).toBeNull()
  })
})
