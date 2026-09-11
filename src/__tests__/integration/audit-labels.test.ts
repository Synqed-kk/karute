// 監査ログ round 2, PR D2 — unit tests for the pure display-only helpers in
// src/lib/audit-labels.ts. Table/boundary tests only (no React, no i18n
// mocking needed — the AuditLogSection render tests cover rendered text).
import {
  automationLabelKey,
  karuteMissingReasonKey,
  transcribeFailedReasonKey,
  formatStormCostUsd,
  foldRepeats,
  rangeDays,
} from '@/lib/audit-labels'
import type { AuditLogEvent } from '@/actions/audit-log'

describe('automationLabelKey (I2 — system-row actor label)', () => {
  const cases: [string, string | null][] = [
    // specific matches win over the recording.transcribe* wildcard below
    ['recording.karute_missing', 'automation.watch'],
    ['recording.transcribe_storm', 'automation.watch'],
    ['recording.capture_resumed', 'automation.rescue'],
    ['customer.pack_redeem', 'automation.autoburn'],
    ['recording.session_cleanup', 'automation.cleanup'],
    // the wildcard: every OTHER recording.transcribe* action
    ['recording.transcribe', 'automation.transcribe'],
    ['recording.transcribe_failed', 'automation.transcribe'],
    ['recording.transcribe_refused', 'automation.transcribe'],
    // no automation label — today's plain システム fallback
    ['karute.save', null],
    ['recording.play', null],
    ['recording.discard', null],
    ['privacy.customer_delete_scheduled', null],
  ]
  it.each(cases)('%s -> %s', (action, expected) => {
    expect(automationLabelKey(action)).toBe(expected)
  })
})

describe('karuteMissingReasonKey (I6 — InboxReason -> reason.* key)', () => {
  const cases: [unknown, string | null][] = [
    ['emptyTranscript', 'reason.empty_transcript'],
    ['genericFailure', 'reason.job_failed'],
    ['localAudio', 'reason.not_transcribed'],
    ['tailIncomplete', 'reason.not_transcribed'],
    ['serverAudio', 'reason.not_transcribed'],
    ['someUnknownFutureValue', null],
    [undefined, null],
    [null, null],
  ]
  it.each(cases)('%p -> %p', (reason, expected) => {
    expect(karuteMissingReasonKey(reason)).toBe(expected)
  })
})

describe('transcribeFailedReasonKey (I6)', () => {
  const cases: [unknown, string | null][] = [
    ['empty_transcript', 'reason.empty_transcript'],
    ['other', 'reason.other'],
    ['something_else', null],
    [undefined, null],
  ]
  it.each(cases)('%p -> %p', (reason, expected) => {
    expect(transcribeFailedReasonKey(reason)).toBe(expected)
  })
})

describe('formatStormCostUsd (I7 — cents -> "$X.XX", never yen)', () => {
  const cases: [number, string][] = [
    [693, '$6.93'],
    [1, '$0.01'],
    [100, '$1.00'],
    [5, '$0.05'],
  ]
  it.each(cases)('%i cents -> %s', (cents, expected) => {
    expect(formatStormCostUsd(cents)).toBe(expected)
    expect(formatStormCostUsd(cents)).not.toContain('¥')
  })
})

describe('foldRepeats (I1 — same action/target_type/target_id/actor_id folds)', () => {
  function ev(overrides: Partial<AuditLogEvent>): AuditLogEvent {
    return {
      id: 'e',
      at: '2026-09-10T10:00:00.000Z',
      actor_id: 'staff-1',
      actor_type: 'staff',
      category: 'recording',
      action: 'recording.play',
      target_type: 'recording',
      target_id: 'rec-1',
      target_label: null,
      detail: null,
      break_glass: false,
      severity: 'info',
      request_id: null,
      store_id: null,
      ...overrides,
    }
  }

  it('two rows sharing the 4-tuple fold into one group of 2', () => {
    const groups = foldRepeats([ev({ id: 'a' }), ev({ id: 'b' })])
    expect(groups.length).toBe(1)
    expect(groups[0]!.events.length).toBe(2)
  })

  it('m1 — a different actor breaks the fold (two groups)', () => {
    const groups = foldRepeats([ev({ id: 'a', actor_id: 'staff-1' }), ev({ id: 'b', actor_id: 'staff-2' })])
    expect(groups.length).toBe(2)
  })

  it('a different action breaks the fold (two groups)', () => {
    const groups = foldRepeats([
      ev({ id: 'a', action: 'recording.play' }),
      ev({ id: 'b', action: 'recording.transcribe' }),
    ])
    expect(groups.length).toBe(2)
  })

  it('a different target_id breaks the fold (two groups)', () => {
    const groups = foldRepeats([ev({ id: 'a', target_id: 'rec-1' }), ev({ id: 'b', target_id: 'rec-2' })])
    expect(groups.length).toBe(2)
  })

  it('deviation pin: differing detail breaks the fold even with an identical 4-tuple (stress-audit F5b — the ON/OFF autostart pair must never merge)', () => {
    const groups = foldRepeats([
      ev({ id: 'on', action: 'settings.recording_autostart_toggle', target_type: 'store', detail: { enabled: true } }),
      ev({ id: 'off', action: 'settings.recording_autostart_toggle', target_type: 'store', detail: { enabled: false } }),
    ])
    expect(groups.length).toBe(2)
  })

  it('identical detail (the true-repeat case) still folds', () => {
    const groups = foldRepeats([ev({ id: 'a', detail: { x: 1 } }), ev({ id: 'b', detail: { x: 1 } })])
    expect(groups.length).toBe(1)
    expect(groups[0]!.events.length).toBe(2)
  })

  it('a single row is its own group of 1 — never merged with anything', () => {
    const groups = foldRepeats([ev({ id: 'a' })])
    expect(groups.length).toBe(1)
    expect(groups[0]!.events.length).toBe(1)
  })

  it('a retry run interleaved with an unrelated row still folds to one group (NOT merely-adjacent)', () => {
    const groups = foldRepeats([
      ev({ id: 'a', action: 'recording.transcribe' }),
      ev({ id: 'x', action: 'customer.view', target_type: 'customer', target_id: 'cus-1' }),
      ev({ id: 'b', action: 'recording.transcribe' }),
    ])
    expect(groups.length).toBe(2)
    const transcribeGroup = groups.find((g) => g.events[0]!.action === 'recording.transcribe')
    expect(transcribeGroup?.events.length).toBe(2)
  })
})

describe('rangeDays (I5)', () => {
  const cases: [ '7d' | '30d' | '90d' | 'all', number | null][] = [
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
    ['all', null],
  ]
  it.each(cases)('%s -> %p', (preset, expected) => {
    expect(rangeDays(preset)).toBe(expected)
  })
})
