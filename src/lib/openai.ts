import OpenAI from 'openai'

/**
 * Shared OpenAI client singleton for all AI routes.
 * Import this in transcription, extraction, and summary route handlers.
 * Do not import toFile here — each route imports it directly from 'openai'.
 */
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 2,
})
