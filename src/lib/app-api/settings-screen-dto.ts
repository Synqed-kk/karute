// Settings screen DTO — the Bearer twin of SettingsShell's non-inert prop
// surface (design-parity packet 12 §S1). Unlike the flat, feature-derived
// DTOs elsewhere in this dir (RecordScreenDTO etc.), this one mirrors
// OrgSettings field-for-field: S1 REUSES the web SettingsShell component (and
// its five live sections) directly rather than building a thin-specific view,
// and those sections read `orgSettings: OrgSettings | null` as a whole —
// there is no narrower shape to project onto.
//
// initialStores / initialEntitlement are DELIBERATELY NOT part of this DTO.
// Both only ever reach StoresSection/StaffSection, and both tabs render the
// in-shell 準備中 panel this slice (pendingTabIds) — SettingsShell never
// forwards them to a real section. The thin screen passes StoresSection's own
// documented empty/null fallback (its comment: "Entitlement fetched on the
// server... Null on fetch failure → StoresSection falls back to its client
// fetch") directly at the call site, same as AppointmentsScreenInner hardcodes
// `orgSettings={null}` for a prop its view never reads over the facade.

import { z } from 'zod'

const DailyOperatingHoursSchema = z.object({
  openMinute: z.number(),
  closeMinute: z.number(),
})

const OperatingHoursSchema = z.object({
  mon: DailyOperatingHoursSchema,
  tue: DailyOperatingHoursSchema,
  wed: DailyOperatingHoursSchema,
  thu: DailyOperatingHoursSchema,
  fri: DailyOperatingHoursSchema,
  sat: DailyOperatingHoursSchema,
  sun: DailyOperatingHoursSchema,
})

const ThemeColorsSchema = z.object({
  barOpen: z.string().optional(),
  barBooking: z.string().optional(),
  barRecording: z.string().optional(),
  barCompleted: z.string().optional(),
  barBlocked: z.string().optional(),
  barProcessing: z.string().optional(),
  tableBg: z.string().optional(),
  tableRowBg: z.string().optional(),
})

const PackPresetSchema = z.object({
  size: z.number(),
  unitPrice: z.number(),
})

const VoiceEnrollmentSchema = z.object({
  consent_at: z.string(),
  sample_path: z.string(),
  ref_path: z.string().optional(),
  status: z.enum(['saved', 'revoked']),
  revoked_at: z.string().nullable().optional(),
})

/** Field-for-field mirror of OrgSettings (src/actions/org-settings.ts). */
export const OrgSettingsSchema = z.object({
  id: z.string(),
  salon_name: z.string(),
  business_type: z.string(),
  webhook_url: z.string(),
  ai_model: z.string(),
  confidence_threshold: z.number(),
  audio_quality: z.string(),
  auto_stop_minutes: z.number(),
  operating_hours: OperatingHoursSchema,
  theme_colors: ThemeColorsSchema,
  recording_disclosure_mode: z.enum(['A', 'B', 'C']).nullable(),
  recording_disclosure_privacy_confirmed: z.boolean(),
  setup_completed_at: z.string().nullable(),
  timezone: z.string(),
  solo_mode: z.boolean(),
  ai_auto_summary: z.boolean(),
  ai_auto_outreach: z.boolean(),
  ai_voice_style: z.enum(['formal', 'polite', 'friendly']),
  audio_source: z.enum(['phone', 'bluetooth', 'wired']),
  noise_suppression: z.boolean(),
  speaker_diarization: z.boolean(),
  voice_recognition_improved: z.boolean(),
  recording_consent_required: z.boolean(),
  recording_consent_template: z.string(),
  pack_presets: z.array(PackPresetSchema),
  voice_enrollments: z.record(z.string(), VoiceEnrollmentSchema),
  staff_can_customize_packs: z.boolean(),
  ticket_packs_enabled: z.boolean(),
  coaching_enabled: z.boolean().optional(),
})

/** PATCH /api/app/v1/org-settings body — every field optional (a merge
 *  patch, mirroring upsertOrgSettings's own Partial<OrgSettings> input).
 *  `id` is dropped: writeOrgSettingsBlobWithClient never accepts it (the
 *  business id is resolved server-side from the Bearer token, same as the
 *  web action never lets the client set it). Network-boundary validation the
 *  web action itself doesn't have (writeOrgSettingsBlob merges an unvalidated
 *  Partial<OrgSettings> from trusted in-process callers) — deliberate
 *  hardening for this NEW facade endpoint; web's own looseness is untouched. */
export const OrgSettingsPatchDTO = OrgSettingsSchema.omit({ id: true }).partial()

const StaffMemberSchema = z.object({
  id: z.string(),
  full_name: z.string().nullable(),
  display_role: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  has_pin: z.boolean(),
  created_at: z.string(),
})

export const SettingsScreenDTO = z.object({
  orgSettings: OrgSettingsSchema.nullable(),
  staffList: z.array(StaffMemberSchema),
  activeStaffId: z.string().nullable(),
  isOwner: z.boolean(),
  canViewAllStores: z.boolean(),
  canManageStaff: z.boolean(),
  canInviteStaff: z.boolean(),
  canViewAudit: z.boolean(),
  // page.tsx's own derivation only ever produces 'audit' or null (the sole
  // ?tab= value the web page recognizes) — narrower than SettingsTabId by
  // construction, mirrored here rather than widened speculatively.
  initialTab: z.enum(['audit']).nullable(),
  auditTargetId: z.string().nullable(),
  initialActiveStoreId: z.string().nullable(),
})

export type SettingsScreenDTOType = z.infer<typeof SettingsScreenDTO>
