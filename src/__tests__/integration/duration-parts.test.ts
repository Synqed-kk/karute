// R8 fix round 1 (§6a / LENS §5e): durationParts used to be copy-pasted
// verbatim into KaruteDetailView.tsx and DiscardReasonsSection.tsx. Lifted to
// src/lib/karute/duration.ts, imported by both — this pins the one
// implementation's output.
import { durationParts } from '@/lib/karute/duration'

describe('durationParts', () => {
  it('splits whole minutes + zero-padded seconds', () => {
    expect(durationParts(252)).toEqual({ m: '4', s: '12' })
    expect(durationParts(60)).toEqual({ m: '1', s: '00' })
    expect(durationParts(5)).toEqual({ m: '0', s: '05' })
  })

  it('floors a fractional value to a real clock reading', () => {
    expect(durationParts(59.9)).toEqual({ m: '0', s: '59' })
  })

  it('a negative value floors to 0分00秒, never a negative or NaN reading', () => {
    expect(durationParts(-10)).toEqual({ m: '0', s: '00' })
  })
})
