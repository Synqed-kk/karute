/**
 * i18n key parity: messages/en.json and messages/ja.json must expose the
 * exact same set of (dot-flattened) keys. A key present in one locale but not
 * the other means a missing translation that next-intl will render as the raw
 * key path at runtime. Guards the PR #78 / #94 i18n additions against drift.
 */
import en from '../../../messages/en.json'
import ja from '../../../messages/ja.json'

type Json = { [k: string]: unknown }

function flattenKeys(obj: Json, prefix = ''): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Json, key))
    } else {
      keys.push(key)
    }
  }
  return keys
}

describe('i18n key parity (en ⇄ ja)', () => {
  const enKeys = new Set(flattenKeys(en as Json))
  const jaKeys = new Set(flattenKeys(ja as Json))

  it('has the same number of keys in both locales', () => {
    expect(jaKeys.size).toBe(enKeys.size)
  })

  it('has no keys present in en but missing from ja', () => {
    const missingInJa = [...enKeys].filter((k) => !jaKeys.has(k))
    expect(missingInJa).toEqual([])
  })

  it('has no keys present in ja but missing from en', () => {
    const missingInEn = [...jaKeys].filter((k) => !enKeys.has(k))
    expect(missingInEn).toEqual([])
  })
})

// 監査ログ action labels (PR-M1 respell): the viewer resolves a row's label via
// t(`actions.${action}`) inside the settings.auditLog namespace, and next-intl
// treats dots as NESTING — so the emitted action string and the message-file
// key structure must agree, or the row renders its raw action string. The
// delta-verify round caught exactly that for the 7/27 respell.
describe('監査ログ action label paths', () => {
  const enKeys = new Set(flattenKeys(en as Json))
  const jaKeys = new Set(flattenKeys(ja as Json))

  it('the emitted privacy.audit_log.view action resolves in both locales', () => {
    // Must match the literal emitted in src/actions/audit-log.ts.
    expect(enKeys.has('settings.auditLog.actions.privacy.audit_log.view')).toBe(true)
    expect(jaKeys.has('settings.auditLog.actions.privacy.audit_log.view')).toBe(true)
  })

  it('the historical flat spelling keeps its label (old rows still render)', () => {
    expect(enKeys.has('settings.auditLog.actions.privacy.audit_log_view')).toBe(true)
    expect(jaKeys.has('settings.auditLog.actions.privacy.audit_log_view')).toBe(true)
  })
})
