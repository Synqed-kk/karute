'use server'

import { revalidatePath, updateTag, unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { requireCapability } from '@/lib/auth/require-permission'
import { getBusinessId } from '@/lib/staff'
import {
  type OperatingHours,
  normalizeOperatingHours,
  validateOperatingHours,
} from '@/lib/operating-hours'

import type { ThemeColors } from '@/lib/theme'
import { DEFAULT_THEME_COLORS } from '@/lib/theme'

export type RecordingDisclosureMode = 'A' | 'B' | 'C'
export type AudioSource = 'phone' | 'bluetooth' | 'wired'
export type AIVoiceStyle = 'formal' | 'polite' | 'friendly'

/** Owner-managed default for the stop-dialog pack picker (設定 → 回数券). */
export interface PackPreset {
  size: number
  unitPrice: number
}

/** One staff member's voice-enrollment record (org-settings blob — the
 *  documented zero-migration extension path). The SAMPLE is stored in the
 *  recordings bucket; once a matching engine is chosen (Stage 1 bake-off,
 *  docs/diarization-stack.md) samples are converted to embeddings and the
 *  raw audio is deleted. Consent + revocation are first-class. */
export interface VoiceEnrollment {
  consent_at: string
  sample_path: string
  /** ≤10s reference derivative (engine APIs cap reference clips at 2–10s).
   *  Absent on pre-#277 enrollments — identify skips, heuristic applies;
   *  re-enrolling adds it. */
  ref_path?: string
  status: 'saved' | 'revoked'
  revoked_at?: string | null
}

export interface OrgSettings {
  id: string
  salon_name: string
  business_type: string
  webhook_url: string
  ai_model: string
  confidence_threshold: number
  audio_quality: string
  auto_stop_minutes: number
  operating_hours: OperatingHours
  theme_colors: ThemeColors
  // Onboarding-wizard fields. Null until the user finishes /welcome.
  recording_disclosure_mode: RecordingDisclosureMode | null
  recording_disclosure_privacy_confirmed: boolean
  setup_completed_at: string | null
  // Redesigned-settings fields. All optional with defaults; no schema change
  // needed since the synqed-core org-settings settings is a JSON blob.
  timezone: string
  solo_mode: boolean
  ai_auto_summary: boolean
  ai_auto_outreach: boolean
  ai_voice_style: AIVoiceStyle
  audio_source: AudioSource
  noise_suppression: boolean
  speaker_diarization: boolean
  voice_recognition_improved: boolean
  recording_consent_required: boolean
  recording_consent_template: string
  /** 回数券プリセット — the picker's size/price chips. Owner-managed. */
  pack_presets: PackPreset[]
  voice_enrollments: Record<string, VoiceEnrollment>
  /** Off → staff may only pick from presets (no free price/size input). */
  staff_can_customize_packs: boolean
  /** Master switch for 回数券. Off → every pack surface hides (profile card,
   *  dashboard reconcile/alerts, recording burn + outcome dialog) and pack
   *  fetches are skipped. Historical rows stay untouched — switching back on
   *  shows them again. Defaults on so existing salons keep today's behavior. */
  ticket_packs_enabled: boolean
}

// businessId is the cache key — Next includes function args in the key automatically.
// upsertOrgSettings revalidates with the 'org-settings' tag.
const orgSettingsByBusiness = unstable_cache(
  async (businessId: string): Promise<OrgSettings | null> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) return null
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    try {
      const raw = await client.orgSettings.get()
      if (!raw) return null

      const s = (raw.settings ?? {}) as Partial<OrgSettings> & {
        operating_hours?: unknown
        theme_colors?: unknown
      }

      return {
        id: raw.business_id,
        salon_name: raw.name ?? s.salon_name ?? '',
        business_type: s.business_type ?? '',
        webhook_url: s.webhook_url ?? '',
        ai_model: s.ai_model ?? '',
        confidence_threshold: s.confidence_threshold ?? 0,
        audio_quality: s.audio_quality ?? '',
        auto_stop_minutes: s.auto_stop_minutes ?? 0,
        operating_hours: normalizeOperatingHours(s.operating_hours),
        theme_colors: {
          ...DEFAULT_THEME_COLORS,
          ...(typeof s.theme_colors === 'object' && s.theme_colors !== null
            ? (s.theme_colors as Partial<ThemeColors>)
            : {}),
        },
        recording_disclosure_mode:
          (s.recording_disclosure_mode as RecordingDisclosureMode | undefined) ?? null,
        recording_disclosure_privacy_confirmed: Boolean(
          s.recording_disclosure_privacy_confirmed,
        ),
        setup_completed_at:
          (s.setup_completed_at as string | null | undefined) ?? null,
        timezone: (s.timezone as string | undefined) ?? 'Asia/Tokyo',
        solo_mode: Boolean(s.solo_mode),
        ai_auto_summary: s.ai_auto_summary === undefined ? true : Boolean(s.ai_auto_summary),
        ai_auto_outreach: Boolean(s.ai_auto_outreach),
        ai_voice_style: (s.ai_voice_style as AIVoiceStyle | undefined) ?? 'polite',
        audio_source: (s.audio_source as AudioSource | undefined) ?? 'phone',
        noise_suppression: s.noise_suppression === undefined ? true : Boolean(s.noise_suppression),
        speaker_diarization: s.speaker_diarization === undefined ? true : Boolean(s.speaker_diarization),
        voice_recognition_improved: Boolean(s.voice_recognition_improved),
        recording_consent_required: Boolean(s.recording_consent_required),
        recording_consent_template:
          (s.recording_consent_template as string | undefined) ?? '',
        pack_presets: Array.isArray(s.pack_presets)
          ? (s.pack_presets as PackPreset[]).filter(
              (p) =>
                typeof p?.size === 'number' &&
                p.size > 0 &&
                typeof p?.unitPrice === 'number' &&
                p.unitPrice >= 0,
            )
          : [],
        staff_can_customize_packs:
          s.staff_can_customize_packs === undefined
            ? true
            : Boolean(s.staff_can_customize_packs),
        ticket_packs_enabled:
          s.ticket_packs_enabled === undefined
            ? true
            : Boolean(s.ticket_packs_enabled),
        voice_enrollments:
          s.voice_enrollments && typeof s.voice_enrollments === 'object'
            ? (s.voice_enrollments as Record<string, VoiceEnrollment>)
            : {},
      }
    } catch {
      return null
    }
  },
  ['org-settings-v1'],
  { revalidate: 300, tags: ['org-settings'] },
)

export async function getOrgSettings(): Promise<OrgSettings | null> {
  try {
    const businessId = await getBusinessId()
    return orgSettingsByBusiness(businessId)
  } catch {
    return null
  }
}

/**
 * Persists the answers from the /welcome wizard and marks setup as complete.
 * Called from WelcomeWizard's "Finish setup" button. Idempotent: re-running
 * just bumps setup_completed_at.
 */
export async function completeOnboarding(input: {
  businessName: string
  businessType: string
  disclosureMode: RecordingDisclosureMode
  privacyConfirmed: boolean
}): Promise<{ success: true } | { error: string }> {
  if (!input.businessName.trim()) return { error: 'Store name is required' }
  if (!input.businessType) return { error: 'Business type is required' }
  if (input.disclosureMode === 'A' && !input.privacyConfirmed) {
    return { error: 'Privacy policy confirmation required for Mode A' }
  }
  return upsertOrgSettings({
    salon_name: input.businessName.trim(),
    business_type: input.businessType,
    recording_disclosure_mode: input.disclosureMode,
    recording_disclosure_privacy_confirmed: input.privacyConfirmed,
    setup_completed_at: new Date().toISOString(),
  }) as Promise<{ success: true } | { error: string }>
}

export async function upsertOrgSettings(settings: Partial<OrgSettings>) {
  // Org-wide config (recording-consent mode, legal disclosure, theme, AI, packs,
  // hours, webhook) is settings.manage — owner / manager only. The settings tabs
  // are hidden for other roles in the UI; this is the server-side boundary.
  // Voice enrollment used to ride through here; it now has its own self-scoped
  // write in actions/voice.ts, so staff can manage their own voice without this
  // capability.
  try {
    await requireCapability('settings.manage')
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Not allowed' }
  }

  const nextSettings: Partial<OrgSettings> = { ...settings }

  if (settings.operating_hours) {
    const normalizedHours = normalizeOperatingHours(settings.operating_hours)
    const validationErrors = validateOperatingHours(normalizedHours)
    const firstError = Object.values(validationErrors).find(Boolean)
    if (firstError) return { error: firstError }
    nextSettings.operating_hours = normalizedHours
  }

  try {
    const synqed = await getSynqedClient()

    // Merge with existing settings so partial updates don't wipe other fields
    const existing = await synqed.orgSettings.get()
    const existingSettings = (existing?.settings ?? {}) as Record<string, unknown>

    // salon_name maps to the top-level `name` column; everything else lives in
    // the settings JSON
    const { salon_name, id: _id, ...rest } = nextSettings as OrgSettings & { id?: string }

    await synqed.orgSettings.upsert({
      ...(salon_name !== undefined ? { name: salon_name } : {}),
      settings: { ...existingSettings, ...rest },
    })

    revalidatePath('/settings')
    updateTag('org-settings')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
