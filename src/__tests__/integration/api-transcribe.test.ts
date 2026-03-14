import { testApiHandler } from 'next-test-api-route-handler'
import * as appHandler from '@/app/api/ai/transcribe/route'

jest.mock('@/lib/openai', () => ({
  openai: {
    audio: {
      transcriptions: {
        create: jest.fn(),
      },
    },
  },
}))

jest.mock('openai', () => ({
  ...jest.requireActual('openai'),
  toFile: jest.fn().mockResolvedValue('mocked-file'),
}))

import { openai } from '@/lib/openai'
import { mockTranscriptionResult } from './helpers/openai-mocks'

describe('POST /api/ai/transcribe', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns transcript for valid audio upload', async () => {
    ;(openai.audio.transcriptions.create as jest.Mock).mockResolvedValue(mockTranscriptionResult)

    const formData = new FormData()
    const audioBlob = new Blob(['fake-audio'], { type: 'audio/webm' })
    formData.append('audio', audioBlob, 'audio.webm')
    formData.append('locale', 'en')

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          body: formData,
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toHaveProperty('transcript')
        expect(body.transcript).toBe(mockTranscriptionResult)
      },
    })
  })

  it('returns 400 when no audio file provided', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          body: new FormData(),
        })

        expect(response.status).toBe(400)
        const body = await response.json()
        expect(body).toHaveProperty('error')
        expect(body.error).toMatch(/No audio/i)
      },
    })
  })

  it('defaults locale to ja when not specified', async () => {
    ;(openai.audio.transcriptions.create as jest.Mock).mockResolvedValue(mockTranscriptionResult)

    const formData = new FormData()
    const audioBlob = new Blob(['fake-audio'], { type: 'audio/webm' })
    formData.append('audio', audioBlob, 'audio.webm')
    // No locale field appended

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          body: formData,
        })

        expect(response.status).toBe(200)
        expect(openai.audio.transcriptions.create).toHaveBeenCalledWith(
          expect.objectContaining({ language: 'ja' })
        )
      },
    })
  })

  it('handles mp4 audio (iOS Safari)', async () => {
    ;(openai.audio.transcriptions.create as jest.Mock).mockResolvedValue(mockTranscriptionResult)

    const formData = new FormData()
    const audioBlob = new Blob(['fake-audio'], { type: 'audio/mp4' })
    formData.append('audio', audioBlob, 'audio.mp4')
    formData.append('locale', 'en')

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          body: formData,
        })

        expect(response.status).toBe(200)
        expect(openai.audio.transcriptions.create).toHaveBeenCalled()
      },
    })
  })
})
