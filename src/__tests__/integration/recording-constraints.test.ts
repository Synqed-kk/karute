// Locks the mic-constraints contract: noiseSuppression follows the org toggle;
// echoCancellation + autoGainControl are always on. (The toggle was a dead
// setting until the recorders started applying this.)
import { recordingAudioConstraints } from '@/lib/recording-constraints'

describe('recordingAudioConstraints', () => {
  it('applies noise suppression when the org toggle is on', () => {
    expect(recordingAudioConstraints(true)).toEqual({
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
    })
  })
  it('respects the toggle OFF (raw audio for diarization) — echo/AGC stay on', () => {
    expect(recordingAudioConstraints(false)).toEqual({
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
    })
  })
})
