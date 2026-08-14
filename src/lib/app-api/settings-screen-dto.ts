// Settings screen DTO — the Bearer twin of SettingsShell's non-inert prop
// surface (design-parity packet 12 §S1). Unlike the flat, feature-derived
// DTOs elsewhere in this dir (RecordScreenDTO etc.), this one mirrors
// OrgSettings field-for-field: S1 REUSES the web SettingsShell component (and
// its five live sections) directly rather than building a thin-specific view,
// and those sections read `orgSettings: OrgSettings | null` as a whole —
// there is no narrower shape to project onto.
//
// initialStores / initialEntitlement (design-parity packet 12 §B-3 S2): the
// 店舗 tab is now LIVE, so both fields are real — StoreRowSchema mirrors
// StoreRow (src/actions/stores.ts) and EntitlementSchema mirrors Entitlement
// (src/lib/subscription/entitlement-resolve.ts) field-for-field, same
// approach as OrgSettingsSchema below. Both are least-privilege-gated in the
// route (canViewAllStores only) — the tab is hidden without that grant.

import { z } from 'zod'

/** Mirrors StoreRow (src/actions/stores.ts). */
export const StoreRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  isPrimary: z.boolean(),
  active: z.boolean(),
  staffCount: z.number(),
  customerCount: z.number(),
  businessType: z.string().nullable(),
})

/** Mirrors TierFeatures (src/lib/subscription/types.ts). */
const TierFeaturesSchema = z.object({
  stores: z.union([z.number(), z.literal('unlimited')]),
  staff: z.union([z.number(), z.literal('unlimited')]),
  customers: z.union([z.number(), z.literal('unlimited')]),
  recordingsPerMonth: z.union([z.number(), z.literal('unlimited')]),
  aiKaruteGeneration: z.boolean(),
  customerMemoryAutoExtract: z.boolean(),
  aiOutreachDrafts: z.boolean(),
  coachingInsights: z.boolean(),
  advancedCoachingAnalytics: z.boolean(),
  prioritySupport: z.boolean(),
})

/** Mirrors Entitlement (src/lib/subscription/entitlement-resolve.ts). Every
 *  field is already JSON-safe (string/number/boolean/'unlimited' literal) —
 *  no non-serializable field to map explicitly. */
export const EntitlementSchema = z.object({
  tier: z.enum(['trial', 'free', 'standard', 'professional', 'enterprise']),
  storeLimit: z.union([z.number(), z.literal('unlimited')]),
  storeCount: z.number(),
  isUnlimited: z.boolean(),
  features: TierFeaturesSchema,
  staffLimit: z.union([z.number(), z.literal('unlimited')]),
  canAddStore: z.boolean(),
  enforced: z.boolean(),
  degraded: z.boolean(),
})

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
  pack_burn_mode: z.enum(['auto', 'manual']),
  coaching_enabled: z.boolean().optional(),
})

/** PATCH /api/app/v1/org-settings body — every field optional (a merge
 *  patch, mirroring upsertOrgSettings's own Partial<OrgSettings> input).
 *  `id` is dropped: writeOrgSettingsBlobWithClient never accepts it (the
 *  business id is resolved server-side from the Bearer token, same as the
 *  web action never lets the client set it). Network-boundary validation the
 *  web action itself doesn't have (writeOrgSettingsBlob merges an unvalidated
 *  Partial<OrgSettings> from trusted in-process callers) — deliberate
 *  hardening for this NEW facade endpoint; web's own looseness is untouched.
 *
 *  `voice_enrollments` is dropped too (auditor finding): it is STAFF-OWNED
 *  data with its own ownership gate — writeOrgSettingsBlob's doc comment says
 *  the write/gate split exists precisely so voice fields do NOT ride the
 *  settings.manage gate. No S1 section ever sends it (voice enrollment lives
 *  in the staff tab's voice service, S4); accepting it here would hand every
 *  settings.manage holder a write path over other staff's enrollment records
 *  through this NEW endpoint. zod strips it silently (same as any unknown
 *  key), pinned by the route test. */
export const OrgSettingsPatchDTO = OrgSettingsSchema.omit({
  id: true,
  voice_enrollments: true,
}).partial()

/** Mirrors the read-only fields off SyncConfig (QuickReserve) the
 *  予約同期 status card needs (packet 31). Least-data: `username` never ships
 *  — credentials stay server-side; the card shows a static source label
 *  instead. `lastRunAt` stays a raw ISO instant — the client formats it in
 *  its OWN timezone (same lambda-zone reasoning as the web proxy route,
 *  api/sync/quickreserve/config/route.ts:30-33). */
export const SyncStatusSchema = z.object({
  enabled: z.boolean(),
  lastRunAt: z.string().nullable(),
  lastRunStatus: z.string().nullable(),
  lastRunError: z.string().nullable(),
})
export type SyncStatusDTO = z.infer<typeof SyncStatusSchema>

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
  // Core-only roster card, no login attached (lib/staff.ts). Without this
  // key zod would strip the flag and the shell would fall back to the
  // fetch-and-fail path this flag exists to prevent.
  unlinked: z.boolean().optional(),
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
  // Owner OR an explicit sync.view grant — gates the 予約同期 TAB itself
  // (PR-M2 fix round), same shape as canViewAudit. Distinct from syncStatus
  // below: this flag controls whether the tab renders at all; syncStatus
  // controls which CONTENT it shows once visible.
  canViewSync: z.boolean(),
  // The BARE menus.manage capability — gates the メニュー TAB itself
  // (menu-catalog PR-2 fix round). Deliberately NOT the owner-|| shape above:
  // owner/manager/senior all hold menus.manage through their CAPABILITIES
  // preset, so a fallback would only ever widen the gate past what
  // listMenus/the write actions themselves enforce. Mirrors the web page's
  // own derivation (settings/page.tsx: caps.has('menus.manage')).
  canManageMenus: z.boolean(),
  // Owner OR an explicit sync.view grant (packet 31) — null for everyone
  // else, same least-privilege gate shape as canViewAudit's grant. Distinct
  // from a boolean flag: the shell keys off syncStatus's presence itself
  // (non-null → real card; null → the existing web-only fallback panel).
  syncStatus: SyncStatusSchema.nullable(),
  // page.tsx's own derivation only ever produces 'audit' or null (the sole
  // ?tab= value the web page recognizes) — narrower than SettingsTabId by
  // construction, mirrored here rather than widened speculatively.
  initialTab: z.enum(['audit']).nullable(),
  auditTargetId: z.string().nullable(),
  initialActiveStoreId: z.string().nullable(),
  // Least-privilege (packet 12 §B-3 S2): [] / null for a non-viewAll identity
  // — the 店舗 tab is hidden for them anyway (canViewAllStores === false).
  initialStores: z.array(StoreRowSchema),
  initialEntitlement: EntitlementSchema.nullable(),
  // Server-truth feature flags (design-parity packet 12 §S4a): thin's
  // process.env is {} (thin/vite.config.ts:125), so a component reading
  // NEXT_PUBLIC_FEATURE_STAFF_INVITES / _MULTI_STORE directly would always
  // read false in native even though both are ON in prod web — silently
  // hiding the invite dialog + store-assignment UI, not a parity gap the UI
  // should ever show. The facade route reads its OWN (real) env and ships
  // the resolved booleans here; StaffSection/StaffForm read `prop ?? env` so
  // web (which never passes these props) is byte-for-byte unchanged.
  featureStaffInvites: z.boolean(),
  featureMultiStore: z.boolean(),
})

export type SettingsScreenDTOType = z.infer<typeof SettingsScreenDTO>
