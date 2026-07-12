/**
 * Coverage for businessIdForUser (packet 03 MUST-FIX 1). This INDEXED profiles
 * lookup is the membership gate for BOTH the cookie path (getBusinessId) and the
 * facade Bearer path (resolveBearerIdentity). The fix reads the Supabase `error`
 * so a transient lookup/connection failure is no longer indistinguishable from a
 * genuinely-absent membership: an absent row (PGRST116) → membership_inactive
 * (403, fail-closed), any other error → upstream_unavailable (502, retryable).
 *
 * The service client is mocked to answer the single `.single()` lookup. Modules
 * are re-imported per case so nothing bleeds between scenarios.
 */
function mockService(result: { data?: unknown; error?: { code?: string } | null }) {
  jest.doMock('@/lib/supabase/service', () => ({
    createServiceClient: () => {
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) builder[m] = () => builder
      ;(builder as { single: unknown }).single = async () => result
      return { from: () => builder }
    },
  }))
}

async function loadHelper() {
  let fn!: typeof import('@/lib/staff').businessIdForUser
  await jest.isolateModulesAsync(async () => {
    fn = (await import('@/lib/staff')).businessIdForUser
  })
  return fn
}

describe('businessIdForUser', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('returns the customer_id when the profile row resolves', async () => {
    mockService({ data: { customer_id: 'biz-1' }, error: null })
    const businessIdForUser = await loadHelper()
    await expect(businessIdForUser('user-1')).resolves.toBe('biz-1')
  })

  it('PGRST116 (no row) → membership_inactive (403, fail-closed)', async () => {
    mockService({ data: null, error: { code: 'PGRST116' } })
    const businessIdForUser = await loadHelper()
    await expect(businessIdForUser('ghost')).rejects.toMatchObject({ code: 'membership_inactive' })
  })

  it('a NON-PGRST116 error (transient lookup failure) → upstream_unavailable (502)', async () => {
    mockService({ data: null, error: { code: '57P01' } }) // e.g. admin_shutdown
    const businessIdForUser = await loadHelper()
    await expect(businessIdForUser('user-1')).rejects.toMatchObject({ code: 'upstream_unavailable' })
  })

  it('no error but a row without customer_id → membership_inactive (403)', async () => {
    mockService({ data: { customer_id: null }, error: null })
    const businessIdForUser = await loadHelper()
    await expect(businessIdForUser('user-1')).rejects.toMatchObject({ code: 'membership_inactive' })
  })
})

export {}
