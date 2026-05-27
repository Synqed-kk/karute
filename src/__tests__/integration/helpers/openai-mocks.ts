import type { ExtractionResult, SummaryResult } from '@/types/ai'

// Transcription mocks moved to Deepgram — see api-transcribe.test.ts.
// This helper now only feeds summary/extract tests, which still use OpenAI.

/**
 * Mock extraction result matching ExtractionResult shape.
 * Configure chat.completions.parse to return this for extraction tests.
 */
export const mockExtractionResult: ExtractionResult = {
  entries: [
    {
      category: 'preference',
      title: 'Natural brown color',
      source_quote: 'prefers a natural brown color',
      confidence_score: 0.92,
    },
    {
      category: 'symptom',
      title: 'Sensitive scalp',
      source_quote: 'has sensitive scalp',
      confidence_score: 0.88,
    },
  ],
}

/**
 * Mock summary result matching SummaryResult shape.
 * Configure chat.completions.parse to return this for summary tests.
 */
export const mockSummaryResult: SummaryResult = {
  summary:
    'Client visited for a color treatment. She prefers natural brown tones and reported having a sensitive scalp.',
}

/**
 * Returns the mock factory structure for jest.mock('@/lib/openai', ...).
 *
 * Usage in test file:
 * ```typescript
 * jest.mock('@/lib/openai', () => getOpenAIMockFactory())
 * ```
 *
 * NOTE: chat.completions.parse is not pre-configured because extract and summarize
 * return different shapes. Configure it per-test with mockResolvedValueOnce.
 */
export function getOpenAIMockFactory() {
  return {
    openai: {
      chat: {
        completions: {
          parse: jest.fn(),
        },
      },
    },
  }
}
