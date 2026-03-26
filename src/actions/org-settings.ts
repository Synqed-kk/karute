'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  type OperatingHours,
  normalizeOperatingHours,
  validateOperatingHours,
} from '@/lib/operating-hours'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any

export interface ThemeColors {
  barOpen?: string
  barBooking?: string
  barRecording?: string
  barCompleted?: string
  barBlocked?: string
  barProcessing?: string
  tableBg?: string
  tableRowBg?: string
}

export const DEFAULT_THEME_COLORS: ThemeColors = {
  barOpen: '#3b82f6',
  barBooking: '#3b82f6',
  barRecording: '#eab308',
  barCompleted: '#22c55e',
  barBlocked: '#d4a1a6',
  barProcessing: '#8b5cf6',
  tableBg: '',
  tableRowBg: '',
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
}

export async function getOrgSettings(): Promise<OrgSettings | null> {
  const supabase = await createClient()
  const { data } = await (supabase as SupabaseAny)
    .from('organization_settings')
    .select('*')
    .limit(1)
    .single()

  if (!data) return null

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
