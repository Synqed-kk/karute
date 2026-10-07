// packOverlapping — the 担当未定 lane's side-by-side packer (Greptile P1 on
// #1142). Spans are minutes; the packer never assumes a duration.
import { packOverlapping, type PackSpan } from '@/components/reservation/pack-overlapping'

const id = (s: PackSpan & { id: string }) => s
const place = (items: (PackSpan & { id: string })[]) =>
  packOverlapping(items, (i) => i).map(({ item, col, cols }) => [item.id, col, cols])

describe('packOverlapping', () => {
  it('no overlap → every item is col 0 of 1 (touching ends do not overlap)', () => {
    expect(place([
      id({ id: 'a', start: 600, end: 660 }),
      id({ id: 'b', start: 660, end: 720 }),
      id({ id: 'c', start: 800, end: 830 }),
    ])).toEqual([['a', 0, 1], ['b', 0, 1], ['c', 0, 1]])
  })

  it('two identical slots → cols 2, col 0 and col 1', () => {
    expect(place([
      id({ id: 'a', start: 600, end: 660 }),
      id({ id: 'b', start: 600, end: 660 }),
    ])).toEqual([['a', 0, 2], ['b', 1, 2]])
  })

  it('a partial chain a–b–c → c reuses a\'s column, the cluster is 2 wide; a later lone item is 1 wide', () => {
    expect(place([
      id({ id: 'c', start: 660, end: 720 }),
      id({ id: 'a', start: 600, end: 660 }),
      id({ id: 'd', start: 780, end: 840 }),
      id({ id: 'b', start: 630, end: 690 }),
    ])).toEqual([['c', 0, 2], ['a', 0, 2], ['d', 0, 1], ['b', 1, 2]])
  })

  it('three in one slot → cols 3, cols 0, 1, 2, result in input order', () => {
    expect(place([
      id({ id: 'x', start: 600, end: 690 }),
      id({ id: 'y', start: 600, end: 630 }),
      id({ id: 'z', start: 615, end: 645 }),
    ])).toEqual([['x', 1, 3], ['y', 0, 3], ['z', 2, 3]])
  })

  it('empty → empty', () => {
    expect(packOverlapping([], (i: PackSpan) => i)).toEqual([])
  })
})
