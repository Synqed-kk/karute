/**
 * @jest-environment jsdom
 */
// ⚖ P2 test 9 — the Business notice for a core read that did not answer: rendered through the segment's error.tsx (the
// page-throw home) and on its own (the layout's home). Plain words + the reference number; no button, no English.
import { cleanup, render } from '@testing-library/react'
import BusinessError from '@/app/[locale]/(business)/error'
import { CoreUnansweredNotice } from '@/app/[locale]/(business)/CoreUnansweredNotice'
import { businessStrings } from '@/business/i18n'

afterEach(cleanup)
const s = businessStrings.coreUnanswered

describe('P2 — the core-unanswered notice', () => {
  it('the strings are the lead-supplied LABEL-FINAL rows, exactly', () => {
    expect(s).toEqual({ unloaded: 'データを読み込めませんでした。', ifReloadFails: '再読み込みしても直らない場合は管理者へ。', reference: 'エラー番号：{ref}' })
  })
  it('error.tsx shows the digest as the reference: the two lines + 「エラー番号：」 and the number; no Latin text apart from the ref; no button; not the message', () => {
    const { container } = render(<BusinessError error={Object.assign(new Error('secret english'), { digest: '0a1b2c3d' })} />)
    const text = container.textContent ?? ''
    expect(text).toBe(s.unloaded + s.ifReloadFails + s.reference.replace('{ref}', '0a1b2c3d'))
    expect(text.replace('0a1b2c3d', '')).not.toMatch(/[A-Za-z0-9]/)
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.querySelector('.font-mono')?.textContent).toBe('0a1b2c3d')
  })
  it('no digest (a dev-mode error): the two lines only, no empty label', () => {
    const { container } = render(<CoreUnansweredNotice reference={undefined} />)
    expect(container.textContent).toBe(s.unloaded + s.ifReloadFails)
  })
})
