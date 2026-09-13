// readSharedAt / updateRecordingShare (src/lib/recording/share-columns.ts) —
// the SDK-1.34 trust-boundary read of core's shared_at column, and the typed
// write wrapper (D13), both predating the installed client's own types.
// Every non-string/unreadable read shape must close to null, never throw and
// never widen; the write must send exactly the two share columns, nothing
// more, nothing less.
import { readSharedAt, updateRecordingShare } from '@/lib/recording/share-columns'

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

describe('updateRecordingShare', () => {
  it('sends exactly { shared_at, shared_by_staff_id } to recordings.update — nothing else', async () => {
    const update = jest.fn(async (_id: string, _input: unknown) => ({}))
    const synqed = { recordings: { update } } as unknown as Parameters<typeof updateRecordingShare>[0]
    await updateRecordingShare(synqed, 'row-1', {
      shared_at: '2026-09-14T00:00:00.000Z',
      shared_by_staff_id: 'staff-1',
    })
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('row-1', {
      shared_at: '2026-09-14T00:00:00.000Z',
      shared_by_staff_id: 'staff-1',
    })
  })

  it('an unshare write sends both fields null', async () => {
    const update = jest.fn(async (_id: string, _input: unknown) => ({}))
    const synqed = { recordings: { update } } as unknown as Parameters<typeof updateRecordingShare>[0]
    await updateRecordingShare(synqed, 'row-1', { shared_at: null, shared_by_staff_id: null })
    expect(update).toHaveBeenCalledWith('row-1', { shared_at: null, shared_by_staff_id: null })
  })
})
