// 役職 (job-title) options per business type. The list shown in the staff
// form's 役職 picker adapts to the salon's business_type (org-settings) — a
// 美容整体 shows 整体師/セラピスト, a hair salon shows スタイリスト/アシスタント.
// These are display-only labels (profiles.position); they have NO bearing on
// authority — that's the RBAC role. 「その他」 + the custom free-text input keep
// any title reachable.

const DEFAULT_TITLES = ['店長', '施術者', 'スタッフ', '受付', 'その他']

const BUSINESS_TYPE_TITLES: Record<string, string[]> = {
  beauty_chiropractic: ['整体師', 'セラピスト', '施術者', '店長', 'SV', '受付', 'スタッフ', 'その他'],
  chiropractic: ['整体師', '施術者', '院長', '受付', 'スタッフ', 'その他'],
  osteopathy: ['整体師', '施術者', '院長', '受付', 'スタッフ', 'その他'],
  hair_salon: ['スタイリスト', 'アシスタント', '店長', '受付', 'その他'],
  esthetic_salon: ['エステティシャン', 'セラピスト', '店長', '受付', 'その他'],
  nail_salon: ['ネイリスト', 'アシスタント', '店長', '受付', 'その他'],
  eyelash_salon: ['アイリスト', 'アシスタント', '店長', '受付', 'その他'],
  massage: ['セラピスト', '施術者', '店長', '受付', 'その他'],
  relaxation: ['セラピスト', '施術者', '店長', '受付', 'その他'],
  aroma: ['セラピスト', '施術者', '店長', '受付', 'その他'],
  foot_care: ['セラピスト', '施術者', '店長', '受付', 'その他'],
  acupuncture: ['鍼灸師', '施術者', '院長', '受付', 'その他'],
  personal_gym: ['トレーナー', 'インストラクター', '受付', 'その他'],
  training_school: ['トレーナー', 'インストラクター', '受付', 'その他'],
  yoga_studio: ['インストラクター', '受付', 'その他'],
  pilates_studio: ['インストラクター', '受付', 'その他'],
  dental_clinic: ['歯科医師', '歯科衛生士', '受付', 'スタッフ', 'その他'],
  medical_clinic: ['医師', '看護師', '受付', 'スタッフ', 'その他'],
  dermatology: ['医師', '看護師', '受付', 'スタッフ', 'その他'],
  cosmetic_surgery: ['医師', '看護師', '受付', 'スタッフ', 'その他'],
  wellness_clinic: ['医師', '看護師', '受付', 'スタッフ', 'その他'],
  physical_therapy: ['理学療法士', '施術者', '受付', 'その他'],
  mental_health: ['カウンセラー', '受付', 'その他'],
  veterinary: ['獣医師', '看護師', '受付', 'その他'],
  pet_grooming: ['トリマー', '受付', 'スタッフ', 'その他'],
}

/** Job-title options for the given business type, or a sensible default when the
 *  type is unset or unmapped. Always includes 「その他」 as the escape hatch. */
export function getJobTitles(businessType?: string | null): string[] {
  if (businessType && BUSINESS_TYPE_TITLES[businessType]) {
    return BUSINESS_TYPE_TITLES[businessType]
  }
  return DEFAULT_TITLES
}
