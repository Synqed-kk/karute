/**
 * settings.autostartDescription content pin (recording-integrity PR A4, fix
 * round F-D). The original string — 「この店舗では…」 / "At this store…" — is
 * singular copy standing above a MULTI-store switch list (stale §8.8 wording
 * that predates the §8.1 ⚠ 8/17 correction block, which moved the feature
 * from one-toggle-for-this-store to one-switch-per-store). Byte-exact pin so
 * a future edit can't silently revert to the ambiguous singular phrasing.
 */
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

describe('settings.autostartDescription is scoped to the switches, not to "this store" (fix round F-D)', () => {
  it('ja.json matches the adjudicated string exactly', () => {
    expect(ja.settings.autostartDescription).toBe(
      'オンにした店舗では、予約の{serviceNoun}の際に自動的に録音を開始します。初期設定はオフです。',
    )
  })

  it('en.json matches the adjudicated string exactly', () => {
    expect(en.settings.autostartDescription).toBe(
      'Recording starts automatically for booked appointments at the stores you switch on. Off by default.',
    )
  })

  it('neither locale uses the stale singular-store phrasing', () => {
    expect(ja.settings.autostartDescription).not.toContain('この店舗では')
    expect(en.settings.autostartDescription.toLowerCase()).not.toContain('at this store')
  })
})
