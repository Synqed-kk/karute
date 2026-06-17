// Microphone constraints for session + quick recordings. Until now the
// recorders opened the mic with a bare `{ audio: true }`, so the 録音設定
// noise-suppression toggle was saved but never applied — a dead setting.
//
// noiseSuppression honours that toggle (org default = on). It's the browser's
// NON-voice suppression (fans, BGM, dryers); it never cancels a person — unlike
// Krisp-class background-voice removal — so the customer stays in the recording
// for speaker separation. Staff can turn it off when they'd rather keep raw
// audio for diarization quality.
//
// echoCancellation + autoGainControl stay on: they remove room feedback and
// lift a quiet customer's voice toward the staff's level — both help
// transcription AND speaker-id. All three are best-effort MediaTrackConstraints:
// a browser that doesn't support one simply ignores it (no breakage).
export function recordingAudioConstraints(
  noiseSuppression: boolean,
): MediaTrackConstraints {
  return {
    noiseSuppression,
    echoCancellation: true,
    autoGainControl: true,
  }
}
