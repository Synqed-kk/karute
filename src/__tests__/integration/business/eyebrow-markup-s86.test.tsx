/**
 * @jest-environment jsdom
 *
 * S86 F4 — the eyebrow is EXACTLY the dateline when there is no sample (no
 * trailing space, no empty span), and the chip follows it after exactly one
 * space when there is. Rendered for real: a `.test.tsx` directly in this
 * folder may mount through @testing-library/react (business-isolation's
 * rendered-test door); `.test.ts` files and react-dom/server stay fenced.
 */
import { render } from '@testing-library/react'
import { inboxProps } from '@/app/[locale]/(business)/business/inbox/inbox-props'
import { registerProps } from '@/app/[locale]/(business)/business/register/register-props'
import { InboxScreen } from '@/app/[locale]/(business)/business/inbox/InboxScreen'
import { RegisterScreen } from '@/app/[locale]/(business)/business/register/RegisterScreen'
import { STORE_A } from '@/business/lib/fixtures'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SAMPLE = { form: 'whole' } as const

beforeAll(() => {
  delete process.env.BUSINESS_PRACTICE_TENANT
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
  }
})

it('受信トレイ eyebrow: bare dateline without a sample, one space then the chip with one', async () => {
  const { props } = await inboxProps({ locale: 'ja', store: STORE_A })
  const bare = render(<InboxScreen {...props} sample={undefined} />)
  expect(bare.container.querySelector('.ib-eyebrow')!.outerHTML).toBe(`<div class="ib-eyebrow">${props.dateline}</div>`)
  bare.unmount()
  const marked = render(<InboxScreen {...props} sample={SAMPLE} />)
  expect(marked.container.querySelector('.ib-eyebrow')!.outerHTML).toMatch(new RegExp(`^<div class="ib-eyebrow">${escapeRe(props.dateline)} <span class="sample-mark"[^>]*>[^<]+</span></div>$`))
})

it('レジ eyebrow: bare dateline without a sample, one space then the chip with one', async () => {
  const { props } = await registerProps({ locale: 'ja', store: STORE_A })
  const bare = render(<RegisterScreen {...props} sample={undefined} />)
  expect(bare.container.querySelector('.rg-eyebrow')!.outerHTML).toBe(`<div class="rg-eyebrow">${props.dateline}</div>`)
  bare.unmount()
  const marked = render(<RegisterScreen {...props} sample={SAMPLE} />)
  expect(marked.container.querySelector('.rg-eyebrow')!.outerHTML).toMatch(new RegExp(`^<div class="rg-eyebrow">${escapeRe(props.dateline)} <span class="sample-mark"[^>]*>[^<]+</span></div>$`))
})
