// ⚖ THE TRANSCRIPTION RECEIPT — what the meter (src/lib/ai/transcribe.ts,
// runMeteredTranscription) hands back about the money for ONE call, and the
// ONE rule for the severity of the audit row that carries it. Its own module,
// with no imports, so every door that files the row reads the same rule — the
// meter's own row, the web route's JSON arm, the facade route — and a test that
// stubs the meter away does not stub the rule with it.

/** WHAT THE METER DID, for the doors that file their OWN receipt row (the two
 *  interactive routes) — handed back from the call itself rather than
 *  recomputed, because `debit_recorded` is an OUTCOME: no second pass over the
 *  provider's body could ever know it (fix round 2, Greptile P1). */
export interface TranscriptionReceipt {
  duration_seconds: number
  cost_cents: number
  /** What the ledger was told BEFORE the provider ran. `cost_cents` is the
   *  truth; the ledger holds the GREATER of the two, because the reserve is
   *  never refunded (fix round 4). */
  cents_reserved: number
  /** false = the ledger does not hold this answer's whole cost: the money was
   *  spent and the ledger is short by the true-up — lost (the writer gave up),
   *  or, on a replay only, not recorded by THIS call on purpose (then
   *  `debit_deferred_reason` says why). Never hardcoded: the ledger's answer,
   *  or the true-up's own state. */
  debit_recorded: boolean
  /** true = answered from the durable memo: no provider call, no ceiling
   *  consumed, no ledger row (PR-5, charge once). false on every paid call. */
  replayed: boolean
  /** ⚖ S57 — present ONLY on a replay whose memo still owes a true-up that
   *  THIS call deliberately did not record (Greptile round 2 on #1086, finding
   *  1: a replay records an owed true-up only while it HOLDS the lease):
   *  'lease_busy' = another call holds the lease — the paying call finishing
   *  its own true-up, or another replay finishing it — and that call records
   *  it, never this one; 'storage_unknown' = storage would not say whether this
   *  call may record (the lease, or the true-up's state, could not be read).
   *  The debt stays owed either way, and the memo stays its retry trigger. */
  debit_deferred_reason?: TranscriptionDebitDeferred
}

/** Why a replay left an owed true-up for another call (see the receipt). */
export type TranscriptionDebitDeferred = 'lease_busy' | 'storage_unknown'

/** ⚖ THE RECEIPT ROW'S SEVERITY — ONE RULE for every door that files one (the
 *  meter's own row, transcribe.ts auditTranscriptionReceipt; the web route's
 *  JSON arm; the facade route's ctx.auditSeverity). 'warning' = a debit no call can show recorded and no
 *  live call is recording: a true-up the writer gave up on, a true-up this code
 *  cannot read, or one this call could not prove it may record
 *  ('storage_unknown'). A LEASE-BUSY replay is NOT a lost debit — the call
 *  holding the lease is the one that records it — so its row is filed at the
 *  default severity, still with `debit_recorded: false` and
 *  `debit_deferred_reason: 'lease_busy'` in its detail: soft, countable by that
 *  key, and never in the warning count ("is the wall firing?").
 *  The web route's multipart arm keeps its own inline `debit_recorded` check,
 *  untouched by ruling: it passes no audio key, so it never replays and never
 *  defers, and the two rules give the same answer there. */
export function transcriptionReceiptSeverity(receipt: TranscriptionReceipt): 'warning' | undefined {
  if (receipt.debit_recorded) return undefined
  return receipt.debit_deferred_reason === 'lease_busy' ? undefined : 'warning'
}
