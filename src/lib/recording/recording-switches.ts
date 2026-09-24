// The ONE switch registry for the recording lane — the recording copy of
// src/lib/appointments/booking-switches.ts. Plain constants — no env, no
// settings read: a flip is a one-line server PR through the normal gate, needs
// no phone bake, and both states are pinned by tests. Every switch is honest
// when OFF: nothing it gates half-runs.
export const RECORDING_SWITCHES = {
  /** A server-named upload (the in-tab fallback, and an old phone's copy of a
   *  take it never stored) gets a recording-session row born reserved on the
   *  exact key just signed, so no copy is ever stored with no row pointing at
   *  it (mint-take-url.ts, the `if (!input.takeId)` arm). OFF = the door
   *  answers exactly as it did before this switch existed: signed, bound to no
   *  row, no extra reads.
   *
   *  Flip conditions — all five must hold before this is turned ON:
   *  1. Read, not assumed: does build 28's baked upload-url consumer ignore,
   *     or safely use, a non-null `recordingSessionId`? Answer this from
   *     thin/ports/recording.vite.ts at the bake commit.
   *  2. Accepted cost of the never-lose ruling: each old-phone copy row reads
   *     復元可能 · serverAudio (inbox-read.ts:577-593 → inbox.ts:572-585). It
   *     also rings the owner bell ONCE per session (audit-watch/run.ts dedupes
   *     by target + action; find-karute-missing.ts:75), and no inbox row can be
   *     discarded — the card offers open, 保存する or 再試行 only. On an old
   *     phone that already saved its karute against the original session, this
   *     is a visible duplicate.
   *  3. PR-5 is merged first, so a second save of that row is not paid for
   *     twice.
   *  4. Accepted new noise class (v3 cold read, FIX 1): with the switch ON, a
   *     lost mint reply leaves an empty row that reads 失敗 after the grace
   *     (inbox.ts:600-603) and rings the owner bell once
   *     (find-karute-missing.ts:75). Today that path is silent because no row
   *     exists. No audio is lost (the retry draws a new uuid). The flip PR
   *     states this cost in its body and the inbox reason text for such rows
   *     is checked to read honestly before the flip.
   *  5. Audit coverage re-read by a human: the ON arm's row create emits no
   *     audit line and no client saves against that row yet (audit.ts
   *     `recordings.uploadUrl` entry says what IS covered). Add an emitter or
   *     the client's adoption of the returned id before any re-flip.
   *  Since S33 an upload whose recording already has a row
   *  (`attachOutcome: 'attach_failed'`) never takes the ON arm, in either
   *  state — mint-take-url.ts, the `if (!input.takeId)` arm.
   *  Flipped ON 2026-09-24, back OFF 2026-09-25 on Liam's word: the ON arm leaves an undismissable 復元可能 row after every successful fallback save (all clients) and lets a discarded take resurface — cold read COLD-READ-S32-VERDICTS.md (outside the repo). Re-flip only after the stray/discard fix lands. */
  bindUnboundUploads: false,
} as const
