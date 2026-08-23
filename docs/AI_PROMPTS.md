# AI prompt registry — karute

This is the karute-side mirror of the design-spike's authoritative `AI_PROMPTS.md`. The spike doc lives at `/Users/liam/Documents/synqed-karute-design-spike/AI_PROMPTS.md` and is the source of truth for prompt specifications. This file is the karute-side index — pointing each scaffold's `AI_PROMPTS.md §N` reference at the right section in the spike doc, plus tracking which sections have already been ported into `src/lib/prompts.ts`.

> **Status legend**
>
> - ✅ — prompt is live in karute (`src/lib/prompts.ts` or inline in a route)
> - 🟡 — scaffold exists in karute; prompt not yet ported (uses placeholder copy or no prompt path)
> - ❌ — no scaffold yet, no prompt
> - 📦 — Anthony's lane (server-side generator job)

## Section index

| § | Surface | Status | Karute hook / file |
|---|---|---|---|
| §1 | Condition prediction (karute detail) | ✅ | `src/lib/karute/ai-body-prediction.ts` |
| §2 | Outreach draft (post-session) | ✅ | `src/lib/karute/ai-outreach.ts` |
| §3 | Session summary | ✅ | `src/lib/prompts.ts:getSummarySystemPrompt`, `src/app/api/ai/summarize/route.ts` |
| §4 | Entry categorization (real-time, low-latency) | ✅ (batch variant) | `src/lib/prompts.ts:getExtractionSystemPrompt`, `src/app/api/ai/extract/route.ts` — currently post-session; spike spec is per-keystroke debounced |
| §5 | Dashboard recommendations | ❌ (route retired 2026-07-27, PR #629) | superseded by the daily attention lines (`src/lib/dashboard/daily-attention-ai.ts`); old `/api/ai/insights` implementation restorable from git `f4f85eee` |
| §6 | Customer signal classification (rule-based) | ❌ | — |
| §7 | Next visit prediction | ❌ | `src/components/customers/redesign/list/AiStatusChipRow.tsx` (chip only) |
| §8 | Booking flags (rule-based) | ❌ | — |
| §9 | Business Q&A (RAG) | ✅ (non-RAG) | `src/app/api/ai/chat/route.ts` — uses raw context, no pgvector |
| §10 | Recording → karute pipeline | ✅ (partial) | `src/lib/ai-pipeline.ts` — transcribe + extract + summarize; missing prediction/outreach/memory |
| §11 | Customer memory extractor (async batch) | 🟡 | `src/components/karute/spike-lifted/memory/CustomerMemoryCard.tsx` |
| §12 | Speaker diarization (Deepgram, not Claude) | ✅ | `src/lib/deepgram.ts` |
| §13 | Re-engagement draft | ✅ | `src/lib/karute/ai-reengagement.ts` |
| §14 | Top-performer pattern extraction (weekly batch) | 📦 + scaffold | `src/components/coaching/redesign/PatternLibrary.tsx` |
| §15 | Learning module generation (weekly + on-demand) | 📦 + scaffold | `src/components/coaching/redesign/AssignModulesCard.tsx`, `LearningModulesView.tsx` |
| §16 | Per-staff focus area generation (monthly) | 📦 + scaffold | `src/components/coaching/redesign/GapAnalysisList.tsx`, `NextFocusCard.tsx` |
| §17 | Personal coaching insight (post-session) | 📦 + scaffold | `src/components/coaching/redesign/RecentInsightsList.tsx`, `KaruteCoachingPanel.tsx` |

## Provider notes

The spike's authoritative spec assumes Anthropic (`claude-sonnet-4-6` + `claude-haiku-4-5`). Karute is currently running OpenAI (`gpt-4o-mini`). Anthony picks one of three paths before §14-§17 ship to prod:

1. **Stay OpenAI** — update spike docs to match karute reality
2. **Switch to Anthropic** — rewrite the 7 live `/api/ai/*` routes
3. **Dual-provider adapter** — `callLLM({ provider, model, messages })` abstracts both

Strategic vote (head-engineer audit, 2026-05): #3 for $800M scale; future enterprise customers will demand provider flexibility.

## Cross-references in karute code

Each scaffold that references `AI_PROMPTS.md §N` resolves via the table above. The actual prompt text lives in the spike doc (or in `src/lib/prompts.ts` when ported). Anthony's wiring step is:

1. Read spike `AI_PROMPTS.md §N`
2. Port (or rewrite for OpenAI/dual) into `src/lib/prompts.ts`
3. Wire the route or scheduled job
4. Update the table here to ✅

## See also

- Spike: `/Users/liam/Documents/synqed-karute-design-spike/AI_PROMPTS.md` (authoritative)
- Spike: `/Users/liam/Documents/synqed-karute-design-spike/docs/AI_LEARNING_LOOP.md` (Rung 1-4)
- Spike: `/Users/liam/Documents/synqed-karute-design-spike/docs/AI_INTEGRATION_SPEC.md`
- Spike: `/Users/liam/Documents/synqed-karute-design-spike/docs/BUSINESS_TYPE_AI_ADAPTATION.md`
- Karute: `MERGE_NOTES_FOR_ANTHONY.md`
