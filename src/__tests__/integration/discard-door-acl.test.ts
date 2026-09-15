// R8 discarded-record door (⚖ Liam 2026-09-13) — canOpenDiscardedRecord (A3).
// Split from discard-door-read.test.ts so piece 3 (the ACL helper + wiring)
// can land as its own gated commit, separate from piece 2 (the read siblings).
import { canOpenDiscardedRecord } from '@/lib/auth/recording-acl'

describe('canOpenDiscardedRecord (A3)', () => {
  it('the record’s own staffer always opens it, capability or not, any store', () => {
    expect(
      canOpenDiscardedRecord({
        ownerStaffId: 'staff-1',
        viewerStaffId: 'staff-1',
        holdsDiscardView: false,
        allowedStoreIds: [],
        recordStoreId: 'store-b',
      }),
    ).toBe(true)
  })

  it('a discardView holder opens ANY owner’s record when unrestricted (allowedStoreIds null)', () => {
    expect(
      canOpenDiscardedRecord({
        ownerStaffId: 'other-staff',
        viewerStaffId: 'me',
        holdsDiscardView: true,
        allowedStoreIds: null,
        recordStoreId: 'store-b',
      }),
    ).toBe(true)
  })

  it('a discardView holder clamped to store-a is REFUSED a store-b record', () => {
    expect(
      canOpenDiscardedRecord({
        ownerStaffId: 'other-staff',
        viewerStaffId: 'me',
        holdsDiscardView: true,
        allowedStoreIds: ['store-a'],
        recordStoreId: 'store-b',
      }),
    ).toBe(false)
  })

  it('a discardView holder clamped to store-a opens a store-a record', () => {
    expect(
      canOpenDiscardedRecord({
        ownerStaffId: 'other-staff',
        viewerStaffId: 'me',
        holdsDiscardView: true,
        allowedStoreIds: ['store-a'],
        recordStoreId: 'store-a',
      }),
    ).toBe(true)
  })

  it('neither owner nor discardView → refused', () => {
    expect(
      canOpenDiscardedRecord({
        ownerStaffId: 'other-staff',
        viewerStaffId: 'me',
        holdsDiscardView: false,
        allowedStoreIds: null,
        recordStoreId: null,
      }),
    ).toBe(false)
  })

  it('an ownerless record still needs the capability — never an automatic open', () => {
    expect(
      canOpenDiscardedRecord({
        ownerStaffId: null,
        viewerStaffId: 'me',
        holdsDiscardView: false,
        allowedStoreIds: null,
        recordStoreId: null,
      }),
    ).toBe(false)
    expect(
      canOpenDiscardedRecord({
        ownerStaffId: null,
        viewerStaffId: 'me',
        holdsDiscardView: true,
        allowedStoreIds: null,
        recordStoreId: null,
      }),
    ).toBe(true)
  })
})
