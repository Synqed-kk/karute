<!-- Audit-weakening ledger (contract §8 CP8). Every entry here is a DELIBERATE
     weakening of the audit taxonomy — a map/decision row moved off 'live', an
     AUDIT_ACTIONS member or AUDITED_CORES entry/symbol removed, or a new
     allowlist entry (a newly-legalized silent write) — that a human reviewed
     and approved. scripts/audit/check-audit-weakening.mjs (CP8) fails any PR
     that weakens the taxonomy vs origin/main WITHOUT an added line here naming
     the affected key; it never blocks a strengthening (skip/pendingWave→live,
     allowlist removal, new actions).

     Format: - YYYY-MM-DD · <key> · <why> · <who ruled>
     Keys are namespaced by source — copy them EXACTLY as the gate prints
     them (map:… / decision:… / action:… / cores:… / <ALLOWLIST>:…). Keep
     the key and the '·' after it on the entry's FIRST line (the gate's
     exact-key match reads line one); wrap the why/who freely after. -->

- 2026-07-29 · map:karute.ai.suggestedMessage · action changed
  'ai.suggested_message' → 'ai.suggested_message_view': the hook row fires on
  every 2xx of the draft GET — a cache-served read on all but the first open —
  so labeling it 生成 wrote "generated" rows where no LLM ran (field report:
  ~15 rows/evening from reopens, 変更 86→93 in hours). The 生成 action is NOT
  retired: it moved to the actual generation site (ai-outreach.ts private
  helpers, AUDITED_CORES-registered, emitted only when OpenAI returns a
  draft), so the taxonomy is strictly more truthful — every 生成 row now
  means a real generation · Liam (2026-07-29 ruling: A of A–D, "unless
  something changed it shouldn't regenerate — and the log should say what
  actually happened")
- 2026-07-29 · map:karute.ai.suggestedMessage · kind changed 'mutation' →
  'view': same change, same ruling — the per-open row is a read of a cached
  draft, so it belongs behind 閲覧を含む with the sibling AI-card rows
  (customer.ai_prediction_view / customer.brief_view) instead of flooding the
  default feed and inflating 変更. Paired with the strengthening above (real
  生成 emit + detail.customer_id on both rows) · Liam (2026-07-29 ruling)
- 2026-07-27 · facade-audit-totality.test.ts CP8-forerunner pin · the hardcoded
  live-row disposition snapshot (describe 'CP8 forerunner — hardcoded live-row
  disposition pin') is deleted by the proof-suite PR. It WORKED (hardcoded
  precisely so it could NOT move in lockstep with the map — built after a
  full-suite mutant proved the parameterized pins did) but covered only live
  facade rows; check-audit-weakening.mjs supersedes it with a vs-main diff
  that also tracks categories, decision rows, allowlists, registries, and the
  ledger itself · Liam (proof-suite PR kickoff)
