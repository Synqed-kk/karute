// The ONE switch registry for the recording lane — the recording copy of
// src/lib/appointments/booking-switches.ts. Plain constants — no env, no
// settings read: a flip is a one-line server PR through the normal gate, needs
// no phone bake when the switch is server-side (it flips with the deploy; a CLIENT-side switch — today `captureWarningNotice` — reaches the phone only with its next bake), and both states are pinned by tests. Every switch is honest
// when OFF: nothing it gates half-runs.
export const RECORDING_SWITCHES = {
  /** A server-named upload from a client that ADOPTS the row it is given —
   *  the in-tab fallback's `attachOutcome: 'no_session'` run, on the web and
   *  on phones from build 29 — gets a recording-session row born reserved on
   *  the exact key just signed, so that copy is never stored with no row
   *  pointing at it (mint-take-url.ts, the `if (!input.takeId)` arm). That is
   *  the ONLY upload the ON arm serves (S50, 5C): a server-named body with no
   *  `attachOutcome` (a client older than build 29, which never adopts the
   *  row) stays unbound exactly as with the switch OFF — Liam 2026-09-28:
   *  builds two behind are expired. OFF = the door answers exactly as it did
   *  before this switch existed: signed, bound to no row, no extra reads.
   *
   *  Flip conditions — all five must hold before this is turned ON:
   *  1. Read, not assumed: does the client's upload-url consumer ignore, or
   *     safely use, a non-null `recordingSessionId`? RE-READ 2026-09-28
   *     against build 31 (`2d9239403`): HOLDS — build 28's fallback
   *     (thin/ports/recording.vite.ts `prepareTranscription`, body
   *     `{ stagedFor: null }`) ignores the id; 29 and later guard it (read
   *     typeof-checked, adopted only where no row is named yet, first stamp
   *     wins) — FLIP-READ-S50 §2 (outside the repo). Moot since 5C for a body
   *     with no `attachOutcome`: it is never answered an id.
   *  2. Accepted cost of the never-lose ruling: a bound row that no karute
   *     save names (the O4 race, a superseded run, a take nobody acts on)
   *     reads 復元可能 · serverAudio (inbox-read.ts:775 → inbox.ts:599-611).
   *     It also rings the owner bell ONCE per session (audit-watch/run.ts
   *     dedupes by target + action; find-karute-missing.ts:75), and no inbox
   *     row can be discarded — the card offers open, 保存する or 再試行 only.
   *     Where the visit was already saved against another row, this is a
   *     visible duplicate.
   *  3. PR-5 is merged first, so a second save of that row is not paid for
   *     twice.
   *  4. Accepted new noise class (v3 cold read, FIX 1): with the switch ON, a
   *     lost mint reply leaves an empty row that reads 失敗 after the grace
   *     (inbox.ts:626-631) and rings the owner bell once
   *     (find-karute-missing.ts:75). So does a FAILED PUT after a bound mint:
   *     the row is created before the PUT (mint-take-url.ts, the
   *     `if (!input.takeId)` arm) and the port throws on `!put.ok`
   *     (thin/ports/recording.vite.ts:239) before the id is handed back, so
   *     nothing adopts it → the same empty row → 処理中 for the grace → 失敗.
   *     Today that path is silent because no row exists. No audio is lost
   *     (the retry draws a new uuid). The flip PR states this cost in its body
   *     and the inbox reason text for such rows is checked to read honestly
   *     before the flip.
   *  5. CLOSED BY AN EMITTER (S50, 5A): the ON arm's row create files ONE
   *     `recording.take_bound_server_named` row on the bound success
   *     (mint-take-url.ts#auditTakeBoundServerNamed; audit.ts
   *     `recordings.uploadUrl` entry), whether or not a karute save or 破棄
   *     ever names the row — since 5C only a 'no_session' run of a client that
   *     adopts it (the web, phones from build 29) reaches that create. It is
   *     a NEW core audit_log row per bound mint, written only while this
   *     switch is ON. A human still re-reads that entry before any re-flip.
   *  Since S33 an upload whose recording already has a row
   *  (`attachOutcome: 'attach_failed'`) never takes the ON arm, in either
   *  state — mint-take-url.ts, the `if (!input.takeId)` arm.
   *  Flipped ON 2026-09-24, back OFF 2026-09-25 on Liam's word: the ON arm leaves an undismissable 復元可能 row after every successful fallback save (all clients) and lets a discarded take resurface — cold read COLD-READ-S32-VERDICTS.md (outside the repo). Since S33/S34 (attach first, adopt X) that is fixed for the web and builds 29+, and since 5C a build-28 upload never gets a row; the O4 race residue stays (FLIP-READ-S50 §6). A re-flip is Liam's word, never a default. */
  bindUnboundUploads: false,
  /** The recorder's yellow notice (PR-6): during a recording, tell staff this phone cannot save (audio goes straight to the server) or the server is not receiving (audio is kept on the phone), and file one `recording.capture_warned` fact per reason a take shows. Default ON, 2026-09-26. OFF = PR-6 never computes, never renders, never writes the fact — pre-PR-6 behaviour exactly. Client code: a flip reaches the phone with its next bake. */
  captureWarningNotice: true,
  /** The head probe on a stored take (S60 PR-A). Gates BOTH the finalize probe
   *  (A2, finalize-take.ts: an unreadable object is refused — no duration, one
   *  create-only `refused` mark, one recording.finalize_refused row) and the
   *  meter probe (A3, transcribe.ts: an unreadable object is refused before
   *  any rate-limit consume, reserve or provider call). Default ON,
   *  2026-09-29. OFF = zero extra storage calls (no sign, no ranged GET, no
   *  mark) and byte-identical answers — pre-PR-A behaviour exactly.
   *  Server-side: a flip lands with the deploy. */
  finalizeProbe: true,
  /** The phone's partial door (build 32, PR-B commits 1-2): the recorder
   *  counts the bytes it put on disk per take (`TakeMeta.bytesEmitted`,
   *  mirrored inside the segment transaction) so a whole-blob door can tell
   *  a short blob from a whole one. Default ON. OFF = no counter is written —
   *  pre-PR-B behaviour exactly. Client code: a flip reaches the phone with
   *  its next bake. */
  stagedPartialDoor: true,
  /** Capture that ends by itself says so (build 32, PR-B commit 4, B8): the
   *  mic track's ended / mute, the recorder's error and the page's pagehide /
   *  freeze write `TakeMeta.endedBySystem {at, why}` — LOCAL only, never sent —
   *  and, once stopped, one line in the 'recorded' state, shown only under
   *  `captureWarningNotice` (the outer gate). Records only: nothing restarts
   *  capture, the stop leg's order is untouched. Default ON. OFF = no hook
   *  attached, no field, no line — pre-PR-B exactly. Client code. */
  captureEndHooks: true,
  /** The take keeps its own flight record (build 32, PR-B commit 5, B5): a
   *  bounded local ring on the take (hidden / freeze / store-error events),
   *  and a `diag` of ONLY the 12 keys the server already accepts on the
   *  finalize body and the staged mint body — checked on the phone first and
   *  omitted when not valid. Default ON. OFF = no ring written, no diag sent —
   *  pre-PR-B exactly. Client code. */
  takeDiag: true,
} as const
