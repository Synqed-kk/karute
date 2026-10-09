// Stand-in for useGlobalRecorder: ?rec=recording. No clock control: the
// elapsed timer ticks, which moves no geometry (tabular-nums, fixed column).
const q = new URLSearchParams(location.search)
const startedAt = q.get('rec') === 'recording' ? Date.now() - 754_000 : null
export function useGlobalRecorder() {
  return { state: q.get('rec') ?? 'idle', startedAt, stopRecording: () => {}, target: null }
}
