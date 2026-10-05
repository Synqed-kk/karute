/**
 * PR-A0 — every Sentry.init (server nodejs, server edge, browser) is wired to
 * the one scrub, checked by identity on the options actually passed to init.
 * The SDK is mocked HERE on purpose: this test checks wiring, not the SDK
 * (the real-SDK canary is sentry-scrub-canary.test.ts).
 */
type InitOptions = Record<string, unknown>

const mockInitCalls: InitOptions[] = []

jest.mock('@sentry/nextjs', () => ({
  init: (options: InitOptions) => {
    mockInitCalls.push(options)
  },
  captureRequestError: () => undefined,
  captureRouterTransitionStart: () => undefined,
}))

type ScrubModule = typeof import('@/lib/observability/sentry-scrub')

const DSN_VAR = 'NEXT_PUBLIC_SENTRY_DSN'
const ENV_KEYS = [DSN_VAR, 'NEXT_RUNTIME'] as const
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  mockInitCalls.length = 0
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env[DSN_VAR] = 'https://public@example.invalid/1'
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function expectWired(options: InitOptions | undefined, scrub: ScrubModule) {
  expect(options).toBeDefined()
  expect(options!.beforeSend).toBe(scrub.scrubEvent)
  expect(options!.beforeSendTransaction).toBe(scrub.scrubTransaction)
  expect(options!.beforeBreadcrumb).toBe(scrub.scrubBreadcrumb)
  expect(options!.beforeSendSpan).toBe(scrub.scrubSpan)
  expect(options!.sendDefaultPii).toBe(false)
  expect(options!.enableLogs).toBeFalsy()
}

describe('every Sentry.init is wired to the scrub', () => {
  it.each(['nodejs', 'edge'])('server register() with NEXT_RUNTIME=%s', async (runtime) => {
    process.env.NEXT_RUNTIME = runtime
    let register: () => Promise<void> = async () => undefined
    let scrub: ScrubModule | undefined
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a synchronous require
      register = require('@/instrumentation').register
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the same registry as the module under test
      scrub = require('@/lib/observability/sentry-scrub')
    })
    await register()
    expect(mockInitCalls).toHaveLength(1)
    expectWired(mockInitCalls[0], scrub!)
  })

  it('browser instrumentation-client', () => {
    let scrub: ScrubModule | undefined
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- importing runs the browser init
      require('@/instrumentation-client')
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the same registry as the module under test
      scrub = require('@/lib/observability/sentry-scrub')
    })
    expect(mockInitCalls).toHaveLength(1)
    expectWired(mockInitCalls[0], scrub!)
  })
})
