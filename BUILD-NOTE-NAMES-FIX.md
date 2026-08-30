# BUILD NOTE — names fix (破棄の記録: real names, true counts, below-floor truth)

Packet: `~/Documents/Claude/karute-field-issues-2026-08-18/PACKET-2026-08-31-NAMES-FIX.md`
Repo/branch: `~/karute-discard`, `fix/discard-names`, base `511c2ae5` (origin/main).
Evidence folder: `docs/evidence/names-fix-2026-08-31/`

---

## What changed, per item

### B1 — the names join now speaks both id spaces

**`src/lib/synqed/staff-map.ts` (+34 / −2)**

- `StaffEntry` is now exported and carries `name` (the CARD's own name, from
  synqed-core `staff.name`). It already carried `id` (card) and `user_id`
  (the linked Supabase profile).
- New exported read-only helper `synqedStaffCardsForBusiness(businessId)` —
  returns the cached core-staff rows, `[]` + one `console.warn` on any
  failure. No self-heal, no create, no extra fetch; it is the same
  graceful-degrade contract `lookupProfileIdForSynqedStaffIdForBusiness`
  already documents, so a roster we cannot read costs a name and never the
  read.
- The `unstable_cache` key went `synqed-staff-list-v2` → `v3`. **Not in the
  packet** — see Deviations below.

**`src/actions/recording-discards.ts` → `listDiscardReasons` (part of +44 / −6)**

- The profiles roster fetch and the new card roster fetch run in one
  `Promise.all`; the profiles fetch keeps its existing `.catch` degrade
  verbatim.
- `profileNames` (profile id → full_name) is built as before, then copied into
  `nameById`, then every card adds a **card-id** key: the linked profile's
  `full_name` when `user_id` points at one, else the card's own `name`, else
  nothing (so a truly unknown id stays `null` → 担当者不明).
- The card loop reads from `profileNames`, never from the map it is writing,
  so the answer cannot depend on roster order.
- Per-staff counts group by `discarded_by` exactly as before; only the name
  lookup changed.

### B2 — the staffer's own count matches either of their ids

**`src/actions/recording-discards.ts` → `myDiscardCountThisMonth`**

- Resolves the viewer's card id via `lookupSynqedStaffIdForBusiness(staffId,
  businessId)` — the **NO-CREATE** lookup, per packet F-C. The `resolve*`
  twins (which mint a staff record on a miss) are not called anywhere in this
  diff.
- Wrapped in `.catch(→ null)` so a failed lookup degrades to today's
  login-uuid-only behaviour rather than nulling the whole count.
- A row counts when `discarded_by` equals the login uuid **or** the card id.
- `MAX_PAGES` truncation → `return null` is untouched.

### B3 — the below-floor stamp

**`src/lib/recording/discard.ts` (+40, one call site + one private helper)**

New private helper `stampRecordingDuration(synqed, data)`, called from
`discardRecordingWithClient` on the line immediately before
`return writeDiscardReceipt(actor, data, targetId)`:

```ts
await stampRecordingDuration(synqed, data)
```

```ts
async function stampRecordingDuration(synqed, data): Promise<void> {
  if (!data.recordingSessionId) return
  try {
    await synqed.recordings.update(data.recordingSessionId, {
      duration_seconds: Math.floor(data.durationSeconds),
    })
  } catch (err) {
    console.warn(JSON.stringify({ evt: 'discard_duration_stamp_failed', err: String(err) }))
  }
}
```

Nothing else in that file moved — not the reason-row write, not the receipt
shape, not the segments machinery, and `recordingJobs` is not referenced.

**B3's chosen home, and why.** `discardRecordingWithClient` is the one function
BOTH doors pass through with the parsed `data` in hand:

- web action → `discardRecordingWithReasonRow` → `discardRecordingWithClient`
- facade route **with** a reason → the same reason door → the same function
- facade route **without** one (SYSTEM arm) → `discardRecordingWithClient` directly

The three candidates the packet named were `discardRecordingWithClient:169`,
`discardRecordingWithReasonRow:221` and `writeDiscardReceipt:349`. I rejected
the other two:

- **`discardRecordingWithReasonRow`** covers only the reason door — the facade's
  receipt-only path never enters it, so a SYSTEM discard would leave the column
  null and the panel would keep printing the generic absence for it.
- **`writeDiscardReceipt`** is the ONE-write function whose own header says every
  success return must stay lexically dominated by the `auditDurable` emit (the
  proof suite's emission walker reads that shape directly). Threading an
  unrelated await through it buys nothing and risks that contract.

Placement **after** the idempotency probe is deliberate: a duplicate discard
already had its duration stamped by the first one, and re-stamping on every
retry would put avoidable writes on a path built to be silent. Pinned by
*"a duplicate discard does not re-stamp"*.

`Math.floor`, never `Math.round`: `duration_seconds` is an Int column and the
panel's predicate is `< BELOW_FLOOR_SEC`, so flooring preserves it exactly. A
**9.7s take stores `9`** — rounding would store `10` and claim a take was
transcribed that the ⚖ spend gate never sent. That is the same `[9.5, 10)`
artifact the receipt's own `duration_sec` comment documents, and it must not
reach the panel's source of truth. Pinned by the `it.each` table
(9.7→9, 9.99→9, 0.4→0, 12.4→12, 600→600).

### B3 fallout — the audit registries (not in the packet, required by CI)

`recordings.update` is an SDK **write**, and CP3
(`audit-sdk-write-sites.test.ts`) is deny-default: every SDK write site in
`src` must sit inside an `AUDITED_CORES` symbol span or carry its own
`SDK_WRITE_ALLOWLIST` entry. `src/lib/recording/discard.ts` is not in
`AUDITED_CORES` (it emits through `auditDurable`, not the `audit()`/`auditWeb()`
pair that registry is seeded from — the sibling `recordingDiscards.create`
entry exists for exactly the same mechanical reason). So:

- **`src/lib/audit-policy.ts` (+8)** — one `SDK_WRITE_ALLOWLIST` entry:
  `{ file: 'src/lib/recording/discard.ts', call: 'recordings.update',
  symbols: ['stampRecordingDuration'], dated: '2026-08-31' }`, justified as a
  derived field stamped inside the very call stack that emits the
  `recording.discard` receipt carrying `duration_sec` and `below_floor` for
  the same take.
- **`docs/audit-weakening-ledger.md` (+16)** — CP8 fails any allowlist
  ADDITION without an added ledger line naming the key, so one was appended.

Without both, `npx jest` and `npm run audit:weakening` fail. Called out here
because the packet did not anticipate them.

### B4 — tests

**`src/__tests__/integration/discard-reasons-read.test.ts` (+121)**
Added `@synqed-kk/client` and `@/lib/supabase/service` mocks (staff-map is now
in this action's import graph, and it constructs a real SDK client). The core
roster fake holds a linked card (`card-A` → profile `staff-A`), an unlinked
card (`card-C`), and a `listRejects` switch. New cases:

| assertion | red pre-fix? |
|---|---|
| a CARD-id row is named through the linked profile | ✅ red |
| an unlinked card is named from the card itself | ✅ red |
| an id in NEITHER space stays unnamed | guard (green both sides) |
| per-staff counts name card-id rows | ✅ red |
| a card roster that cannot be read costs names, never the read | guard |
| own count matches CARD-id rows, not only the login uuid | ✅ red |
| no card resolves → login-uuid behaviour, never an error | guard |

The card fixture deliberately names `card-A` 「原 カナエ」 while its linked
profile is 「原 奏恵」, so the assertion proves the **profile** name wins for a
linked card rather than passing by coincidence.

**`src/__tests__/integration/recording-discard-receipt.test.ts` (+74)**
`fakeClient` gained `recordings: { update }`. New cases: the floored `it.each`
table (5 rows), the facade door, the receipt-only/SYSTEM door, a rejected
stamp that still returns `ok:true` with the receipt written, a pre-mint
(takeId-only) discard that stamps nothing, and the duplicate case above.
All red pre-fix except the pre-mint guard.

**`src/__tests__/integration/discard-transcript-actions.test.ts` (+15)**
The F-E pin move: one action-layer case proving a **below-floor** duration
(`9`) arrives from `recordings.get` unchanged — mocked at the SDK seam, not the
action seam.

**i18n:** verified, not changed. `transcriptBelowFloor` exists in both
`messages/ja.json:2314` and `messages/en.json:2314`.

---

## Red runs

`docs/evidence/names-fix-2026-08-31/RED-RUN-2026-08-31-prefix.txt`

Captured by copying the three fixed source files aside, restoring the
`511c2ae5` versions of `recording-discards.ts` / `staff-map.ts` / `discard.ts`
in place (plain `cp` — **no stash**, per the packet), running the three test
files, then copying the fixed versions back:

```
Test Suites: 2 failed, 1 passed, 3 total
Tests:       13 failed, 129 passed, 142 total
```

All 13 failures are the new assertions, none of them collateral:

```
● the take’s duration is stamped on the recording › 9.7s of audio is stamped as 9 — FLOORED, never rounded
● the take’s duration is stamped on the recording › 9.99s of audio is stamped as 9 — FLOORED, never rounded
● the take’s duration is stamped on the recording › 0.4s of audio is stamped as 0 — FLOORED, never rounded
● the take’s duration is stamped on the recording › 12.4s of audio is stamped as 12 — FLOORED, never rounded
● the take’s duration is stamped on the recording › 600s of audio is stamped as 600 — FLOORED, never rounded
● the take’s duration is stamped on the recording › the FACADE door stamps it too — one behaviour, both doors
● the take’s duration is stamped on the recording › the receipt-only door stamps it as well — a SYSTEM discard is still a take
● the take’s duration is stamped on the recording › a stamp that FAILS never fails the discard — the take is already gone
● the take’s duration is stamped on the recording › a duplicate discard does not re-stamp — the first one already did
● the two id spaces the ledger and the roster live in › a row stamped with the staff CARD id is named through the linked profile
● the two id spaces the ledger and the roster live in › a card that links to NO profile is still named, from the card itself
● the two id spaces the ledger and the roster live in › the per-staff counts name card-id rows too
● the staffer’s own count (the staff half of ruling B) › counts the rows stamped with their CARD id, not only their login uuid
```

Green run on the same three files, same session:
`docs/evidence/names-fix-2026-08-31/GREEN-RUN-2026-08-31-fixed.txt`

```
Test Suites: 3 passed, 3 total
Tests:       142 passed, 142 total
```

**Mutation proof** (the one new assertion that is green both sides):
`docs/evidence/names-fix-2026-08-31/MUTATION-2026-08-31-durationSeconds.txt`
`durationSeconds: recording?.duration_seconds ?? null` → `durationSeconds: null`
turns the pin-move case red; reverted immediately.

```
mutated  1003b291d28fe323adbb7757c150c104ce63e32da0bc3dd1fe6410142b953db2  src/actions/recording-discards.ts
         Tests: 2 failed, 30 passed, 32 total
restored 8f7df89cc3180e5eac2b95417e91c45e6aca37c7f188125493a4f5cc447e02ac  src/actions/recording-discards.ts
```

The restored hash equals the pre-mutation hash, so the mutation left nothing
behind.

---

## Gates (pasted, from the worktree root)

**`npx tsc --noEmit`** — exit 0, zero output:

```
$ npx tsc --noEmit ; echo "exit=$?"
exit=0
```

Note: the packet's baseline said "2 known `.next` validator errors". This
worktree produced **zero** — `.next/` holds no build output here, so the
generated validators were never type-checked. 0 src errors either way.

**`npx eslint <every touched file> --max-warnings=0`** — exit 0, zero output:

```
$ npx eslint src/actions/recording-discards.ts src/lib/synqed/staff-map.ts \
    src/lib/recording/discard.ts src/lib/audit-policy.ts \
    src/__tests__/integration/discard-reasons-read.test.ts \
    src/__tests__/integration/recording-discard-receipt.test.ts \
    src/__tests__/integration/discard-transcript-actions.test.ts --max-warnings=0 ; echo "exit=$?"
exit=0
```

**`TZ=UTC npx jest`** (full suite) — exit 0:

```
Test Suites: 502 passed, 502 total
Tests:       1 skipped, 7357 passed, 7358 total
Snapshots:   0 total
Time:        24.061 s
Ran all test suites.
```

(tail also saved at `docs/evidence/names-fix-2026-08-31/GATE-jest-full-tail.txt`)

**`npm run audit:weakening`** (CP8 — run because this PR adds an allowlist
entry; not in the packet's gate list):

```
[check-audit-weakening] HEAD === main (push-to-main run) — nothing to diff against itself. EXIT=0
```

It self-skipped because at that moment `HEAD == origin/main`. Re-run after the
commit exists — see the "post-commit" line at the bottom of this note.

**Diff size:** 352 insertions / 8 deletions across 8 files — 126 of them
product code (`recording-discards.ts` +44/−6, `discard.ts` +40,
`staff-map.ts` +34/−2, `audit-policy.ts` +8), 210 tests, 16 ledger. Over the
packet's 50–200 line target if you count everything; the source half sits
inside it.

---

## Surprises + deviations

**D-1 (deviation) — `unstable_cache` key bumped to `synqed-staff-list-v3`.**
Not in the packet. Adding `name` to `StaffEntry` changes the cached shape, and
a live `v2` entry would keep serving `name`-less rows for up to the 24h TTL —
so every unlinked card would silently read 担当者不明 for a day after deploy on
a fix whose whole point is that it does not. The bump costs one cold roster
fetch per tenant.

**D-2 (deviation) — B3's core write is `await`ed, not fire-and-forget.**
The packet says the stamp must "never fail **or delay** the discard result".
It cannot fail it (every failure — a rejection *and* a client with no
`recordings` resource — is one warn line and the discard continues), but it
does add one core round-trip to a path that already makes three. The house
alternative is `audit()`'s `after()` idiom (start now, hand to Next's
`after()`, fall back to `void`). I did not use it here:

1. `void`-ing a promise that can reject is an unhandled rejection —
   `audit.ts`'s own comment leans on `forwardToCore` never rejecting, which is
   not true of a raw SDK call, so it would need a `.catch` *plus* an outer
   `try` for the synchronous `undefined.update` case. Two guards to save a
   round-trip on a screen no one is watching.
2. Several existing fakes hand this module a client with **no** `recordings`
   property at all (the thin-port and receipt tests), so the synchronous throw
   is a real shape, not a hypothetical.
3. `await` makes the tests deterministic instead of microtask-ordered.

Say the word and it becomes the `after()` form; the behaviour under test does
not change either way.

**D-3 (unavoidable addition) — `src/lib/audit-policy.ts` +
`docs/audit-weakening-ledger.md`.** Detailed under B3 fallout. The packet's
"minimal diff, touch nothing else" constraint named `discard.ts` and I held to
it there; these two are separate files the CI gates require.

**S-1 (surprise, worth Fable's eyes) — B2's "read-only" lookup can write.**
`lookupSynqedStaffIdForBusiness` is the NO-CREATE lookup the packet names, and
it never creates — but on an **email-only** match it still fires a best-effort
`client.staff.update(id, { user_id })` self-heal. So `myDiscardCountThisMonth`
— a gate-free self-knowledge read any practitioner triggers — can now cause
one idempotent staff-record patch the first time an unlinked card matches
their profile email. It is already the sanctioned helper (`deleteStaff` uses
it for the same reason), it is capped at once per staffer, and it is wrapped in
its own try/catch, so I did not fork it. Flagging rather than deciding.

**S-2 (surprise) — the packet's F-E premise is half true.** The
component test does mock `getDiscardTranscript` wholesale, but the **action**
layer was already covered at the SDK seam: `discard-transcript-actions.test.ts`
had a `duration_seconds: 62` → `durationSeconds: 62` case before this PR. That
is why the new pin-move case cannot go red against pre-fix code and carries a
mutation proof instead. What #798 mocked past was the component, not this
action.

**S-3 (surprise) — the tsc baseline did not reproduce.** Zero errors, not the
expected 2 `.next` validator ones. See the gate block above.

**S-4 (note) — no client-component change.** Nothing under
`src/components/**` or `thin/**` was touched; `DiscardReasonsSection.tsx`
already branches on `durationSeconds`. The thin bundle should not have moved
(re-measure at gate time regardless).

---

## Post-commit

`npm run audit:weakening` self-skips while `HEAD == origin/main`, so it was
re-run once the commit existed — that is when CP8 actually diffs the registry
against main and reads the ledger line:

```
[check-audit-weakening] owner-approval check skipped (not a CI run) — the PR CI run is the enforcement point.
[check-audit-weakening] 1 weakening(s), all ledgered (1:1, append-only). EXIT=0
```

One weakening (the `recordings.update` allowlist entry), matched 1:1 by the
appended ledger line. The owner-approval half only fires in CI, on the PR.

---

## Correction — 2026-08-31, fix round 1

Written after the blind round on `4b2bd125`
(`ADJUDICATION-NAMES-FIX-ROUND1.md`). Everything above stands as the record of
what `4b2bd125` did; these two lines correct it.

**D-2's point 2 was FALSE as written (L4-G5).** It claimed "several existing
fakes hand this module a client with **no** `recordings` property at all (the
thin-port and receipt tests), so the synchronous throw is a real shape". Neither
citation supports it: `thin-recording-discard-port.test.ts` never constructs a
synqed client at all, and `recording-discard-receipt.test.ts`'s `fakeClient` was
**given** `recordings: { update: recordingUpdate }` by that same commit. So no
test in this repo hands `discard.ts` a `recordings`-less client, and the claim
should not have been made.

The CODE claim it was defending is nonetheless true by construction — the
`synqed.recordings.update` property access sits inside `stampRecordingDuration`'s
`try`, so a client without the resource throws synchronously into that catch and
the discard continues. The blind round verified that property directly.

**The `await`-over-`after()` decision stands**, on D-2's point 1 (the
serverless-freeze / unhandled-rejection rationale: `void`-ing a rejectable
promise needs a `.catch` *plus* an outer `try`, to save one round-trip on a
screen nobody is watching) and point 3 (deterministic tests). Only the false
citation is withdrawn.

**FIX-3 reordered the stamp.** As of the fix-round commit,
`stampRecordingDuration` runs only once the awaited durable receipt has actually
landed — so the stamp is now the *fifth* awaited core round-trip on the path
rather than the fourth, and a receipt-failed discard stamps nothing at all. The
function comment, the `SDK_WRITE_ALLOWLIST` justification and the ledger entry
were amended to that exact guarantee. Latency cost accepted per the
adjudication; no timeout machinery.

Its HOME moved one frame in, and the proof suite is why. The obvious caller-side
shape —

```ts
const result = await writeDiscardReceipt(actor, data, targetId)
if (result.ok) await stampRecordingDuration(synqed, data)
return result
```

— fails `audit-coveredby.test.ts`: `return result` is a bare identifier, so the
emission walker can no longer see `discardRecordingWithClient`'s success return
as lexically dominated by the emit (it had been reading the
`return writeDiscardReceipt(...)` call-through). That invariant is not
negotiable, so the stamp lives **inside** `writeDiscardReceipt`, immediately
past its `if (!receipt.ok)` guard, and `discardRecordingWithClient` keeps its
call-through return unchanged (`writeDiscardReceipt` gained a `synqed`
parameter). Same guarantee, stated where "the receipt landed" is a fact instead
of a hope — and the walker's own header comment on that function now says so.
