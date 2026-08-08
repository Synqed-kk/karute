'use server'

import { revalidatePath, updateTag, unstable_cache } from 'next/cache'
// type-only — a value import would pull the ESM-only SDK into every jest
// graph that reaches this module while mocking only the '@/lib/synqed/client'
// seam (the house convention); construction goes through that seam below.
import type { SynqedClient } from '@synqed-kk/client'
import { getSynqedClient, newSynqedClient } from '@/lib/synqed/client'
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
  /** How a ticket gets consumed. 'manual' (default, and what an absent key
   *  means) = today's behavior: only a staff check-off / recording auto-flow /
   *  no-show choice burns. 'auto' = the 自動消化 cron additionally burns one
   *  ticket per completed booking the next morning (src/lib/packs/auto-burn.ts).
   *  Cancellations are ticket-neutral in BOTH modes. */
  pack_burn_mode: 'auto' | 'manual'
  /** Master switch for 回数券. Off → every pack surface hides (profile card,
   *  dashboard reconcile/alerts, recording burn + outcome dialog) and pack
   *  fetches are skipped. Historical rows stay untouched — switching back on
   *  shows them again. Defaults on so existing salons keep today's behavior. */
  ticket_packs_enabled: boolean
  /** Master switch for COACHING. Off (default) → every coaching surface hides AND
   *  no AI generation fires (a real cost gate, not just UI). Owner-controlled and
   *  tier-gated — the full decision lives in karute/coaching/access.ts. Optional
   *  until Anthony adds the column (schema TODO in CoachingSection.tsx); reads as
   *  false pre-migration, so coaching stays dark until deliberately turned on. */
  coaching_enabled?: boolean
}

// businessId is the cache key — Next includes function args in the key automatically.
// upsertOrgSettings revalidates with the 'org-settings' tag.
/** Normalize core's raw orgSettings payload into the app's OrgSettings shape.
 *  Pure (no I/O) so BOTH the graceful cached reader and the throwing
 *  facade reader (orgSettingsWithClient) share ONE mapping. null when core has
 *  no settings row yet (a legitimately-unconfigured salon, not a failure). */
function normalizeOrgSettings(
  raw: Awaited<ReturnType<SynqedClient['orgSettings']['get']>> | null,
): OrgSettings | null {
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
    // Money default: anything that isn't literally 'auto' reads as 'manual', so
    // a garbled/absent blob value can never turn automatic charging ON.
    pack_burn_mode: s.pack_burn_mode === 'auto' ? 'auto' : 'manual',
    ticket_packs_enabled:
      s.ticket_packs_enabled === undefined
        ? true
        : Boolean(s.ticket_packs_enabled),
    // Coaching master switch — default OFF (opt-in, paid). Without this mapping
    // the access gate would read undefined→false forever, so the toggle could
    // never take effect even once the column + UI exist. (audit finding)
    coaching_enabled:
      s.coaching_enabled === undefined ? false : Boolean(s.coaching_enabled),
    voice_enrollments:
      s.voice_enrollments && typeof s.voice_enrollments === 'object'
        ? (s.voice_enrollments as Record<string, VoiceEnrollment>)
        : {},
  }
}

/** Facade/Bearer reader — throwing (packet 06 §Build 2 failure contract:
 *  org-settings→null on the web page becomes a classified 502 on the facade,
 *  never a degraded-200 DTO). Shares normalizeOrgSettings with the cached
 *  graceful path; passes the business-scoped Bearer client so no cookie is
 *  consulted. A genuine upstream failure PROPAGATES (→ 502); a null return is
 *  only the unconfigured-salon case. */
export async function orgSettingsWithClient(
  synqed: Pick<SynqedClient, 'orgSettings'>,
): Promise<OrgSettings | null> {
  return normalizeOrgSettings(await synqed.orgSettings.get())
}

const orgSettingsByBusiness = unstable_cache(
  async (businessId: string): Promise<OrgSettings | null> => {
    if (!process.env.SYNQED_CORE_URL || !process.env.SYNQED_CORE_API_KEY) return null
    const client = newSynqedClient(businessId)
    try {
      return normalizeOrgSettings(await client.orgSettings.get())
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

/**
 * Client-threaded core of writeOrgSettingsBlob (facade Bearer path, design-
 * parity packet 12 §S1 — same WithClient split as orgSettingsWithClient /
 * updateCustomerWithClient). Identical body to writeOrgSettingsBlob, just
 * parameterized on an explicit client instead of resolving one from the
 * cookie session — so the facade's PATCH /api/app/v1/org-settings route can
 * call it with a business-scoped Bearer client. Still NO capability gate
 * (see writeOrgSettingsBlob's doc comment); the facade route enforces
 * settings.manage itself, mirroring upsertOrgSettings's gate.
 */
export async function writeOrgSettingsBlobWithClient(
  synqed: Pick<SynqedClient, 'orgSettings'>,
  settings: Partial<OrgSettings>,
) {
  const nextSettings: Partial<OrgSettings> = { ...settings }

  if (settings.operating_hours) {
    const normalizedHours = normalizeOperatingHours(settings.operating_hours)
    const validationErrors = validateOperatingHours(normalizedHours)
    const firstError = Object.values(validationErrors).find(Boolean)
    if (firstError) return { error: firstError }
    nextSettings.operating_hours = normalizedHours
  }

  try {
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

    // No cache invalidation here: updateTag is Server-Action-only (throws from
    // a Route Handler, next/dist/server/web/spec-extension/revalidate.js), and
    // the org-settings PATCH facade route calls this core directly. The web
    // wrapper below owns revalidatePath/updateTag.
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * INTERNAL org-settings writer — the merge-and-upsert core write with NO
 * capability gate. Callers MUST enforce their own authorization first:
 *   - upsertOrgSettings gates on `settings.manage` (owner/manager settings mgmt).
 *   - the voice service gates on voice OWNERSHIP (a staffer enrolls only their
 *     own voice; owner/manager may act on others) — voice_enrollments is
 *     staff-owned data, so it must NOT require settings.manage.
 * Splitting the write from the gate is what lets one blob field (voice_enrollments)
 * carry a different authz rule than the rest without a settings.manage back door.
 */
export async function writeOrgSettingsBlob(settings: Partial<OrgSettings>) {
  // Client init stays INSIDE the { error } contract, exactly as before the
  // WithClient extraction: a session blip / DB hiccup in getSynqedClient()
  // must resolve to { error }, never reject the server action — the settings
  // sections await upsertOrgSettings with no try/catch of their own.
  let synqed: Pick<SynqedClient, 'orgSettings'>
  try {
    synqed = await getSynqedClient()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
  const result = await writeOrgSettingsBlobWithClient(synqed, settings)
  if ('success' in result) {
    revalidatePath('/settings')
    updateTag('org-settings')
  }
  return result
}

/**
 * Owner/manager settings write (packet 03, gap 1). Previously this action had NO
 * capability gate, so any signed-in staff could rewrite org settings. It now
 * requires `settings.manage` — the same capability the settings UI is presented
 * under — before delegating to the ungated blob writer.
 */
export async function upsertOrgSettings(settings: Partial<OrgSettings>) {
  const { getMyCapabilities, ensureCapability } = await import('@/lib/auth/require-permission')
  try {
    ensureCapability(await getMyCapabilities(), 'settings.manage')
  } catch {
    return { error: 'You do not have permission to change settings.' }
  }
  return writeOrgSettingsBlob(settings)
}
