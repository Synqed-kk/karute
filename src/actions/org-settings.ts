'use server'

import { revalidatePath, updateTag, unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId } from '@/lib/staff'
import {
  type OperatingHours,
  normalizeOperatingHours,
  validateOperatingHours,
} from '@/lib/operating-hours'

import type { ThemeColors } from '@/lib/theme'
import { DEFAULT_THEME_COLORS } from '@/lib/theme'

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

export async function upsertOrgSettings(settings: Partial<OrgSettings>) {
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
