/**
 * @jest-environment jsdom
 *
 * The play button as it RENDERS (build 23 slice ①) — the card's five states and
 * the player's own controls, against the REAL ja catalog so a hardcoded string
 * or a missing key fails here rather than in the field.
 *
 * The rulings this file pins, each one Liam's:
 *   · an OLD record shows no player and says NOTHING about one (F5);
 *   · a PROCESSING record shows the player already — the audio is safe (F6);
 *   · 再生時間 never appears beside a scrub bar that states the same length;
 *   · speeds are 1 → 1.5 → 2 → 3 and they reach the element;
 *   · recording always wins: a play tap mid-recording is refused, and a
 *     recorder that starts pauses the player;
 *   · nothing on the card says who may hear the take, and there is no download.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json') as Record<string, unknown>
  return {
    useTranslations:
      (ns: string) =>
      (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        // A key that does not resolve must FAIL, never echo — an echo would let
        // a missing ja string pass every assertion below.
        if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
        return cur.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? ''))
      },
  }
})

const mintPlaybackUrl = jest.fn(async () => ({
  url: 'https://proj/read/take.mp4?token=t',
  expiresAt: '2026-09-06T00:00:00.000Z',
  durationSeconds: 742,
}) as { url: string; expiresAt: string; durationSeconds: number | null } | { error: string })
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({ mintPlaybackUrl }),
}))

const recorderState = { current: 'idle' as 'idle' | 'recording' | 'paused' | 'recorded' }
jest.mock('@/hooks/use-global-recorder', () => ({
  // The hook is the RENDER snapshot; recorderIsLive is the LIVE read the guard
  // uses immediately before play(). Both come from this one module, so a test
  // that moves `recorderState.current` mid-flight moves both — which is what
  // the race case below needs.
  useGlobalRecorder: () => ({ state: recorderState.current }),
  recorderIsLive: () =>
    recorderState.current === 'recording' || recorderState.current === 'paused',
}))

import { RecordingTranscriptCard } from '@/components/karute/redesign/detail/RecordingTranscriptCard'

const REC = { audioPresent: true, durationSeconds: 742, status: 'COMPLETED' }
const card = (props: Partial<Parameters<typeof RecordingTranscriptCard>[0]> = {}) =>
  render(
    <RecordingTranscriptCard
      karuteId="kar-1"
      transcript="肩こりの話をしました"
      consentOnFile
      recording={REC}
      {...props}
    />,
  )

/** The play control, found by its ja aria-label — never by a test id, so a
 *  hardcoded English label would fail here. */
const playButton = () => screen.getByRole('button', { name: '再生' })
const audioEl = () => document.querySelector('audio') as HTMLAudioElement

beforeEach(() => {
  jest.clearAllMocks()
  recorderState.current = 'idle'
  mintPlaybackUrl.mockResolvedValue({
    url: 'https://proj/read/take.mp4?token=t',
    expiresAt: '2026-09-06T00:00:00.000Z',
    durationSeconds: 742,
  })
  // jsdom implements neither play() nor pause() on HTMLMediaElement. The stubs
  // DISPATCH the real events as well as flipping `paused`, because since F6 the
  // element is the source of truth for the button's label — a stub that moved
  // `paused` silently would let a component that never listens still pass.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: jest.fn(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false })
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    }),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: jest.fn(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true })
      this.dispatchEvent(new Event('pause'))
    }),
  })
})

describe('the card’s states', () => {
  // F5 — the whole point of the ruling: an old record must look EXACTLY as it
  // did before the player existed. No control, and no sentence about one.
  it('an OLD record (no recording) renders today’s card and says nothing about audio', () => {
    const { container } = card({ recording: null })
    expect(screen.getByText('録音 ・ 文字起こし')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '再生' })).toBeNull()
    expect(container.querySelector('audio')).toBeNull()
    expect(container.querySelector('input[type="range"]')).toBeNull()
    expect(container.textContent).not.toContain('録音中は再生できません')
  })

  it('an absent `recording` prop behaves exactly like null (rollback compat)', () => {
    const { container } = card({ recording: undefined })
    expect(container.querySelector('audio')).toBeNull()
  })

  it('no transcript AND no audio renders nothing at all', () => {
    const { container } = card({ transcript: null, recording: null })
    expect(container.firstChild).toBeNull()
  })

  it('audio + transcript: the player sits above the words, and the words still open', () => {
    const { container } = card()
    expect(playButton()).toBeTruthy()
    expect(container.querySelector('input[type="range"]')).toBeTruthy()
    expect(screen.getByText('肩こりの話をしました')).toBeTruthy()
  })

  // F6: the audio is already safe, so the player is there before the words are.
  it('PROCESSING: player + 処理中 chip + the hint, open by default', () => {
    card({ transcript: null, recording: { ...REC, status: 'PROCESSING' } })
    expect(playButton()).toBeTruthy()
    expect(screen.getByText('文字起こし中')).toBeTruthy()
    expect(screen.getByText('完了までしばらくお待ちください')).toBeTruthy()
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
  })

  it('COMPLETED with no transcript: player only — no body, and no dead chevron', () => {
    card({ transcript: null })
    expect(playButton()).toBeTruthy()
    expect(screen.queryByText('文字起こし中')).toBeNull()
    expect(screen.queryByRole('button', { expanded: false })).toBeNull()
    expect(screen.queryByRole('button', { expanded: true })).toBeNull()
  })

  it('restricted: the locked notice, and NO player', () => {
    const { container } = card({ restricted: true })
    expect(screen.getByText(/録音を担当したスタッフ/)).toBeTruthy()
    expect(container.querySelector('audio')).toBeNull()
  })

  // mock D-6: two different lengths for one recording was the bug.
  it('再生時間 is dropped when a player states the total, and kept when there is none', () => {
    const withPlayer = card({ durationLabel: '12:22' })
    expect(withPlayer.container.textContent).not.toContain('再生時間')
    withPlayer.unmount()
    const noPlayer = card({ durationLabel: '12:22', recording: null })
    expect(noPlayer.container.textContent).toContain('再生時間 12:22')
  })
})

describe('the controls', () => {
  it('the FIRST tap mints exactly once and sets the element’s src', async () => {
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    expect(mintPlaybackUrl).toHaveBeenCalledTimes(1)
    expect(mintPlaybackUrl).toHaveBeenCalledWith('kar-1')
    expect(audioEl().src).toBe('https://proj/read/take.mp4?token=t')
    // Mounting alone must never mint — that would be a row per view.
    expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy()
  })

  it('a second tap pauses without minting again', async () => {
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '一時停止' }))
    })
    expect(mintPlaybackUrl).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '再生' })).toBeTruthy()
  })

  // ⚠ L2 F3 — the old pin ended on 1×, which is jsdom's DEFAULT, so both
  // playbackRate assignments could be deleted with the suite green. Every step
  // is asserted on the ELEMENT now.
  it('the speed chip cycles 1 → 1.5 → 2 → 3 → 1 and every step reaches the element', () => {
    card()
    const chip = screen.getByRole('button', { name: '再生速度' })
    expect(chip.textContent).toBe('標準')
    for (const [label, rate] of [['1.5倍', 1.5], ['2倍', 2], ['3倍', 3], ['標準', 1]] as const) {
      fireEvent.click(chip)
      expect(audioEl().playbackRate).toBe(rate)
      expect(chip.textContent).toBe(label)
    }
  })

  // ⚠ L2 R2 — the THIRD playbackRate write, the one that matters on a real
  // engine and that jsdom cannot see on its own. The HTML media load algorithm
  // resets `playbackRate` to `defaultPlaybackRate` when a new resource loads, so
  // `start()`'s assignment is what keeps a 2× choice made BEFORE the first tap.
  // jsdom does not implement that reset, so the browser's behaviour is stubbed
  // onto the `src` setter here — without it, deleting that line is invisible.
  it('a speed chosen BEFORE the first play survives the element loading its source', async () => {
    card()
    const audio = audioEl()
    let stored = ''
    Object.defineProperty(audio, 'src', {
      configurable: true,
      get: () => stored,
      set: (v: string) => {
        stored = v
        // What a real browser does on a new resource: back to the default.
        audio.playbackRate = audio.defaultPlaybackRate
      },
    })
    const chip = screen.getByRole('button', { name: '再生速度' })
    fireEvent.click(chip)
    fireEvent.click(chip)
    expect(chip.textContent).toBe('2倍')
    await act(async () => {
      fireEvent.click(playButton())
    })
    expect(audio.playbackRate).toBe(2)
  })

  // ⚠ L4-3 (F7). WebKit may clamp above ~2×. The chip must state what the
  // engine is RUNNING, not what we asked for.
  it('a clamping engine makes the chip state the EFFECTIVE rate', () => {
    card()
    const audio = audioEl()
    let rate = 1
    Object.defineProperty(audio, 'playbackRate', {
      configurable: true,
      get: () => rate,
      set: (v: number) => void (rate = Math.min(v, 2)), // an engine capped at 2×
    })
    const chip = screen.getByRole('button', { name: '再生速度' })
    fireEvent.click(chip) // ask 1.5 → honoured
    expect(chip.textContent).toBe('1.5倍')
    fireEvent.click(chip) // ask 2 → honoured
    expect(chip.textContent).toBe('2倍')
    fireEvent.click(chip) // ask 3 → clamped to 2
    expect(chip.textContent).toBe('2倍')
  })

  // ⚠ L1 MEDIUM-2 (F10). A job-owned row can carry a null duration, and with
  // preload="none" nothing loads until the first play — the slot used to state
  // 0:00 for a take that is certainly not zero seconds long.
  it('an unknown total reads –:–– and the scrub stays disabled until metadata lands', () => {
    card({ recording: { ...REC, durationSeconds: null } })
    expect(screen.getByText('–:––')).toBeTruthy()
    expect(screen.getByLabelText('再生位置')).toBeDisabled()
  })

  it('±15 clamps to [0, duration]', () => {
    card()
    const audio = audioEl()
    fireEvent.click(screen.getByRole('button', { name: '15秒戻る' }))
    expect(audio.currentTime).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '15秒進む' }))
    expect(audio.currentTime).toBe(15)
    audio.currentTime = 740
    fireEvent.click(screen.getByRole('button', { name: '15秒進む' }))
    expect(audio.currentTime).toBe(742)
  })

  it('the scrub carries its OWN label, not the card title', () => {
    const { container } = card()
    const range = screen.getByLabelText('再生位置') as HTMLInputElement
    expect(range).toBe(container.querySelector('input[type="range"]'))
    expect(range.getAttribute('aria-label')).not.toBe('録音 ・ 文字起こし')
    expect(range.max).toBe('742')
  })

  // ⚠ L4-6 (F9). Against a signed remote url every write to currentTime is a
  // seek, and every seek is a byte-range request — a drag that wrote per pixel
  // was a stutter, not a scrub.
  it('dragging through five values seeks the element ONCE, on release', () => {
    card()
    const range = screen.getByLabelText('再生位置') as HTMLInputElement
    const seeks: number[] = []
    Object.defineProperty(audioEl(), 'currentTime', {
      configurable: true,
      get: () => seeks[seeks.length - 1] ?? 0,
      set: (v: number) => void seeks.push(v),
    })
    for (const v of ['100', '150', '200', '250', '300']) {
      fireEvent.change(range, { target: { value: v } })
    }
    expect(seeks).toEqual([])
    fireEvent.pointerUp(range)
    expect(seeks).toEqual([300])
  })

  // ⚠ THE DEFECT F9 INTRODUCED (fix round 3 — found independently by the
  // construction and phone lenses). A PLAYING element fires `timeupdate` ~4×/s,
  // and each tick used to overwrite the drag: the thumb was yanked back to the
  // playhead mid-drag, and because the finger stops moving before it lifts, the
  // release commonly seeked to the PLAYHEAD and threw the scrub away silently.
  // This is the ordinary gesture on this card — listening to a 90-minute take
  // and dragging to a point of interest.
  it('a scrub WHILE PLAYING survives timeupdate and lands where the finger left it', async () => {
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    const range = screen.getByLabelText('再生位置') as HTMLInputElement
    const audio = audioEl()
    fireEvent.change(range, { target: { value: '400' } })
    expect(range.value).toBe('400')
    audio.currentTime = 12
    await act(async () => {
      fireEvent.timeUpdate(audio)
    })
    expect(range.value).toBe('400')
    fireEvent.pointerUp(range)
    expect(audio.currentTime).toBe(400)
  })

  it('the playhead gets the thumb back once the finger lifts', async () => {
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    const range = screen.getByLabelText('再生位置') as HTMLInputElement
    const audio = audioEl()
    fireEvent.change(range, { target: { value: '400' } })
    fireEvent.pointerUp(range)
    // The drag is over — a tick may move the display again.
    audio.currentTime = 405
    await act(async () => {
      fireEvent.timeUpdate(audio)
    })
    expect(range.value).toBe('405')
  })

  // L4 NEW-3: iOS fires pointerup AND touchend for ONE finger lift.
  it('one release is ONE seek, even when iOS sends pointerUp and touchEnd', () => {
    card()
    const range = screen.getByLabelText('再生位置') as HTMLInputElement
    const seeks: number[] = []
    Object.defineProperty(audioEl(), 'currentTime', {
      configurable: true,
      get: () => seeks[seeks.length - 1] ?? 0,
      set: (v: number) => void seeks.push(v),
    })
    fireEvent.change(range, { target: { value: '250' } })
    fireEvent.pointerUp(range)
    fireEvent.touchEnd(range)
    expect(seeks).toEqual([250])
  })

  // L4 NEW-2: the 44 px band must not swallow the page's vertical scroll.
  it('the scrub leaves vertical panning to the page', () => {
    card()
    expect(screen.getByLabelText('再生位置').className).toContain('touch-pan-y')
  })

  it('a keyboard user’s seek commits on key up', () => {
    card()
    const range = screen.getByLabelText('再生位置') as HTMLInputElement
    fireEvent.change(range, { target: { value: '120' } })
    fireEvent.keyUp(range, { key: 'ArrowRight' })
    expect(audioEl().currentTime).toBe(120)
  })

  // ⚠ L4-2 (F4). Karute web in mobile Safari: whether WebKit forwards the user
  // gesture across a microtask is version-dependent, so the cached-url path
  // must not await anything before play().
  it('with a url in hand the SECOND tap calls play() synchronously, inside the gesture', async () => {
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '一時停止' }))
    })
    ;(HTMLMediaElement.prototype.play as jest.Mock).mockClear()
    // NO await, NO act flush — if anything yields before play(), this is 0.
    fireEvent.click(screen.getByRole('button', { name: '再生' }))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })

  // ⚠ L1 MEDIUM-1 (F5). Two taps inside one round trip used to mint twice —
  // two signed urls and two `recording.play` rows for ONE listen.
  it('two rapid taps mint ONCE — the second joins the promise in flight', async () => {
    let release: (v: { url: string; expiresAt: string; durationSeconds: number | null }) => void = () => {}
    mintPlaybackUrl.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    card()
    const btn = playButton()
    // BOTH taps inside ONE act, i.e. before React re-renders — so `disabled`
    // has not applied yet and the second tap really does reach the handler.
    // Without the in-flight promise ref this mints twice: two signed urls and
    // two `recording.play` rows for one listen.
    await act(async () => {
      fireEvent.click(btn)
      fireEvent.click(btn)
    })
    await act(async () => {
      release({ url: 'https://proj/read/take.mp4?token=t', expiresAt: 'x', durationSeconds: 742 })
    })
    expect(mintPlaybackUrl).toHaveBeenCalledTimes(1)
  })

  // The other half of F5: once React HAS re-rendered, the button is disabled,
  // so an impatient third tap cannot reach the handler at all.
  it('the play button is disabled while a mint is in flight', async () => {
    mintPlaybackUrl.mockReturnValue(new Promise(() => {}))
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    expect(playButton()).toBeDisabled()
  })

  // ⚠ L4-5 (F6). On a phone the system pauses media constantly — a call, the
  // lock screen, another app taking the audio session. The button used to keep
  // reading 一時停止 while nothing played, and the first tap only re-paused it.
  it('an OUTSIDE pause flips the button back to 再生 without a tap', async () => {
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    expect(screen.getByRole('button', { name: '一時停止' })).toBeTruthy()
    await act(async () => {
      Object.defineProperty(audioEl(), 'paused', { configurable: true, value: true })
      fireEvent.pause(audioEl())
    })
    expect(screen.getByRole('button', { name: '再生' })).toBeTruthy()
  })

  it('a mint refusal shows one line and leaves the button on 再生', async () => {
    mintPlaybackUrl.mockResolvedValue({ error: 'forbidden' })
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    expect(screen.getByText('再生できませんでした')).toBeTruthy()
    expect(screen.getByRole('button', { name: '再生' })).toBeTruthy()
  })
})

// D-6. There is one microphone on this device and the session in progress owns
// it; nothing here may reach the mic path.
describe('recording always wins', () => {
  it('a play tap while the recorder is live is REFUSED, and never mints', async () => {
    recorderState.current = 'recording'
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    expect(mintPlaybackUrl).not.toHaveBeenCalled()
    expect(screen.getByText('録音中は再生できません')).toBeTruthy()
  })

  it('a PAUSED recorder still refuses — the session is not over', async () => {
    recorderState.current = 'paused'
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    expect(mintPlaybackUrl).not.toHaveBeenCalled()
  })

  // ⚠ L4-1, REPRODUCED THEN CLOSED (F3). The old code read the recorder ONCE at
  // the top of the handler and never again after the mint's await, and the
  // pause-on-record effect was a no-op because the element was not playing yet.
  // Net effect: tap 再生, start a recording while the url is minting, and the
  // previous session's audio played into the live microphone.
  it('a recorder that starts DURING the mint is seen — the take never plays over a live mic', async () => {
    let release: (v: { url: string; expiresAt: string; durationSeconds: number | null }) => void = () => {}
    mintPlaybackUrl.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    card()
    fireEvent.click(playButton())
    // …the recording starts while the url is still in flight.
    recorderState.current = 'recording'
    await act(async () => {
      release({ url: 'https://proj/read/take.mp4?token=t', expiresAt: 'x', durationSeconds: 742 })
    })
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(screen.getByText('録音中は再生できません')).toBeTruthy()
  })

  // The re-mint path had no recorder check at all — the same window, wider.
  it('the re-mint after a media error also refuses while the recorder is live', async () => {
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    ;(HTMLMediaElement.prototype.play as jest.Mock).mockClear()
    recorderState.current = 'recording'
    await act(async () => {
      fireEvent.error(audioEl())
    })
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })

  it('a recorder that STARTS pauses the player', async () => {
    const { rerender } = card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    expect(audioEl().paused).toBe(false)
    recorderState.current = 'recording'
    await act(async () => {
      rerender(
        <RecordingTranscriptCard
          karuteId="kar-1"
          transcript="肩こりの話をしました"
          consentOnFile
          recording={REC}
        />,
      )
    })
    expect(audioEl().paused).toBe(true)
    expect(screen.getByRole('button', { name: '再生' })).toBeTruthy()
  })
})

// ⚠ L2 F4/F5 — three deliberate behaviours and the clock had NO test at all:
// the whole <audio onError> block could be deleted with the suite green, the
// NotAllowedError branch (one of the two doors) was unproven, and the h:mm:ss
// branch — the only reason clock() has a branch — had no case.
describe('the branches nobody would exercise by hand', () => {
  // D-3: one re-mint on a media error, resuming where the ear was. It fires
  // after an hour-long listen, so nothing but a test will ever reach it.
  it('a media error re-mints ONCE and resumes at the same position', async () => {
    card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    const audio = audioEl()
    audio.currentTime = 321
    fireEvent.timeUpdate(audio)
    await act(async () => {
      fireEvent.error(audio)
    })
    expect(mintPlaybackUrl).toHaveBeenCalledTimes(2)
    expect(audio.currentTime).toBe(321)

    // …and only ONCE. A second error says so instead of looping.
    await act(async () => {
      fireEvent.error(audio)
    })
    expect(mintPlaybackUrl).toHaveBeenCalledTimes(2)
    expect(screen.getByText('再生できませんでした')).toBeTruthy()
  })

  // D-11, the Karute-web-in-mobile-Safari door: play() rejects when the gesture
  // was lost. The button must stay honest and say nothing — the staffer's own
  // next tap is the recovery.
  it('a rejected play() leaves the button on 再生 with no notice', async () => {
    ;(HTMLMediaElement.prototype.play as jest.Mock).mockImplementationOnce(function (
      this: HTMLMediaElement,
    ) {
      return Promise.reject(new DOMException('NotAllowedError'))
    })
    const { container } = card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    expect(screen.getByRole('button', { name: '再生' })).toBeTruthy()
    expect(container.textContent).not.toContain('再生できませんでした')
  })

  it('unmount pauses and releases the element', async () => {
    const view = card()
    await act(async () => {
      fireEvent.click(playButton())
    })
    const audio = audioEl()
    ;(HTMLMediaElement.prototype.pause as jest.Mock).mockClear()
    view.unmount()
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(audio.getAttribute('src')).toBeNull()
  })

  it.each([
    [0, '0:00'],
    [7, '0:07'],
    [62, '1:02'],
    [742, '12:22'],
    [3599, '59:59'],
    // The whole reason clock() has a branch — past the hour it grows a field
    // AND zero-pads the minutes, so 1:02:03 is not 1:2:03.
    [3723, '1:02:03'],
    [7325, '2:02:05'],
  ])('clock(%i) renders %s as the total', (seconds, label) => {
    card({ recording: { ...REC, durationSeconds: seconds } })
    // 0 is the unknown case — it says so rather than claiming a zero-length take.
    expect(screen.getByText(seconds === 0 ? '–:––' : label)).toBeTruthy()
  })
})

// ⚖ 9/3: 「あなたとオーナーだけ」-class sentences were rejected — 気持ち悪い.
// The card states WHAT it is, never WHO may hear it, and Karute has no
// download anywhere.
//
// ⚠ THE OLD SUBSTRING LIST WAS VACUOUS (blind round 1, L2 F2). A hardcoded
// 「この録音はあなたとオーナーのみ視聴できます。」 dropped onto the player row
// passed every assertion in this file, passed lint and passed all 9,706 tests:
// 視聴でき was not on the list, and it is not a key echo either. So the law is
// now enforced POSITIVELY — every visible text node must come from the
// catalog — which fails for a hardcoded sentence of ANY wording. The
// who-can-hear substring check stays as a second belt, widened.
describe('the absence laws', () => {
  /** Every string value the ja catalog holds, anywhere in it. A rendered text
   *  node must be one of these (or a clock/number token) — that is the whole
   *  law: ⚖ ALL LANGUAGES means nothing visible is written in the component. */
  const catalogValues = (() => {
    const ja = jest.requireActual('../../../messages/ja.json') as Record<string, unknown>
    const out = new Set<string>()
    const walk = (node: unknown): void => {
      if (typeof node === 'string') return void out.add(node)
      if (node && typeof node === 'object') Object.values(node).forEach(walk)
    }
    walk(ja)
    return out
  })()

  /** Catalog strings carry {placeholders}; a rendered node has them filled in.
   *  A node matches a template when the template's literal segments appear in
   *  order — enough to accept 「再生時間 12:22」 while still rejecting a
   *  sentence that is in no template at all.
   *
   *  ⚠ SHORT TEMPLATES ARE FENCED (fix round 4, L2 R1). 93 of the 354 templates
   *  in ja.json have ≤3 literal characters and several have exactly one —
   *  `{n}分` `{n}件` `{rate}倍` `{n}回` `{n}枚` `{age}歳` `{name}担当`. Matching
   *  "the literals appear in order" let ANY sentence containing one of those
   *  fragments through: 「この録音は担当者と店長だけが確認できます。」 escaped on
   *  the single literal 担当 from `{name}担当`. So a short template only counts
   *  when what surrounds it IS the value it templates — a number/rate token —
   *  and never when it is prose. */
  const SHORT_TEMPLATE_LITERALS = 3
  const fromTemplate = (text: string) => {
    for (const v of catalogValues) {
      if (!v.includes('{')) continue
      const parts = v.split(/\{\w+\}/).filter(Boolean)
      let at = 0
      const inOrder = parts.every(
        (part) => (at = text.indexOf(part, at)) !== -1 && (at += part.length) >= 0,
      )
      if (!inOrder) continue
      // Everything the template did NOT contribute must be the filled-in value.
      const literals = parts.join('')
      if (literals.length > SHORT_TEMPLATE_LITERALS) return true
      let rest = text
      for (const part of parts) rest = rest.replace(part, '')
      if (/^[\d.:×倍–\s]*$/.test(rest)) return true
    }
    return false
  }

  /** Clocks, counts and the unknown-total dash pair: 0:00, 15, 1:02:03, –:–– */
  const NUMERIC = /^[\d:–]+$/

  const textNodes = (root: HTMLElement) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const out: string[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim()
      if (text) out.push(text)
    }
    return out
  }

  const STATES = [
    ['player + transcript', {}],
    ['processing', { transcript: null, recording: { ...REC, status: 'PROCESSING' } }],
    ['completed, no transcript', { transcript: null }],
    ['no audio at all', { recording: null }],
  ] as const

  it.each(STATES)('%s renders ONLY catalog strings and number tokens', (_name, props) => {
    const { container } = card(props as Parameters<typeof card>[0])
    // The transcript body is the customer's own words, not a UI string.
    const body = container.querySelector('[data-transcript-body]')
    body?.remove()
    const strays = textNodes(container).filter(
      (text) => !catalogValues.has(text) && !NUMERIC.test(text) && !fromTemplate(text),
    )
    expect(strays).toEqual([])
  })

  // Second belt, widened past the wording the repro used.
  const FORBIDDEN = [
    '聞け', '聴け', '再生でき', '閲覧でき', 'ダウンロード',
    '視聴', '聞くこと', '聴くこと', 'オーナー',
  ]
  it.each(STATES)('%s says nothing about who may hear it, and offers no download', (_name, props) => {
    const { container } = card(props as Parameters<typeof card>[0])
    for (const word of FORBIDDEN) expect(container.textContent).not.toContain(word)
    expect(container.querySelector('a[download]')).toBeNull()
  })

  it('every visible string resolves from the ja catalog — no key echoes', () => {
    const { container } = card()
    expect(container.textContent).not.toMatch(/karuteDetail\./)
  })
})
