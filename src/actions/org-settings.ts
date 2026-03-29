'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  type OperatingHours,
  normalizeOperatingHours,
  validateOperatingHours,
} from '@/lib/operating-hours'

import type { ThemeColors } from '@/lib/theme'
import { DEFAULT_THEME_COLORS } from '@/lib/theme'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any

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
  const supabase = await createClient()
  const { data, error } = await (supabase as SupabaseAny)
    .from('organization_settings')
    .select('*')
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  const settings = data as Omit<OrgSettings, 'operating_hours' | 'theme_colors'> & { operating_hours?: unknown; theme_colors?: unknown }
  return {
    ...settings,
    operating_hours: normalizeOperatingHours(settings.operating_hours),
    theme_colors: { ...DEFAULT_THEME_COLORS, ...(typeof settings.theme_colors === 'object' && settings.theme_colors !== null ? settings.theme_colors : {}) },
  }
}

export async function upsertOrgSettings(settings: Partial<OrgSettings>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const nextSettings: Partial<OrgSettings> = { ...settings }

  if (settings.operating_hours) {
    const normalizedHours = normalizeOperatingHours(settings.operating_hours)
    const validationErrors = validateOperatingHours(normalizedHours)
    const firstError = Object.values(validationErrors).find(Boolean)
    if (firstError) return { error: firstError }
    nextSettings.operating_hours = normalizedHours
  }

  // Check if settings exist
  const existing = await getOrgSettings()

  if (existing) {
    const { error } = await (supabase as SupabaseAny)
      .from('organization_settings')
      .update(nextSettings)
      .eq('id', existing.id)
    if (error) return { error: (error as { message: string }).message }
  } else {
    const { error } = await (supabase as SupabaseAny)
      .from('organization_settings')
      .insert({ ...nextSettings, owner_profile_id: user.id })
    if (error) return { error: (error as { message: string }).message }
  }

  revalidatePath('/settings')
  return { success: true }
}
