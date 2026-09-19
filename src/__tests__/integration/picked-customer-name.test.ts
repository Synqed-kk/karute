/**
 * pickedCustomerName — lifted from RecordPageView's repoint-to-searched-
 * customer handler (blind-read finding 2, fix/picker-remote-selected):
 * that handler has zero direct test coverage because RecordPageView is too
 * big to render in a test, so the fallback order is pinned here instead.
 *
 * File location note: jest's testMatch (jest.config.ts) only collects
 * `**\/__tests__/integration/**\/*.test.ts(x)` — a co-located
 * `src/lib/customers/picked-customer-name.test.ts` would never run under
 * any `npx jest ...` invocation or CI (verified: 0 matches). This file
 * lives here, next to the repo's other lib/customers pure-function suite
 * (karute-number-match.test.ts), so it actually executes.
 */
import { pickedCustomerName } from '@/lib/customers/picked-customer-name'

const CUSTOMERS = [
  { id: 'a', name: '田中花子' },
  { id: 'b', name: '佐藤一郎' },
]

describe('pickedCustomerName', () => {
  it('a passed name wins, even if a different customer with that id exists locally', () => {
    expect(pickedCustomerName('遠藤三郎', CUSTOMERS, 'a', 'unknown')).toBe('遠藤三郎')
  })

  it('an empty-string name falls through to the local list, not to unknownLabel', () => {
    expect(pickedCustomerName('', CUSTOMERS, 'b', 'unknown')).toBe('佐藤一郎')
  })

  it('not in the local list and no name → unknownLabel', () => {
    expect(pickedCustomerName(undefined, CUSTOMERS, 'z', 'unknown')).toBe('unknown')
  })

  it('no name passed → the local list name for that id', () => {
    expect(pickedCustomerName(undefined, CUSTOMERS, 'a', 'unknown')).toBe('田中花子')
  })
})
