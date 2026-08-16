'use server'

import { revalidatePath, updateTag, unstable_cache } from 'next/cache'
// type-only — a value import would pull the ESM-only SDK into every jest
// graph that reaches this module while mocking only the '@/lib/synqed/client'
// seam (the house convention); construction goes through that seam below.
import type { SynqedClient } from '@synqed-kk/client'
import { getSynqedClient, newSynqedClient } from '@/lib/synqed/client'
import { getBusinessId } from '@/lib/staff'
import { ymdInJst } from '@/lib/date/jst'
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
  /** 自動消化 high-water mark: the newest JST date (yyyy-mm-dd) the cron has
   *  cleanly processed for this business. Written by the cron itself, never by
   *  the settings UI. Absent = never processed, which the cron reads as "take
   *  only the newest day", so turning 自動消化 on can't retro-charge. */
  auto_burn_last_processed?: string
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
  /** 自動録音 — the ids of the stores where auto-start is ON (recording-
   *  integrity spec §8.1, PR A4). Ruled default is OFF everywhere, which is
   *  what an absent key / empty array means; A7 reads MEMBERSHIP of the
   *  appointment's store at arm time.
   *
   *  Why an id LIST on a per-ORG blob rather than a boolean per store: ruling
   *  ③ set per-store semantics, but this blob is keyed by businessId only
   *  (orgSettingsByBusiness below — no store_id exists anywhere in this file),
   *  so the store dimension has to live INSIDE the value. Spec §8.1's ⚠ 8/17
   *  correction block rules this shape; real per-store settings rows stay the
   *  honest close (§13.11, core-side).
   *
   *  WRITE PATH IS NOT THIS FILE: only setRecordingAutostartWithClient
   *  (src/lib/settings/recording-autostart.ts) may set it — it validates store
   *  membership and writes the §10.3 audit row. upsertOrgSettings strips the
   *  key and OrgSettingsPatchDTO omits it, so the generic settings write can
   *  never flip auto-start silently (§8.1's one deliberate audit exception is
   *  worthless if a second unaudited door exists). */
  recording_autostart_store_ids?: string[]
}

/** F8 hygiene for the 自動録音 store-id list: keep only real, plausibly-sized
 *  string ids, de-duplicated, bounded. Every rejection direction is toward OFF
 *  — a junk entry can only ever REMOVE a store from auto-start, never add one.
 *  Caps are sanity bounds, not policy (a business with 200 stores is far past
 *  anything this app has seen); they stop a corrupted blob from being carried
 *  forward unbounded on every subsequent write. */
const MAX_AUTOSTART_STORE_IDS = 200
const MAX_STORE_ID_LEN = 200
function sanitizeStoreIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_STORE_ID_LEN) continue
    seen.add(v)
    if (seen.size >= MAX_AUTOSTART_STORE_IDS) break
  }
  return [...seen]
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
    // Anything that isn't a yyyy-mm-dd date reads as absent — a garbled marker
    // must degrade to "never processed" (burn only the newest day), never to a
    // bad comparison. The cron compares marker to dates as STRINGS, so a
    // garbled one ('corrupt') sorts above every real date and made the pending
    // list empty forever: nothing burned, no error, no signal (round 2 G6).
    auto_burn_last_processed:
      typeof s.auto_burn_last_processed === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(s.auto_burn_last_processed)
        ? s.auto_burn_last_processed
        : undefined,
    ticket_packs_enabled:
      s.ticket_packs_enabled === undefined
        ? true
        : Boolean(s.ticket_packs_enabled),
    // Coaching master switch — default OFF (opt-in, paid). Without this mapping
    // the access gate would read undefined→false forever, so the toggle could
    // never take effect even once the column + UI exist. (audit finding)
    coaching_enabled:
      s.coaching_enabled === undefined ? false : Boolean(s.coaching_enabled),
    // 自動録音 (spec §8.1) — explicit `undefined → []`, the ruled default-OFF.
    // Same audit finding as coaching_enabled above: without the mapping the
    // arm gate would read undefined forever and the toggle could never take
    // effect once A7 exists. Sanitized rather than trusted: a garbled blob
    // must degrade toward OFF (fewer stores), never toward "record more".
    recording_autostart_store_ids: sanitizeStoreIds(s.recording_autostart_store_ids),
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

    // 自動消化 turning ON is a FORWARD-GOING decision (round 2 G5). This is the
    // one place the transition is visible — the merge above is what holds the
    // previous value — and without the seed the first sweep after a flip
    // retro-charges every booking that already ended, which is exactly what the
    // settings copy promises it won't do. Seeding the cron's marker to TODAY
    // settles today, so the first burn is tomorrow's.
    // The transition is BOTH switches together, because both gate the cron: the
    // mode is 'auto' AND 回数券 is on. Turning 回数券 back on after a break
    // would otherwise let the cron's catch-up window reach into the days it was
    // off. ONLY on the transition — a re-save must not move the marker, which
    // would stall a genuine catch-up, and the cron's own marker write (which
    // sends no mode) must pass through untouched.
    const effectiveAuto = (s: Record<string, unknown>, patch: Partial<OrgSettings>) =>
      (patch.pack_burn_mode ?? s.pack_burn_mode) === 'auto' &&
      (patch.ticket_packs_enabled ?? s.ticket_packs_enabled) !== false
    if (!effectiveAuto(existingSettings, {}) && effectiveAuto(existingSettings, rest)) {
      // The seed leapfrogs whatever marker was there — if the cron had a
      // genuine backlog (stall/outage), those days are deliberately ceded to
      // flip-forward (never retro-charge), but never silently: mirror the
      // cron's own gap warning so the log tells the same story on both sides.
      const prior = existingSettings.auto_burn_last_processed
      if (typeof prior === 'string' && prior < ymdInJst(new Date(Date.now() - 86_400_000))) {
        // Fires for any >1-day gap — OFF-period days (nothing owed) and
        // stalled-while-ON days alike; the log can't tell them apart.
        console.warn('[auto-burn]', JSON.stringify({ warn: 'flip-on seed leapfrogs stale marker', prior, seeded: ymdInJst() }))
      }
      rest.auto_burn_last_processed = ymdInJst()
    }

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
  // 自動録音 is NOT writable through the generic settings door (spec §8.1).
  // This action is a client-invokable server action taking an unvalidated
  // Partial<OrgSettings>, so without the strip any settings.manage holder
  // could flip auto-start for an arbitrary — even foreign — store id with no
  // audit row: exactly the silent flip §8.1's one audit exception exists to
  // prevent. setRecordingAutostart is the only door. (Facade twin: the key is
  // omitted from OrgSettingsPatchDTO, same guard, same reason as
  // voice_enrollments.)
  const { recording_autostart_store_ids: _autostart, ...rest } = settings
  return writeOrgSettingsBlob(rest)
}
