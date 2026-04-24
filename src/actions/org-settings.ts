'use server'

import { revalidatePath } from 'next/cache'
import { getSynqedClient } from '@/lib/synqed/client'
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

export async function getOrgSettings(): Promise<OrgSettings | null> {
  try {
    const synqed = await getSynqedClient()
    const raw = await synqed.orgSettings.get()
    if (!raw) return null

    const s = (raw.settings ?? {}) as Partial<OrgSettings> & {
      operating_hours?: unknown
      theme_colors?: unknown
    }

    return {
      id: raw.tenant_id,
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
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
