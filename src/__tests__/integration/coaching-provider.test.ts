/**
 * Coaching LLM provider flip — proves the Anthropic⇄OpenAI selection + the model-tier
 * mapping. Pure env logic; no API calls.
 */
import {
  resolveCoachingProvider,
  resolveCoachingModelId,
} from '@/lib/karute/coaching/llm/provider'

const REASON = 'claude-sonnet-5'
const REALTIME = 'claude-haiku-4-5-20251001'

describe('coaching provider flip', () => {
  const ORIGINAL = process.env
  beforeEach(() => {
    process.env = { ...ORIGINAL }
    delete process.env.KARUTE_COACHING_PROVIDER
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
  })
  afterEach(() => {
    process.env = ORIGINAL
  })

  it('the explicit flag wins — anthropic', () => {
    process.env.KARUTE_COACHING_PROVIDER = 'anthropic'
    process.env.OPENAI_API_KEY = 'x' // present, but the flag overrides
    expect(resolveCoachingProvider()).toBe('anthropic')
  })
  it('the explicit flag wins — openai', () => {
    process.env.KARUTE_COACHING_PROVIDER = 'openai'
    process.env.ANTHROPIC_API_KEY = 'x'
    expect(resolveCoachingProvider()).toBe('openai')
  })
  it('no flag: auto-picks the only key present (anthropic)', () => {
    process.env.ANTHROPIC_API_KEY = 'x'
    expect(resolveCoachingProvider()).toBe('anthropic')
  })
  it('defaults to openai (the app’s existing provider)', () => {
    process.env.OPENAI_API_KEY = 'x'
    expect(resolveCoachingProvider()).toBe('openai')
  })
})

describe('coaching model-tier mapping', () => {
  it('maps the reason tier per provider', () => {
    expect(resolveCoachingModelId(REASON, 'anthropic')).toBe('claude-sonnet-5')
    expect(resolveCoachingModelId(REASON, 'openai')).toBe('gpt-4o')
  })
  it('maps the realtime tier per provider', () => {
    expect(resolveCoachingModelId(REALTIME, 'anthropic')).toBe('claude-haiku-4-5-20251001')
    expect(resolveCoachingModelId(REALTIME, 'openai')).toBe('gpt-4o-mini')
  })
  it('passes an unknown model id through unchanged', () => {
    expect(resolveCoachingModelId('gpt-4o-custom', 'openai')).toBe('gpt-4o-custom')
  })
})
