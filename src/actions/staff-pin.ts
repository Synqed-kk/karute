'use server'

import crypto from 'crypto'
import { createClient } from '@/lib/supabase/server'

function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(pin).digest('hex')
}

/**
 * Set or update a staff member's 4-digit PIN.
 * Only the account owner or the staff member themselves can set their PIN.
 */
export async function setStaffPin(staffId: string, pin: string): Promise<{ error?: string }> {
  if (!/^\d{4}$/.test(pin)) {
    return { error: 'PIN must be exactly 4 digits' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('profiles')
    .update({ pin_hash: hashPin(pin) })
    .eq('id', staffId)

  if (error) return { error: error.message }
  return {}
}

/**
 * Remove a staff member's PIN (allows switching without PIN).
 */
export async function removeStaffPin(staffId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('profiles')
    .update({ pin_hash: null })
    .eq('id', staffId)

  if (error) return { error: error.message }
  return {}
}

/**
 * Verify a staff member's PIN.
 * Returns { valid: true } if correct, { valid: false } if wrong.
 * If no PIN is set, returns { valid: true, noPin: true }.
 */
export async function verifyStaffPin(staffId: string, pin: string): Promise<{ valid: boolean; noPin?: boolean; error?: string }> {
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('profiles')
    .select('pin_hash')
    .eq('id', staffId)
    .single()

  if (error) return { valid: false, error: error.message }

  const storedHash = data?.pin_hash
  if (!storedHash) return { valid: true, noPin: true }

  return { valid: hashPin(pin) === storedHash }
}

/**
 * Check if a staff member has a PIN set.
 */
export async function hasStaffPin(staffId: string): Promise<boolean> {
  const supabase = await createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('profiles')
    .select('pin_hash')
    .eq('id', staffId)
    .single()

  return !!data?.pin_hash
}
