import { testApiHandler } from 'next-test-api-route-handler'
import * as appHandler from '@/app/api/ai/extract/route'

jest.mock('@/lib/openai', () => ({
  openai: {
    chat: { completions: { parse: jest.fn() } },
  },
}))

import { openai } from '@/lib/openai'
import { mockExtractionResult } from './helpers/openai-mocks'

describe('POST /api/ai/extract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns extracted entries for valid transcript', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: mockExtractionResult } }],
    })

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: 'Client wanted natural brown hair.',
            locale: 'en',
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toHaveProperty('entries')
        expect(Array.isArray(body.entries)).toBe(true)
        expect(body.entries).toHaveLength(mockExtractionResult.entries.length)
      },
    })
  })

  it('returns 400 when transcript is missing', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })

        expect(response.status).toBe(400)
      },
    })
  })

  it('returns 400 when transcript is empty string', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: '' }),
        })

        expect(response.status).toBe(400)
      },
    })
  })

  it('returns 500 when OpenAI fails', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockRejectedValue(
      new Error('OpenAI API error')
    )

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: 'Client wanted natural brown hair.',
            locale: 'en',
          }),
        })

        expect(response.status).toBe(500)
      },
    })
  })
})
