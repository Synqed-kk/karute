<!-- Audit-weakening ledger (contract §8 CP8). Every entry here is a DELIBERATE
     weakening of the audit taxonomy — a map/decision row moved off 'live', an
     AUDIT_ACTIONS member or AUDITED_CORES entry/symbol removed, or a new
     allowlist entry (a newly-legalized silent write) — that a human reviewed
     and approved. scripts/audit/check-audit-weakening.mjs (CP8) fails any PR
     that weakens the taxonomy vs origin/main WITHOUT an added line here naming
     the affected key; it never blocks a strengthening (skip/pendingWave→live,
     allowlist removal, new actions).

     Format: - YYYY-MM-DD · <key> · <why> · <who ruled> -->

- 2026-07-27 · facade-audit-totality.test.ts CP8-forerunner pin · the hardcoded
  live-row disposition snapshot (describe 'CP8 forerunner — hardcoded live-row
  disposition pin') is deleted by the proof-suite PR — it moved in lockstep
  with FACADE_AUDIT_MAP and could never actually catch a reclassification;
  this script diffs against origin/main directly instead, so no snapshot can
  drift with the map it's supposed to guard · Liam (proof-suite PR kickoff)
