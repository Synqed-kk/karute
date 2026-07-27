// readSyncResponse (SyncSection.tsx) unit coverage — PR-M2 fix round,
// blind-round finding #7 (minor): the nested-error-shape branch was never
// tested directly, only indirectly through UI interaction tests. Exported
// alongside the component (no behavior change) so these four shapes can be
// pinned without rendering React.
//
// next-intl mocked (same idiom as every other suite touching a module that
// imports it, e.g. thin-settings-sync-webonly-mount.test.tsx) — its real ESM
// build doesn't parse under this jest config, and we never render the
// component here anyway, only call the plain exported function.
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

import { readSyncResponse } from '@/components/settings/redesign/sections/SyncSection'

function fakeResponse(opts: {
  text: string
  ok: boolean
  status: number
  statusText: string
}): Response {
  return {
    text: async () => opts.text,
    ok: opts.ok,
    status: opts.status,
    statusText: opts.statusText,
  } as unknown as Response
}

describe('readSyncResponse', () => {
  it('nested {error:{code,message}} → the message is extracted, not the whole object', async () => {
    const res = fakeResponse({
      text: JSON.stringify({ error: { code: 'forbidden', message: 'Missing capability: sync.view' } }),
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    })
    await expect(readSyncResponse(res)).resolves.toEqual({
      ok: false,
      message: 'Error (403): Missing capability: sync.view',
    })
  })

  it('plain-string error → passed through as-is', async () => {
    const res = fakeResponse({
      text: JSON.stringify({ error: 'QuickReserve login expired' }),
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    })
    await expect(readSyncResponse(res)).resolves.toEqual({
      ok: false,
      message: 'Error (502): QuickReserve login expired',
    })
  })

  it('non-JSON text body (platform crash) → falls back to the raw text, sliced', async () => {
    const res = fakeResponse({
      text: 'Internal Server Error',
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })
    await expect(readSyncResponse(res)).resolves.toEqual({
      ok: false,
      message: 'Error (500): Internal Server Error',
    })
  })

  it('empty body → falls back to statusText', async () => {
    const res = fakeResponse({ text: '', ok: false, status: 502, statusText: 'Bad Gateway' })
    await expect(readSyncResponse(res)).resolves.toEqual({
      ok: false,
      message: 'Error (502): Bad Gateway',
    })
  })
})
