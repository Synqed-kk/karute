# Spec: session-outcome capture (the coaching training-data moat)

**Status:** designed, ready to build. **Owner:** Karute (UI + bridge) + Anthony (durable synqed home).

## Why this exists (the moat)
Every recorded session must be **labeled** with its result — 成約 (converted) / 不成約 (no-deal) + reason / 後で決める (provisional). That label is what turns recordings into **training data** for the coaching AI: *"which conversation patterns convert, and why do we lose the rest."* A competitor who only records + transcribes has **unlabeled** data and cannot train a coaching model. Accumulated outcome + reason labels are the asset nobody can copy. Capturing it from day one — before coaching exists — is the point.

## The architecture decision (bulletproof + scalable)
**Source of truth = synqed-core. The outcome lives ON the karute record** (it *is* the session's result; a side table would split the record from its outcome and drift at scale — violating single-source-of-truth).

Everything in the app goes through **one domain action**: `setKaruteOutcome(karuteRecordId, outcome, reason?)`. The UI depends on that **contract**, never on the storage. So the backing can move without touching a line of UI:

- **Phase 1 (now, to test):** the action writes to a **transitional** Supabase table `karute_outcomes` + a Vercel cron does the 14-day auto-decide. Labeled data accumulates from today.
- **Phase 2 (durable):** Anthony adds the fields to synqed-core's KaruteRecord; the action switches to write there; a one-time backfill moves the bridge rows over; the bridge table is dropped. **No UI/contract change.**

The bridge is explicitly transitional (a migration step), not a permanent fallback layer.

## Data model
```ts
type Outcome = 'success' | 'no_deal' | 'pending'         // 成約 / 不成約 / 後で決める
type DeclineReason =
  | 'budget' | 'considering' | 'mismatch' | 'follow_up' | 'other'  // 予算/検討中/店舗ミスマッチ/後日連絡予定/その他

interface KaruteOutcome {
  karute_record_id: string   // FK → the session (synqed karute record id)
  customer_id: string        // tenant / RLS
  outcome: Outcome
  reason: DeclineReason | null   // only when outcome = 'no_deal'
  is_first_visit: boolean
  decided_by: string | null      // staff profile id (null if auto)
  decided_at: string | null      // ISO; null while pending
  auto_decided: boolean          // true if the 14-day cron flipped pending→no_deal
}
```

## Lifecycle
```
record stops → staff saves → PostSessionResolution dialog:
  成約        → outcome=success                       → active karute (visible in list)
  不成約 +理由 → outcome=no_deal, reason               → kept as training data, HIDDEN from customer list
  後で決める   → outcome=pending                        → 仮カルテ
pending, 14 days, undecided  → cron: outcome=no_deal, auto_decided=true, decided_at=now()
```
- **no_deal** karutes are excluded from the customer list + counts by default, but the session (transcript, AI patterns) is retained for coaching.
- **first-visit** title differs: `初回セッションの結果 — <name>様` vs `結果 — <name>様`.
- Disclaimer (verbatim from spike): 「ご記録いただいた成約・不成約は、AIがトップパフォーマーの会話パターンを学習するためにも活用されます。お客様の個別情報は他のスタッフには共有されません。」

## Phase 1 build (Karute, ships now)
1. **Migration** `supabase/migrations/<ts>_karute_outcomes.sql`: the table above + RLS (customer_id tenant match; staff update own, owners/SV any).
2. **Contract** `src/lib/karute/outcome.ts`: the types + `setKaruteOutcome()` server action (writes the table) + `getKaruteOutcome()`.
3. **UI** `PostSessionResolutionDialog` (matches the spike) wired into the save flow after recording stops.
4. **Status chip** `ConversionStatusChip`: 仮カルテ (amber) / 不成約 (red) / 成約 (green) on karute list + detail.
5. **List filter**: hide `no_deal` from the customer list by default.
6. **Cron** `/api/cron/auto-decide-outcomes` (add to `vercel.json` crons): the 14-day flip.
7. i18n (ja↔en).

## Phase 2 (Anthony — the durable home)
Add to synqed-core `KaruteRecord`: `conversion_status (PENDING|SUCCESS|NO_DEAL)`, `decline_reason`, `decided_by`, `decided_at`, `auto_decided`; accept them in `UpdateKaruteRecordInput`; bump `@synqed-kk/client`. Move the 14-day cron into synqed-core (or keep it karute-side hitting the new fields). Karute then: switch `setKaruteOutcome` to `synqed.karuteRecords.update`, backfill from `karute_outcomes`, drop the table.

## Coaching note (future-proofing the moat)
The coaching aggregation reads outcomes at the **business** scope (all stores pool; never cross-business — matches the multi-store coaching boundary). Individual customer identity stays private to the staffer; coaches see aggregate patterns. The labeled outcome stream is the input to top-performer pattern extraction.
