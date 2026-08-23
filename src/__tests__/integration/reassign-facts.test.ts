/**
 * F4 §5 pin 7 — reassignFacts detection: web-shape burns (appointment_id
 * only) count, phone-shape burns (karute_record_id) count, an unrelated
 * redemption does not, a photo matching the session counts, another
 * session's photo does not, and a manual karute (null session id) resolves
 * to photoCount 0 without a listPhotos crash. COUNTS ONLY — this suite also
 * pins that neither packs nor photos are ever mutated.
 *
 * R11-1 (fix round 11, Greptile round-6 closure): the single burnCount split
 * into linkedBurnCount (link-arm hits — provable) and sameDayBurnCount
 * (day-arm-only hits — presence, never attribution). Pins below prove the
 * two buckets are mutually exclusive: a link-shaped row landing on the SAME
 * day as session_date counts ONLY as linked, never double-counted into
 * sameDayBurnCount too.
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
  it('counts a web-shape burn (appointment_id link only, no karute_record_id) as LINKED', async () => {
    const { synqed } = client({
      redemptions: [{ pack_id: 'p1', redeemed_on: '2026-08-01', appointment_id: 'appt-1' }],
    })
    const { linkedBurnCount, sameDayBurnCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: 'appt-1',
      recording_session_id: null,
      session_date: null,
    })
    expect(linkedBurnCount).toBe(1)
    expect(sameDayBurnCount).toBe(0)
  })

  it('counts a phone-shape burn (karute_record_id link) as LINKED', async () => {
    const { synqed } = client({
      redemptions: [{ pack_id: 'p1', redeemed_on: '2026-08-01', karute_record_id: 'kar-1' }],
    })
    const { linkedBurnCount, sameDayBurnCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: null,
      recording_session_id: null,
      session_date: null,
    })
    expect(linkedBurnCount).toBe(1)
    expect(sameDayBurnCount).toBe(0)
  })

  it('does not count an unrelated redemption in EITHER bucket (neither link matches, no same-day arm)', async () => {
    const { synqed } = client({
      redemptions: [
        { pack_id: 'p1', redeemed_on: '2026-08-01', appointment_id: 'appt-OTHER' },
        { pack_id: 'p2', redeemed_on: '2026-08-01', karute_record_id: 'kar-OTHER' },
        { pack_id: 'p3', redeemed_on: '2026-08-01' },
      ],
    })
    const { linkedBurnCount, sameDayBurnCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: 'appt-1',
      recording_session_id: null,
      session_date: null,
    })
    expect(linkedBurnCount).toBe(0)
    expect(sameDayBurnCount).toBe(0)
  })

  // F-1 (fix round 1): the third arm — a redemption on the SAME JST calendar
  // day as record.session_date, reusing packs.ts's recovery-burn day-compare
  // (isSameJstDay) rather than a second hand-rolled JST rule. R11-1: this arm
  // now feeds sameDayBurnCount ONLY, never linkedBurnCount.
  it('counts a redemption on the SAME JST day as session_date (no link at all) into sameDayBurnCount ONLY', async () => {
    const { synqed } = client({
      redemptions: [{ pack_id: 'p1', redeemed_on: '2026-08-15' }],
    })
    const { linkedBurnCount, sameDayBurnCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: null,
      recording_session_id: null,
      session_date: '2026-08-15',
    })
    expect(sameDayBurnCount).toBe(1)
    expect(linkedBurnCount).toBe(0)
  })

  it('does NOT count a redemption on an ADJACENT JST day, in either bucket', async () => {
    const { synqed } = client({
      redemptions: [{ pack_id: 'p1', redeemed_on: '2026-08-16' }],
    })
    const { linkedBurnCount, sameDayBurnCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: null,
      recording_session_id: null,
      session_date: '2026-08-15',
    })
    expect(sameDayBurnCount).toBe(0)
    expect(linkedBurnCount).toBe(0)
  })

  it('null session_date skips the same-day arm — a same-day-looking redemption is NOT counted, no crash', async () => {
    const { synqed } = client({
      redemptions: [{ pack_id: 'p1', redeemed_on: '2026-08-15' }],
    })
    const { linkedBurnCount, sameDayBurnCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: null,
      recording_session_id: null,
      session_date: null,
    })
    expect(sameDayBurnCount).toBe(0)
    expect(linkedBurnCount).toBe(0)
  })

  // R3-2 (fix round 3, Greptile issue 2 — REAL): the same-day arm can match
  // MULTIPLE redemptions against one karute — the count must reflect exactly
  // that (2, not 1), matching the day-scoped, unconfirmed claim the R11-1
  // copy and audit detail key (same_day_burn_count) make.
  it('counts BOTH of two same-day redemptions (no link on either) — the day-scoped, unconfirmed claim', async () => {
    const { synqed } = client({
      redemptions: [
        { pack_id: 'p1', redeemed_on: '2026-08-15' },
        { pack_id: 'p2', redeemed_on: '2026-08-15' },
      ],
    })
    const { sameDayBurnCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: null,
      recording_session_id: null,
      session_date: '2026-08-15',
    })
    expect(sameDayBurnCount).toBe(2)
  })

  // R11-1 pin (packet pin 1): a link-shaped row whose redeemed_on ALSO falls
  // on session_date must land in linkedBurnCount ONLY — proves the two
  // buckets are mutually exclusive by construction, not a filter-then-
  // subtract that could double-count if written differently.
  it('a LINK-shaped row that also matches the same-day arm counts ONLY as linked, never double-counted into sameDayBurnCount', async () => {
    const { synqed } = client({
      redemptions: [{ pack_id: 'p1', redeemed_on: '2026-08-15', karute_record_id: 'kar-1' }],
    })
    const { linkedBurnCount, sameDayBurnCount } = await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: null,
      recording_session_id: null,
      session_date: '2026-08-15',
    })
    expect(linkedBurnCount).toBe(1)
    expect(sameDayBurnCount).toBe(0)
  })

  it('never mutates redemptions — no write method exists on the mocked client', async () => {
    const { synqed, listRedemptions } = client({ redemptions: [] })
    await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: null,
      recording_session_id: null,
      session_date: null,
    })
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
      session_date: null,
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
      session_date: null,
    })
    expect(result.photoCount).toBe(0)
    expect(listPhotos).toHaveBeenCalledWith('cust-1')
  })

  it('never mutates photos — no write method exists on the mocked client', async () => {
    const { synqed } = client({ photos: [] })
    await reassignFacts(synqed, 'cust-1', {
      id: 'kar-1',
      appointment_id: null,
      recording_session_id: 'sess-1',
      session_date: null,
    })
    expect(Object.keys((synqed as { customers: object }).customers)).toEqual(['listPhotos'])
  })
})
