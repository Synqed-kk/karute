# P4 — Kitano 顧客管理 sheet import (executed 2026-06-11, scope C, Liam-approved)

One-time import of the hand-maintained Google Sheet (312 customers) into the
pack/lifecycle ledger. Re-runnable for future branches (Ginza): all steps are
idempotent (existing customers/packs/lifecycles are skipped).

1. `node --env-file=.env scripts/import/dump-customers.mjs`
   → dumps the live customer list (auto-selects the real tenant = most customers)
2. `python3 scripts/import/dryrun.py`
   → READ-ONLY matcher: exact normalized-name only, 1:1 enforced, ambiguity
     reported never guessed; emits /tmp/import-plan.json + human report.
     STOP HERE and get the owner's sign-off on the report.
3. `node --env-file=.env scripts/import/execute.mjs`
   → writes packs (source='import'), synthesized redemptions (dated from the
     sheet's per-visit columns), customer_lifecycle (卒業/離客/口コミ),
     creates sheet-only customers.

Result (2026-06-11): 176 customers created, 309 packs (289 counted + 20 サブスク),
1,108 redemptions, 140 lifecycle rows. Verification: 289/289 packs derive the
sheet's exact 残回数; zero errors, zero ambiguous matches.
