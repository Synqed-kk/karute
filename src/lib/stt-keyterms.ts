/**
 * Domain vocabulary for Deepgram Keyterm Prompting (nova-3, pre-recorded,
 * multilingual incl. ja) — boosts recognition of the words a salon session
 * actually contains, the direct counter to fragmented domain terms in noisy
 * far-field recordings (BGM, phone on desk).
 *
 * Deepgram contract (developers.deepgram.com/docs/keyterm): repeatable
 * `keyterm` query param, one term per param, HARD CAP 500 tokens across all
 * terms per request, sweet spot 20–50 terms. Keep these lists SHORT and
 * high-value — every term added dilutes the boost of the others.
 *
 * ja-only today: EN sessions are rare and these terms are Japanese. The
 * bodywork list is validated against real production sessions (2026-07-14,
 * plus two 2026-06 eval sessions whose transcripts showed each added term
 * misrecognized in the wild); other verticals get the generic salon/clinic
 * base until someone validates a list for them — an unvalidated guess can
 * boost the WRONG homophone.
 */

/** Every business type: the vocabulary of running a Karute session at all. */
const BASE_JA = [
  'カルテ',
  '施術',
  '予約',
  '回数券',
  'セルフケア',
  '既往歴',
  '問診',
  '次回',
  'お客様',
]

/** Bodywork family (beauty_chiropractic / massage / chiropractic) — mirrors
 *  BODYWORK_FAMILY in src/lib/prompts.ts (kept as a literal here: this module
 *  is STT-layer, importing the prompt layer would tangle the two). */
const BODYWORK_TYPES = new Set(['beauty_chiropractic', 'massage', 'chiropractic'])

const BODYWORK_JA = [
  '整体',
  'ストレッチ',
  'もみ返し',
  '可動域',
  '肩甲骨',
  '鎖骨',
  '骨盤',
  '腰部',
  '巻き肩',
  '猫背',
  '反り腰',
  '外旋',
  '筋膜',
  'ハムストリング',
  '筋肉痛',
  'ぎっくり腰',
  'ヘルニア',
  '坐骨神経痛',
  'MRI',
  'レントゲン',
  // Observed misrecognized in the 2026-06 eval transcripts (garble → term):
  '筋繊維', // 金銭医・金銭破壊
  '筋力', // 金運力
  '筋トレ', // 胃の筋トレ
  '負荷', // 服
  '挫傷', // 座礁
  '腕橈骨筋', // 腕頭骨筋
  '胸鎖乳突筋', // 胸背、乳突筋
  'ストレートネック',
  'クールダウン', // クールムーブ
  'ふくらはぎ', // 心ふくらはぎ
  'TFCC', // survived once but its sentence collapsed around it
]

/** Keyterms for a transcription request. Empty for non-ja (nothing validated). */
export function sttKeyterms(
  businessType: string | null | undefined,
  language: 'ja' | 'en',
): string[] {
  if (language !== 'ja') return []
  return BODYWORK_TYPES.has(businessType ?? '')
    ? [...BASE_JA, ...BODYWORK_JA]
    : BASE_JA
}
