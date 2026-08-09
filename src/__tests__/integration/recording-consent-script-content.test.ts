/**
 * recording.consentScript content pin (packet 2026-08-09 PR 9b blind-round
 * §17). D2 folds photo consent into the recording-consent line, so the
 * SPOKEN script staff read to customers must actually mention photos — this
 * is legal-consent wording (RecordingConsentDialog), not decorative copy,
 * and must not silently revert to the audio-only script under a future edit.
 */
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

describe('recording.consentScript mentions photos (D2 legal-consent wording)', () => {
  it('ja.json consentScript contains 写真', () => {
    expect(ja.recording.consentScript).toContain('写真')
  })

  it('en.json consentScript contains "photo"', () => {
    expect(en.recording.consentScript.toLowerCase()).toContain('photo')
  })
})
