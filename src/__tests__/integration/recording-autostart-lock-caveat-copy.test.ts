/**
 * settings.autostartLockCaveat content pin (recording-integrity PR A4, spec
 * §8.5, ⚠ 8/17 Liam field correction). The original caveat — 「画面ロック中は
 * 録音が止まります…」 / "Recording stops while the screen is locked…" — was
 * FACTUALLY FALSE: ios/App/App/Info.plist declares `UIBackgroundModes:
 * [audio]`, so a locked phone does NOT suspend capture. Byte-exact pin so a
 * future edit can't silently revert to the disproven claim.
 */
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

describe('settings.autostartLockCaveat states the corrected truth — locking does not stop capture (8/17 field correction)', () => {
  it('ja.json matches the adjudicated string exactly', () => {
    expect(ja.settings.autostartLockCaveat).toBe('画面をロックしても録音は継続します。')
  })

  it('en.json matches the adjudicated string exactly', () => {
    expect(en.settings.autostartLockCaveat).toBe(
      'Recording continues even when the screen is locked.',
    )
  })

  it('neither locale ships the disproven "locking stops recording" claim', () => {
    expect(ja.settings.autostartLockCaveat).not.toContain('止まります')
    expect(en.settings.autostartLockCaveat.toLowerCase()).not.toContain('stops')
  })
})
