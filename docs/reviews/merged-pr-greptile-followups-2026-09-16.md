# Merged PR Greptile follow-ups — 2026-09-16

This follow-up retains the unresolved Greptile comments from merged PRs so each fix is reviewable.

- Karute #901, P1: **“Discarded rows remain actionable.”** When an active row becomes discarded, active and discarded counts trade one-for-one, so the universe total stays unchanged and older cached rows were not refreshed. [Original comment](https://github.com/Synqed-kk/karute/pull/901#discussion_r3996801691). Refresh the first window when the universe is unchanged but its active/discarded composition changes.
- Karute #905, P2: **“Particles Can Change Meaning.”** The hook-body character-bag comparison stripped Japanese particles and conflated `友人の紹介` with `友人を紹介`. [Original comment](https://github.com/Synqed-kk/karute/pull/905#discussion_r3997227845). Suppress only provable normalized exact echoes and preserve non-exact context.

Both repairs require focused regressions, the full local suite, parallel Standards/Spec review, green CI and Greptile 5/5 before merge.
