# AI prompt defect log

Raw material for the golden-transcript harness (versatility plan Phase 2 PR6):
every observed extraction/summary defect gets an entry with the record it came
from, so the golden set's assertions encode REAL failure modes. Per the plan,
base-prompt edits are FORBIDDEN until the salon golden set exists — log here
instead of tweaking.

| # | Date | Record | Defect | Classification | Golden assertion to write |
|---|------|--------|--------|----------------|---------------------------|
| 1 | 2026-06-09 | ぴあそん #00007 | Elbow pain extracted into BOTH symptom and body_area → displayed as duplicate rows | Root cause split: (a) UI label bug — body_area group was labeled 状態, fixed 2026-06-11 (now 部位); (b) prompt enum ships no category definitions (prompts.ts:66) — deferred to first post-harness prompt PR | One complaint maps to ONE primary category; body_area entries name the location, symptom entries the sensation |
| 2 | 2026-06-09 | ぴあそん #00007 | AI要約 line 「数ヶ月ぶりの筋トレで筋肉痛が発生し、施術の相性が悪い」 — 「相性が悪い」 reads as an invented evaluative claim | RESOLVED 2026-06-11: FAITHFUL — transcript contains 「施術と筋肉痛の相性は悪いかもです…マッキーは筋肉痛の中施術するのが、まじで相性悪かった」. Prompt exonerated. BUT the source utterance is a SIDE CONVERSATION about a third person (マッキー) — this is a DIARIZATION leak (bystander speech summarized as session content), not a prompt defect. Transferred to the diarization workstream | Summary lines may not contain causal/evaluative claims absent from the transcript |
