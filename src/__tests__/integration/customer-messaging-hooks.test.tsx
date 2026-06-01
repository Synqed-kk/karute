/**
 * @jest-environment jsdom
 *
 * Coverage for the customer-messaging scaffold layer (PR 18, replay/18).
 * useMessagingMutations exposes a single `logMessage` that — in this scaffold
 * stage — is a no-op that records to console.info (the Supabase insert is the
 * documented PROD SWAP). These tests pin the *current* scaffold contract:
 *  - logMessage is stable across renders (useCallback, no deps),
 *  - it logs to console.info with the full input in a browser env,
 *  - it neither throws nor returns a value.
 */
import { renderHook } from '@testing-library/react'
import { useMessagingMutations } from '@/lib/customer-messaging/hooks'
import type { LogMessageInput } from '@/lib/customer-messaging/types'

function input(over: Partial<LogMessageInput> = {}): LogMessageInput {
  return {
    customerId: 'cust-1',
    channel: 'line',
    body: 'こんにちは、先日はありがとうございました。',
    source: 'karute_followup',
    markSent: true,
    ...over,
  }
}

describe('useMessagingMutations', () => {
  let infoSpy: jest.SpyInstance

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
  })

  it('exposes a logMessage function', () => {
    const { result } = renderHook(() => useMessagingMutations())
    expect(typeof result.current.logMessage).toBe('function')
  })

  it('logMessage records the input to console.info and returns undefined', () => {
    const { result } = renderHook(() => useMessagingMutations())
    const payload = input()
    const ret = result.current.logMessage(payload)
    expect(ret).toBeUndefined()
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(infoSpy).toHaveBeenCalledWith('[scaffold] logMessage', payload)
  })

  it('passes through all optional + AI fields untouched', () => {
    const { result } = renderHook(() => useMessagingMutations())
    const payload = input({
      channel: 'email',
      source: 'dashboard_ai_action',
      aiDrafted: true,
      aiActionId: 'action-42',
      markSent: false,
    })
    result.current.logMessage(payload)
    expect(infoSpy).toHaveBeenCalledWith('[scaffold] logMessage', payload)
  })

  it('does not throw on any channel/source combination', () => {
    const { result } = renderHook(() => useMessagingMutations())
    const channels: LogMessageInput['channel'][] = ['line', 'sms', 'email', 'other']
    const sources: LogMessageInput['source'][] = [
      'karute_followup',
      'dashboard_ai_action',
      'manual',
    ]
    for (const channel of channels) {
      for (const source of sources) {
        expect(() => result.current.logMessage(input({ channel, source }))).not.toThrow()
      }
    }
    expect(infoSpy).toHaveBeenCalledTimes(channels.length * sources.length)
  })

  it('returns a stable logMessage reference across re-renders (useCallback, no deps)', () => {
    const { result, rerender } = renderHook(() => useMessagingMutations())
    const first = result.current.logMessage
    rerender()
    expect(result.current.logMessage).toBe(first)
  })
})
