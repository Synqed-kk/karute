/** @jest-environment jsdom */
/**
 * The shared horizontal-slide gesture (S1), driven on its own.
 *
 * The 日付ジャンプ panel's 64-case suite is the PIN that its behaviour did not
 * change when these lines moved out of it. This suite is the other half: the
 * rules stated once, against the hook itself, so the 予約 page's own swipe is
 * covered by the same assertions rather than by a second set that could drift.
 *
 * jsdom ships no PointerEvent and no pointer capture, so the events are built
 * by hand (the panel suite's own `pointer` helper, same reasons in full there):
 * `timeStamp` is a readonly accessor seeded from the REAL clock that fake
 * timers do not fake, so any test about VELOCITY has to state its own stamps or
 * it is measuring how busy the machine was between two synchronous lines.
 */
/* eslint-disable react-hooks/refs -- the harness hands the hook's own handlers
 * and its own track element to the elements they belong to, which is the whole
 * point of the hook returning them; the compiler rule cannot tell that apart
 * from a component reading a ref to decide what to render. */
import { useLayoutEffect, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  AXIS_LOCK_PX,
  COMMIT_FRACTION,
  COMMIT_VELOCITY,
  SWIPE_UP_PX,
  useHorizontalSlide,
} from '@/lib/motion/use-horizontal-slide'

const WIDTH = 400

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  el: Element,
  init: { pointerId: number; clientX: number; clientY: number; timeStamp?: number },
) {
  const { timeStamp, ...props } = init
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, props)
  if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  fireEvent(el, event)
}

let commits: number[] = []
let arms: number[] = []
let swipeUps = 0
let starts = 0

function Harness({ reduced = false }: { reduced?: boolean }) {
  // The HOST'S HALF of the contract: a commit changes the host's own data, and
  // the layout effect that follows that change is what re-seats the track. The
  // 予約 page keys on `props.selectedDateIso`; the panel keys on its visible
  // month; this keys on a counter, which is the same shape.
  const [landed, setLanded] = useState(0)
  const slide = useHorizontalSlide({
    width: () => WIDTH,
    reduced,
    onCommit: (dir) => {
      commits.push(dir)
      setLanded((n) => n + 1)
    },
    onArm: (k) => arms.push(k),
    onSwipeUp: () => {
      swipeUps += 1
    },
    onGestureStart: () => {
      starts += 1
    },
  })
  // The host's own contract: re-seat AFTER the panes have re-keyed.
  const { reseat } = slide
  useLayoutEffect(() => {
    reseat()
  }, [slide.travel, landed, reseat])
  return (
    <div data-testid="box" {...slide.bind}>
      <div data-testid="track" ref={slide.trackRef} />
      <button type="button" data-testid="next" onClick={() => slide.go(1)}>
        next
      </button>
      <button type="button" data-testid="prev" onClick={() => slide.go(-1)}>
        prev
      </button>
      <span data-testid="dir">{slide.dir}</span>
    </div>
  )
}

const box = () => screen.getByTestId('box')
const track = () => screen.getByTestId('track')
const x = () =>
  Number(/translate3d\((-?[\d.]+)px/.exec(track().style.transform)?.[1] ?? NaN)

const frames = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  commits = []
  arms = []
  swipeUps = 0
  starts = 0
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

describe('the axis lock', () => {
  it(`claims no axis until the finger has travelled ${AXIS_LOCK_PX}px`, () => {
    render(<Harness />)
    pointer('pointerdown', box(), { pointerId: 1, clientX: 200, clientY: 100 })
    expect(starts).toBe(1)
    // Inside the threshold on BOTH axes: nothing is decided, nothing moves.
    pointer('pointermove', box(), { pointerId: 1, clientX: 200 - (AXIS_LOCK_PX - 1), clientY: 100 })
    expect(x()).toBe(0)
    pointer('pointermove', box(), { pointerId: 1, clientX: 200 - (AXIS_LOCK_PX + 2), clientY: 100 })
    expect(x()).toBe(-(AXIS_LOCK_PX + 2))
  })

  it('a VERTICAL intent never moves the track and never commits — the page scrolls', async () => {
    render(<Harness />)
    pointer('pointerdown', box(), { pointerId: 2, clientX: 200, clientY: 300 })
    // Down the page, past the lock: the gesture is the page's, not ours.
    pointer('pointermove', box(), { pointerId: 2, clientX: 202, clientY: 340 })
    // …and a later horizontal drift cannot take it back.
    pointer('pointermove', box(), { pointerId: 2, clientX: 40, clientY: 341 })
    pointer('pointerup', box(), { pointerId: 2, clientX: 40, clientY: 341 })
    await frames(2000)
    // The track is seated at 0 and was never written anywhere else.
    expect(x()).toBe(0)
    expect(commits).toEqual([])
  })

  it(`a fast flick UP past ${SWIPE_UP_PX}px fires onSwipeUp, once`, () => {
    render(<Harness />)
    pointer('pointerdown', box(), { pointerId: 3, clientX: 200, clientY: 300 })
    pointer('pointermove', box(), { pointerId: 3, clientX: 200, clientY: 300 - SWIPE_UP_PX - 5 })
    expect(swipeUps).toBe(1)
    // The gesture is spent — a second move cannot fire it again.
    pointer('pointermove', box(), { pointerId: 3, clientX: 200, clientY: 100 })
    expect(swipeUps).toBe(1)
  })
})

describe('the commit rule — distance OR speed', () => {
  // ⚠ The distances below are LITERAL px, never `WIDTH * COMMIT_FRACTION`: a
  // test that computes its own input from the constant it is testing moves
  // with the constant, and a mutant that widens the threshold passes it. 130px
  // and 60px sit either side of a quarter of the 400px pane, and they stay
  // there whatever the constant says.
  it(`a slow drag past ${COMMIT_FRACTION * 100}% of the width commits (130 of 400px)`, async () => {
    render(<Harness />)
    pointer('pointerdown', box(), { pointerId: 4, clientX: 380, clientY: 100 })
    pointer('pointermove', box(), { pointerId: 4, clientX: 370, clientY: 101 })
    await frames(200) // a pause on the glass: the release reads no speed
    pointer('pointermove', box(), { pointerId: 4, clientX: 250, clientY: 101 })
    await frames(200)
    pointer('pointermove', box(), { pointerId: 4, clientX: 250, clientY: 101 })
    pointer('pointerup', box(), { pointerId: 4, clientX: 250, clientY: 101 })
    await frames(3000)
    expect(commits).toEqual([1])
  })

  it(`a slow drag SHORT of ${COMMIT_FRACTION * 100}% goes back and commits nothing (60 of 400px)`, async () => {
    render(<Harness />)
    pointer('pointerdown', box(), { pointerId: 5, clientX: 380, clientY: 100 })
    pointer('pointermove', box(), { pointerId: 5, clientX: 320, clientY: 101 })
    await frames(200)
    pointer('pointermove', box(), { pointerId: 5, clientX: 320, clientY: 101 })
    pointer('pointerup', box(), { pointerId: 5, clientX: 320, clientY: 101 })
    await frames(3000)
    expect(commits).toEqual([])
    expect(x()).toBe(0)
  })

  it(`a SHORT flick faster than ${COMMIT_VELOCITY}px/s commits anyway`, async () => {
    render(<Harness />)
    // 10px in 1ms = 10,000 px/s — nowhere near a quarter of the pane, far past
    // the speed threshold. Stamped, or this measures the machine's load.
    pointer('pointerdown', box(), { pointerId: 6, clientX: 380, clientY: 100, timeStamp: 1000 })
    pointer('pointermove', box(), { pointerId: 6, clientX: 370, clientY: 101, timeStamp: 1001 })
    pointer('pointerup', box(), { pointerId: 6, clientX: 370, clientY: 101, timeStamp: 1001 })
    await frames(3000)
    expect(commits).toEqual([1])
  })

  it('a flick the OTHER way commits the other direction', async () => {
    render(<Harness />)
    pointer('pointerdown', box(), { pointerId: 7, clientX: 100, clientY: 100, timeStamp: 1000 })
    pointer('pointermove', box(), { pointerId: 7, clientX: 110, clientY: 101, timeStamp: 1001 })
    pointer('pointerup', box(), { pointerId: 7, clientX: 110, clientY: 101, timeStamp: 1001 })
    await frames(3000)
    expect(commits).toEqual([-1])
  })
})

describe('interruption', () => {
  it('a second intention LANDS the travel in flight before it starts its own', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('next'))
    await frames(100) // in flight, nowhere near rest
    expect(commits).toEqual([])

    fireEvent.click(screen.getByTestId('next'))
    // Instantly, on the tap itself: the travel that was moving has LANDED.
    expect(commits).toEqual([1])
    await frames(3000)
    expect(commits).toEqual([1, 1])
  })

  it('a finger landing mid-travel re-seats the track UNDER it, not at 0', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('next'))
    await frames(100)
    const inFlight = x()
    expect(inFlight).toBeLessThan(0)

    pointer('pointerdown', box(), { pointerId: 8, clientX: 200, clientY: 100 })
    // The drag claims the axis: the travel lands, and the finger owns the track
    // 1:1 from where IT started — never a jump back to where the spring was.
    pointer('pointermove', box(), { pointerId: 8, clientX: 180, clientY: 101 })
    expect(commits).toEqual([1])
    expect(x()).toBe(-20)
  })

  it('a SECOND finger cannot hijack a drag that already owns the axis', () => {
    render(<Harness />)
    pointer('pointerdown', box(), { pointerId: 9, clientX: 300, clientY: 100 })
    pointer('pointermove', box(), { pointerId: 9, clientX: 260, clientY: 101 })
    expect(x()).toBe(-40)

    pointer('pointerdown', box(), { pointerId: 10, clientX: 100, clientY: 400 })
    pointer('pointermove', box(), { pointerId: 10, clientX: 380, clientY: 400 })
    pointer('pointerup', box(), { pointerId: 10, clientX: 380, clientY: 400 })
    expect(x()).toBe(-40)

    // …and the first finger still owns it.
    pointer('pointermove', box(), { pointerId: 9, clientX: 270, clientY: 101 })
    expect(x()).toBe(-30)
  })
})

describe('reduced motion', () => {
  it('every travel lands INSTANTLY — the state still changes, it just stops moving', () => {
    render(<Harness reduced />)
    fireEvent.click(screen.getByTestId('next'))
    // No frames advanced at all, and it is already committed.
    expect(commits).toEqual([1])
    expect(x()).toBe(0)
  })
})

describe('arming', () => {
  it('the armed direction is told to the host, and disarmed at the landing', async () => {
    render(<Harness />)
    pointer('pointerdown', box(), { pointerId: 11, clientX: 380, clientY: 100, timeStamp: 1000 })
    pointer('pointermove', box(), { pointerId: 11, clientX: 370, clientY: 101, timeStamp: 1001 })
    expect(arms).toContain(1)
    expect(screen.getByTestId('dir').textContent).toBe('0')
    pointer('pointerup', box(), { pointerId: 11, clientX: 370, clientY: 101, timeStamp: 1001 })
    // The release ARMS the shift as render state too, so the host's JSX knows
    // which pane may take a tap.
    expect(screen.getByTestId('dir').textContent).toBe('1')
    await frames(3000)
    expect(screen.getByTestId('dir').textContent).toBe('0')
    // …and the host's re-seat is what DISARMS: the commit itself never does,
    // because the heights a host interpolates belong to the paint the panes
    // re-key in, not to the frame the spring came to rest in.
    expect(arms[arms.length - 1]).toBe(0)
  })
})
