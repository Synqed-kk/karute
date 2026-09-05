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
  useGlobalRecorder: () => ({ state: recorderState.current }),
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
  // jsdom implements neither play() nor pause() on HTMLMediaElement.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: jest.fn(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false })
      return Promise.resolve()
    }),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: jest.fn(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true })
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
    expect(screen.getByText('処理中')).toBeTruthy()
    expect(screen.getByText('自動で文字起こし中')).toBeTruthy()
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
  })

  it('COMPLETED with no transcript: player only — no body, and no dead chevron', () => {
    card({ transcript: null })
    expect(playButton()).toBeTruthy()
    expect(screen.queryByText('処理中')).toBeNull()
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

  it('the speed chip cycles 1 → 1.5 → 2 → 3 → 1 and sets playbackRate', () => {
    card()
    const chip = screen.getByRole('button', { name: '再生速度' })
    expect(chip.textContent).toBe('1倍')
    for (const expected of ['1.5倍', '2倍', '3倍', '1倍']) {
      fireEvent.click(chip)
      expect(chip.textContent).toBe(expected)
    }
    expect(audioEl().playbackRate).toBe(1)
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

  it('the scrub seeks the real audio, under its OWN label (not the card title)', () => {
    const { container } = card()
    const range = screen.getByLabelText('再生位置') as HTMLInputElement
    expect(range).toBe(container.querySelector('input[type="range"]'))
    expect(range.getAttribute('aria-label')).not.toBe('録音 ・ 文字起こし')
    expect(range.max).toBe('742')
    fireEvent.change(range, { target: { value: '300' } })
    expect(audioEl().currentTime).toBe(300)
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

// ⚖ 9/3: 「あなたとオーナーだけ」-class sentences were rejected — 気持ち悪い.
// The card states WHAT it is, never WHO may hear it, and Karute has no
// download anywhere. The two transient lines the player can show are about the
// current attempt, so they are excluded here by construction (they only appear
// after an action); the pre-existing `restricted` notice is today's unchanged
// text and is likewise not one of these states.
describe('the absence laws', () => {
  const FORBIDDEN = ['聞け', '聴け', '再生でき', '閲覧でき', 'ダウンロード']
  it.each([
    ['player + transcript', {}],
    ['processing', { transcript: null, recording: { ...REC, status: 'PROCESSING' } }],
    ['completed, no transcript', { transcript: null }],
    ['no audio at all', { recording: null }],
  ])('%s says nothing about who may hear it, and offers no download', (_name, props) => {
    const { container } = card(props as Parameters<typeof card>[0])
    for (const word of FORBIDDEN) expect(container.textContent).not.toContain(word)
    expect(container.querySelector('a[download]')).toBeNull()
  })

  it('every visible string resolves from the ja catalog — no key echoes', () => {
    const { container } = card()
    expect(container.textContent).not.toMatch(/karuteDetail\./)
  })
})
