/**
 * webRecordingPort's upload legs after the 2026-08-25 hotfix. The bug this
 * pins: the browser used to write to the `recordings` bucket itself, and the
 * bucket's RLS started 403-ing it ("new row violates row-level security
 * policy") — every web take died at the upload. The web arm now goes through
 * the SAME server-minted signed-URL flow the thin arm has always used, so what
 * this file proves is the wiring: the blob goes to the MINTED url (never
 * supabase-js), the transcribe leg gets a SERVER-minted read url, and cleanup
 * is a server action.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mintRecordingUploadUrl = jest.fn(async () => ({
  path: 'app_biz-1_uuid-1.webm',
  url: 'https://proj.supabase.co/storage/v1/object/upload/sign/recordings/app_biz-1_uuid-1.webm?token=up',
  token: 'up',
}))
const mintRecordingReadUrl = jest.fn(async (p: string) => ({
  url: `https://proj.supabase.co/storage/v1/object/sign/recordings/${p}?token=read`,
}))
const removeRecordingObject = jest.fn(async (_p: string) => ({ ok: true as const }))
jest.mock('@/actions/recording-upload', () => ({
  mintRecordingUploadUrl: () => mintRecordingUploadUrl(),
  mintRecordingReadUrl: (p: string) => mintRecordingReadUrl(p),
  removeRecordingObject: (p: string) => removeRecordingObject(p),
}))

import { webRecordingPort } from '@/lib/ports/recording-port'

const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }) as unknown as Response)

beforeEach(() => {
  jest.clearAllMocks()
  mintRecordingUploadUrl.mockImplementation(async () => ({
    path: 'app_biz-1_uuid-1.webm',
    url: 'https://proj.supabase.co/storage/v1/object/upload/sign/recordings/app_biz-1_uuid-1.webm?token=up',
    token: 'up',
  }))
  mintRecordingReadUrl.mockImplementation(async (p: string) => ({
    url: `https://proj.supabase.co/storage/v1/object/sign/recordings/${p}?token=read`,
  }))
  removeRecordingObject.mockImplementation(async () => ({ ok: true as const }))
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200 }) as unknown as Response)
  global.fetch = fetchMock as unknown as typeof fetch
})

const blob = () => new Blob(['audio'], { type: 'audio/webm' })

describe('webRecordingPort.prepareTranscription', () => {
  it('PUTs the blob at the MINTED url — same request shape as the thin arm', async () => {
    const take = blob()
    await webRecordingPort.prepareTranscription(take)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchMock as unknown as jest.Mock).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://proj.supabase.co/storage/v1/object/upload/sign/recordings/app_biz-1_uuid-1.webm?token=up',
    )
    expect(init.method).toBe('PUT')
    expect(init.headers).toEqual({ 'content-type': 'audio/webm' })
    expect(init.body).toBe(take)
  })

  it('hands the transcribe leg the SERVER-minted read url for the path it just uploaded', async () => {
    const { body } = await webRecordingPort.prepareTranscription(blob())
    expect(mintRecordingReadUrl).toHaveBeenCalledWith('app_biz-1_uuid-1.webm')
    expect(body).toEqual({
      audioUrl:
        'https://proj.supabase.co/storage/v1/object/sign/recordings/app_biz-1_uuid-1.webm?token=read',
    })
  })

  it('mints, then uploads, then signs — never signs a path that was not written', async () => {
    const order: string[] = []
    mintRecordingUploadUrl.mockImplementation(async () => {
      order.push('mint')
      return { path: 'app_biz-1_uuid-1.webm', url: 'https://up/', token: 'up' }
    })
    fetchMock.mockImplementation(async () => {
      order.push('put')
      return { ok: true, status: 200 } as unknown as Response
    })
    mintRecordingReadUrl.mockImplementation(async () => {
      order.push('read')
      return { url: 'https://read/' }
    })
    await webRecordingPort.prepareTranscription(blob())
    expect(order).toEqual(['mint', 'put', 'read'])
  })

  it('cleanup deletes through the SERVER ACTION, with the uploaded path', async () => {
    const { cleanup } = await webRecordingPort.prepareTranscription(blob())
    expect(removeRecordingObject).not.toHaveBeenCalled()
    cleanup()
    expect(removeRecordingObject).toHaveBeenCalledWith('app_biz-1_uuid-1.webm')
  })

  it('cleanup is fire-and-forget — a rejecting delete never escapes', async () => {
    removeRecordingObject.mockRejectedValue(new Error('rpc down'))
    // cleanup() is called and not awaited, so "it didn't throw" is free — the
    // rejection would escape as an UNHANDLED one, which only the guard prevents.
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const { cleanup } = await webRecordingPort.prepareTranscription(blob())
      expect(() => cleanup()).not.toThrow()
      // Node reports an unhandled rejection once the microtask queue has drained
      // and the tick ends — take a full loop turn before reading the spy.
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('a rejected upload fails the take loudly (no silent empty transcript)', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 403 }) as unknown as Response)
    await expect(webRecordingPort.prepareTranscription(blob())).rejects.toThrow(
      'Upload failed (403)',
    )
    expect(mintRecordingReadUrl).not.toHaveBeenCalled()
  })
})

describe('webRecordingPort.stageForJob', () => {
  it('returns the TENANT-PREFIXED path the enqueue guard demands', async () => {
    await expect(webRecordingPort.stageForJob(blob())).resolves.toEqual({
      path: 'app_biz-1_uuid-1.webm',
    })
    expect(mintRecordingReadUrl).not.toHaveBeenCalled()
    expect(removeRecordingObject).not.toHaveBeenCalled()
  })

  it('PUTs to the minted url and propagates an upload failure', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500 }) as unknown as Response)
    await expect(webRecordingPort.stageForJob(blob())).rejects.toThrow('Upload failed (500)')
  })

  it('the server-job flag stays OFF — the flip is its own decision, not this hotfix', () => {
    expect(webRecordingPort.supportsServerJob).toBe(false)
  })
})

describe('the browser-direct uploader is gone', () => {
  it('recording-port.ts no longer reaches for the browser supabase client', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/ports/recording-port.ts'), 'utf8')
    expect(source).not.toContain('@/lib/supabase/client')
    expect(source).not.toContain('.storage.from(')
    expect(source).not.toMatch(/rec_\$\{/)
  })
})
