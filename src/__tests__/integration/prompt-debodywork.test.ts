/**
 * De-bodywork guard (v3.3) — the shared prompt core is business-neutral and
 * every type's prompt speaks its own vocabulary.
 *
 * Three invariants:
 *  1. The bodywork family keeps its full richness (もみ返し/可動域/セルフケア指導
 *     now travel via its categoryNotes tokens, not the shared core).
 *  2. A non-bodywork business's prompt carries NONE of the bodywork vocabulary
 *     and DOES carry its own role + service-noun title prefix.
 *  3. The UI's treatment-prefix strip list covers every serviceNoun the
 *     extraction prompt can mandate (kept literal to stay out of the client
 *     bundle — this test is the sync guard).
 */
import { getExtractionSystemPrompt, getSummarySystemPrompt } from '@/lib/prompts'
import {
  ALL_SERVICE_NOUNS_JA,
  getBusinessAiPersona,
  resolvePersonaTokens,
} from '@/lib/karute/business-ai-tokens'
import { TREATMENT_KIND_PREFIXES } from '@/components/karute/redesign/detail/treatment-prefixes'

const BODYWORK = ['beauty_chiropractic', 'massage', 'chiropractic'] as const
const NON_BODYWORK = [
  'esthetic_salon',
  'hair_salon',
  'nail_salon',
  'eyelash_salon',
  'acupuncture',
  'osteopathy',
  'yoga_studio',
  'pilates_studio',
  'personal_gym',
  'dental_clinic',
  'medical_clinic',
  'dermatology',
  'cosmetic_surgery',
  'physical_therapy',
  'foot_care',
  'relaxation',
  'aroma',
  'wellness_clinic',
  'mental_health',
  'veterinary',
  'pet_grooming',
  'training_school',
  'other',
] as const

// Bodywork-only vocabulary that must never reach another vertical's prompt.
// (施術者 is allowed only in the bodywork family's own v3.2 dialect and as the
// literal diarization speaker label the audio pipeline emits.)
const BODYWORK_MARKERS = ['もみ返し', '可動域', '体内の金属', 'セルフケア指導']

// The UltraCode-built v3.2 wording the bodywork family must keep VERBATIM —
// reaction nuances, 部位, and the original teaching examples included.
// (fidelity harness proved the full render byte-identical on 2026-07-09.)
const V32_FIDELITY_CLAUSES = [
  '楽になった・痛かった・強く効いた',
  '何をどの部位に行ったか',
  '「右手首：可動制限はあるが本日痛みなし」',
  '「肩の問題」「ストレッチの話」',
  '「かなり緊張が強い」「ここまで可動域を出したい」',
  '既往歴・手術歴・服薬・アレルギー',
  '「施術：」「セルフケア指導：」',
  '施術者の発言でも',
]

describe('prompt de-bodywork (v3.3)', () => {
  it('bodywork family keeps the original v3.2 prompt verbatim', () => {
    for (const t of BODYWORK) {
      const p = getExtractionSystemPrompt('ja', t)
      // 体内の金属 lives only in beauty-chiro's own checklist, not the shared
      // v3.2 block — require only the family-wide markers here.
      for (const marker of ['もみ返し', '可動域', 'セルフケア指導']) {
        expect(`${t}: ${p}`).toContain(marker)
      }
      for (const clause of V32_FIDELITY_CLAUSES) {
        expect(`${t}: ${p}`).toContain(clause)
      }
      expect(p).toContain('「施術：」')
    }
  })

  it('non-bodywork types get a clean prompt in their own vocabulary', () => {
    for (const t of NON_BODYWORK) {
      const persona = getBusinessAiPersona(t)
      const tok = resolvePersonaTokens(persona, 'ja')
      // A marker is LEGITIMATE when the type's own authored tokens carry it
      // (整骨院 genuinely talks 可動域). The invariant is that no bodywork word
      // reaches a prompt from the SHARED core — i.e. never appears unless the
      // type's own data contains it.
      const ownVocabulary = JSON.stringify(persona)
      const extraction = getExtractionSystemPrompt('ja', t)
      const summary = getSummarySystemPrompt('ja', t)
      for (const marker of BODYWORK_MARKERS) {
        if (ownVocabulary.includes(marker)) continue
        expect(`${t}: ${extraction}`).not.toContain(marker)
        expect(`${t}: ${summary}`).not.toContain(marker)
      }
      // Speaks its own vocabulary: the type's role + its service-noun prefix.
      expect(extraction).toContain(tok.role)
      expect(extraction).toContain(`「${tok.serviceNoun}：」`)
      expect(summary).toContain(tok.role)
    }
  })

  it('the shared core no longer injects 施術者 as prose', () => {
    // The bodywork family intentionally KEEPS 施術者 — it renders Liam's
    // original v3.2 dialect verbatim. This invariant is for everyone else.
    for (const t of NON_BODYWORK) {
      const persona = getBusinessAiPersona(t)
      const tok = resolvePersonaTokens(persona, 'ja')
      // Only meaningful for types whose role isn't 施術者 AND whose own tokens
      // don't use the word — anything left must come from the shared core.
      if (tok.role === '施術者') continue
      if (JSON.stringify(persona).includes('施術者')) continue
      expect(`${t}: ${getSummarySystemPrompt('ja', t)}`).not.toContain('施術者')
    }
  })

  it('UI treatment-prefix strip list covers every serviceNoun', () => {
    for (const noun of ALL_SERVICE_NOUNS_JA) {
      expect(TREATMENT_KIND_PREFIXES).toContain(noun)
    }
  })
})
