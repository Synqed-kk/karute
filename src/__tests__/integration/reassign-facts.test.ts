/**
 * F4 §5 pin 7 — reassignFacts detection: web-shape burns (appointment_id
 * only) count, phone-shape burns (karute_record_id) count, an unrelated
 * redemption does not, a photo matching the session counts, another
 * session's photo does not, and a manual karute (null session id) resolves
 * to photoCount 0 without a listPhotos crash. COUNTS ONLY — this suite also
 * pins that neither packs nor photos are ever mutated.
 */
import { reassignFacts } from '@/lib/karute/reassign-facts'

function client(overrides: {
  redemptions?: Array<Record<string, unknown>>
  photos?: Array<{ id: string; recording_session_id: string | null }>
}) {
  const listRedemptions = jest.fn(async () => overrides.redemptions ?? [])
  const listPhotos = jest.fn(async () => ({ photos: overrides.photos ?? [] }))
  return {
    synqed: { packs: { listRedemptions }, customers: { listPhotos } } as never,
    listRedemptions,
    listPhotos,
  }
}

describe('reassignFacts — money detection', () => {
  it('counts a web-shape burn (appointment_id link only, no karute_record_id)', async () => {
    const { synqed } = client({
      redemptions: [{ pack_id: 'p1', redeemed_on: '2026-08-01', appointment_id: 'appt-1' }],
    })
    const { burnCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: 'appt-1',
      recording_session_id: null,
    })
    expect(burnCount).toBe(1)
  })

  it('counts a phone-shape burn (karute_record_id link)', async () => {
    const { synqed } = client({
      redemptions: [{ pack_id: 'p1', redeemed_on: '2026-08-01', karute_record_id: 'kar-1' }],
    })
    const { burnCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: null,
      recording_session_id: null,
    })
    expect(burnCount).toBe(1)
  })

  it('does not count an unrelated redemption (neither link matches)', async () => {
    const { synqed } = client({
      redemptions: [
        { pack_id: 'p1', redeemed_on: '2026-08-01', appointment_id: 'appt-OTHER' },
        { pack_id: 'p2', redeemed_on: '2026-08-01', karute_record_id: 'kar-OTHER' },
        { pack_id: 'p3', redeemed_on: '2026-08-01' },
      ],
    })
    const { burnCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: 'appt-1',
      recording_session_id: null,
    })
    expect(burnCount).toBe(0)
  })

  it('never mutates redemptions — no write method exists on the mocked client', async () => {
    const { synqed, listRedemptions } = client({ redemptions: [] })
    await reassignFacts(synqed, 'cust-1', { id: 'kar-1', appointment_id: null, recording_session_id: null })
    expect(listRedemptions).toHaveBeenCalledWith('cust-1')
    expect(Object.keys((synqed as { packs: object }).packs)).toEqual(['listRedemptions'])
  })
})

describe('reassignFacts — photo detection', () => {
  it('counts a photo whose recording_session_id matches the record', async () => {
    const { synqed } = client({
      photos: [
        { id: 'ph1', recording_session_id: 'sess-1' },
        { id: 'ph2', recording_session_id: 'sess-OTHER' },
      ],
    })
    const { photoCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: null,
      recording_session_id: 'sess-1',
    })
    expect(photoCount).toBe(1)
  })

  it('a manual karute (null recording_session_id) resolves photoCount 0 without a listPhotos crash', async () => {
    const { synqed, listPhotos } = client({
      photos: [{ id: 'ph1', recording_session_id: null }, { id: 'ph2', recording_session_id: 'sess-1' }],
    })
    const result = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: null,
      recording_session_id: null,
    })
    expect(result.photoCount).toBe(0)
    expect(listPhotos).toHaveBeenCalledWith('cust-1')
  })

  it('never mutates photos — no write method exists on the mocked client', async () => {
    const { synqed } = client({ photos: [] })
    await reassignFacts(synqed, 'cust-1', { id: 'kar-1', appointment_id: null, recording_session_id: 'sess-1' })
    expect(Object.keys((synqed as { customers: object }).customers)).toEqual(['listPhotos'])
  })
})
