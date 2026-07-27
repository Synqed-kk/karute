// CP1 fixture (contract §2.1 / §8): proves FacadeEndpointKey's literal union
// binds on BOTH facadeHandler call forms — an unmapped/typo'd key must fail
// tsc, not slip through as a silent runtime no-op. Type-only, no assertions:
// this file lives outside __tests__/integration so jest's testMatch never
// collects it (it would fail "must contain at least one test"). The repo's
// `npx tsc --noEmit` gate is what proves these lines — if any @ts-expect-error
// below stops erroring, the union has a hole and the build must fail loud.
import { facadeHandler } from '@/lib/app-api/handler'

const noop = async () => new Response(null)

// Plain form (`facadeHandler('key', fn)`) — valid key compiles.
facadeHandler('customer.read', noop)

// Generic form (`facadeHandler<Params>('key', fn)`) — valid key compiles.
facadeHandler<{ id: string }>('customer.read', noop)

// Plain form — an unmapped key is a tsc error.
// @ts-expect-error - 'totally.bogus.key' is not a member of FacadeEndpointKey
facadeHandler('totally.bogus.key', noop)

// Generic form — an unmapped key is a tsc error too (the generic overload
// path binds to the same union; a naive scan of only the plain form would
// have missed this half of the census).
// @ts-expect-error - 'totally.bogus.key' is not a member of FacadeEndpointKey
facadeHandler<{ id: string }>('totally.bogus.key', noop)
