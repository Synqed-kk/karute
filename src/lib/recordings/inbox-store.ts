'use client'

/**
 * 録音履歴 — the client store (Build F1).
 *
 * A module singleton, the same idiom as globalPipeline / thin's chrome-store,
 * because the inbox has THREE consumers that must never disagree: the section
 * on the record page, the 要対応 badge on the mic FAB, and the 要対応 badge on
 * the desktop sidebar. One fetch, one fold, one count.
 *
 * The fold has to happen HERE and not on a server, because two of the five
 * states depend on facts only this DEVICE holds: 確認待ち is "a record exists
 * AND our take was never settled", and 復元可能 is "the audio is still in this
 * browser's IndexedDB". A server-computed count would be wrong on both.
 *
 * EVERY heavy dependency is DYNAMICALLY imported inside loadInbox — the same
 * rule (and the same reason) as lib/karute/logout-wipe: the badge consumers are
 * the sidebar and the bottom nav, which render in plain component tests and on
 * every page. Their module graph must not reach the server action, the synqed
 * SDK, or IndexedDB just because a nav bar rendered. The static graph here is
 * React plus the pure fold next door.
 *
 * Refresh: on mount/navigation (the consumers' effects) and on the
 * globalPipeline settle transition — the same signal thin's chrome-store uses,
 * so a run ending updates the rows and the badge with no reload.
 *
 * ONE bounded exception to "no polling", and it exists because of the very case
 * this feature was built for: a SUPERSEDED run's later completion is silent by
 * construction. The pipeline guards every settle on `runId`, so when a second
 * recording supersedes the first, the first run's eventual DONE notifies
 * nothing and no client-side event will ever fire for it. Without a poll a
 * 処理中 row would sit there until the staffer navigated away and back. So:
 * while ANY row is processing-class AND a consumer is mounted, re-fold every
 * 90 s; the timer stops the moment a fold comes back with none. No timer on an
 * unmounted store, none on a settled list, and never more than one in flight.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { deriveInboxRows, countNeedsAttention, type InboxRow } from './inbox'

export interface InboxState {
  status: 'idle' | 'loading' | 'ready' | 'partial'
  rows: InboxRow[]
  needsAttention: number
  /** When these rows were folded. The card's 今日/昨日 headers are read off THIS
   *  rather than a render-time clock — a component that reads Date.now() while
   *  rendering is impure (react-hooks/purity), and labels that disagree with
   *  the fold would be a second, quieter source of truth about the same rows. */
  foldedAt: number
  /** True when the SERVER half failed — the rows below are this device's takes
   *  only, so the list is incomplete and says so rather than reading clean. */
  serverFailed: boolean
}

const EMPTY: InboxState = {
  status: 'idle',
  rows: [],
  needsAttention: 0,
  foldedAt: 0,
  serverFailed: false,
}

let current: InboxState = EMPTY
const listeners = new Set<() => void>()
let loading = false
/** A refresh that arrived while a fold was in flight. The dropped call used to
 *  be lost outright, so a pipeline settle landing mid-load left the rows and
 *  the badge showing the PRE-settle world until something else moved. One
 *  trailing re-run, never a loop: the flag is cleared before the re-run
 *  starts, so N concurrent calls cost exactly one follow-up fold. */
let pendingReload = false
/** Bumped on every sign-out wipe so an in-flight fetch can't write the
 *  PREVIOUS user's sessions into a shared salon device. Same discipline as
 *  chrome-store's epoch / globalPipeline's runId. */
let epoch = 0
/** The bounded processing poll (see the header). At most one, ever. */
let pollTimer: ReturnType<typeof setTimeout> | null = null
export const INBOX_POLL_MS = 90_000

function set(next: InboxState): void {
  current = next
  listeners.forEach((l) => l())
}

export function getInboxState(): InboxState {
  return current
}

export function subscribeInbox(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    // Last consumer gone → nothing is watching, so the processing poll stands
    // down immediately rather than firing one more fetch nobody reads.
    if (listeners.size === 0) stopPoll()
  }
}

/** Drop everything (logout on a shared device — takes and sessions are the
 *  leaving staffer's). Invalidates any fetch still in flight. */
export function resetInbox(): void {
  epoch++
  loading = false
  pendingReload = false
  stopPoll()
  set(EMPTY)
}

function stopPoll(): void {
  if (!pollTimer) return
  clearTimeout(pollTimer)
  pollTimer = null
}

/** Arm the bounded processing poll for the rows we just folded, or stand it
 *  down. Called on every settled fold, so a list that goes quiet stops the
 *  timer by itself and an unmounted store never holds one. */
function schedulePoll(rows: readonly InboxRow[]): void {
  stopPoll()
  // All three processing-class reasons (transcribing / unsettled / the
  // unknown-job handling) land on this one state.
  if (listeners.size === 0 || !rows.some((r) => r.state === 'processing')) return
  pollTimer = setTimeout(() => {
    pollTimer = null
    void loadInbox()
  }, INBOX_POLL_MS)
}

/** This device's takes, minus the ones a live recorder/pipeline owns. An
 *  in-progress session is not history, and offering it as 復元可能 would let a
 *  save delete audio still being captured. */
async function readLocalTakes() {
  const [{ listOwnTakes }, { globalRecorder }, { globalPipeline }] = await Promise.all([
    import('@/lib/karute/take-store'),
    import('@/lib/global-recorder'),
    import('@/lib/global-pipeline'),
  ])
  const takes = await listOwnTakes([globalRecorder.takeId, globalPipeline.context?.takeId])
  return takes.map((t) => ({
    takeId: t.takeId,
    recordingSessionId: t.recordingSessionId,
    customerId: t.target?.customerId ?? null,
    customerName: t.target?.customerName ?? null,
    startedAt: t.startedAt,
    updatedAt: t.updatedAt,
    tailIncomplete: t.tailIncomplete,
  }))
}

async function readServerSessions() {
  try {
    const { listRecordingsInbox } = await import('@/actions/recordings-inbox')
    return { sessions: await listRecordingsInbox(), failed: false }
  } catch (err) {
    // Loud in the console, honest on screen: the card renders 「一部の録音を
    // 読み込めませんでした」 rather than an empty list that reads as "nothing
    // failed" to a staffer whose recordings are exactly what failed.
    console.warn('[recordings-inbox] server read failed:', err)
    return { sessions: [], failed: true }
  }
}

/**
 * Re-read both halves and re-fold. Single-flight with a TRAILING re-run: a call
 * that arrives while a fold is in flight is remembered, not dropped, and runs
 * exactly once when the current one finishes. Several consumers mount their own
 * effects and the settle subscription fires on top of them, so concurrent calls
 * are the normal case — and the one that matters most (a pipeline settle) is
 * precisely the one that used to be thrown away mid-load.
 */
export async function loadInbox(): Promise<void> {
  if (loading) {
    pendingReload = true
    return
  }
  loading = true
  const myEpoch = epoch
  armPipelineWatch()
  set({ ...current, status: 'loading' })
  try {
    const [takes, server] = await Promise.all([
      readLocalTakes().catch((err: unknown) => {
        console.warn('[recordings-inbox] local takes unreadable:', err)
        return []
      }),
      readServerSessions(),
    ])
    if (epoch !== myEpoch) return
    const foldedAt = Date.now()
    const rows = deriveInboxRows({ sessions: server.sessions, takes, now: foldedAt })
    set({
      status: server.failed ? 'partial' : 'ready',
      rows,
      needsAttention: countNeedsAttention(rows),
      foldedAt,
      serverFailed: server.failed,
    })
    schedulePoll(rows)
  } finally {
    if (epoch === myEpoch) {
      loading = false
      // A refresh that arrived mid-fold runs now, once. Cleared BEFORE the
      // re-run so the re-run's own concurrent callers can set it again without
      // this one looping.
      if (pendingReload) {
        pendingReload = false
        void loadInbox()
      }
    }
  }
}

/** Subscribe + load on mount. Returns the current state. */
export function useRecordingsInbox(): InboxState {
  const state = useSyncExternalStore(subscribeInbox, getInboxState, () => EMPTY)
  useEffect(() => {
    void loadInbox()
  }, [])
  return state
}

// Refresh when a pipeline run ENDS — 'idle' (saved or discarded) or 'error'.
// Armed once, on the first load, so the subscription (and globalPipeline with
// it) never enters a nav bar's module graph. Fires on the TRANSITION only; the
// pipeline notifies on every step.
let watchArmed = false
function armPipelineWatch(): void {
  if (watchArmed) return
  watchArmed = true
  void import('@/lib/global-pipeline').then(({ globalPipeline }) => {
    let prev = globalPipeline.state
    globalPipeline.subscribe(() => {
      const next = globalPipeline.state
      const ended = (next === 'idle' && prev !== 'idle') || (next === 'error' && prev !== 'error')
      prev = next
      if (ended) void loadInbox()
    })
  })
}
