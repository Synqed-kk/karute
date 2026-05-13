import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getSynqedClient } from '@/lib/synqed/client'

const STAFF_COLORS = ['blue', 'violet', 'teal', 'pink', 'cyan', 'fuchsia'] as const

function initialOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const first = trimmed[0]
  return first
}

function colorKeyFor(staffId: string): string {
  let hash = 0
  for (let i = 0; i < staffId.length; i++) hash = (hash * 31 + staffId.charCodeAt(i)) | 0
  return STAFF_COLORS[Math.abs(hash) % STAFF_COLORS.length]
}

function hmFromIso(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function statusFor(startsAtIso: string, durationMin: number, now: number): string {
  const start = new Date(startsAtIso).getTime()
  const end = start + durationMin * 60000
  if (now > end) return '完了'
  if (now >= start) return '施術中'
  return '予約済'
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  // Local-midnight start of today, expressed as UTC ISO.
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

  const synqed = await getSynqedClient()
  const [staffResp, apptResp] = await Promise.all([
    synqed.staff.list({ page_size: 50 }),
    synqed.appointments
      .list({ from: dayStart.toISOString(), to: dayEnd.toISOString(), page_size: 200 })
      .catch(() => ({ appointments: [] as Array<{ id: string; staff_id: string; customer_id: string; starts_at: string; ends_at: string; duration_minutes: number | null; title: string | null }> })),
  ])
  const appointments = apptResp.appointments

  // Resolve customer names for the appointments we got back
  const customerIds = Array.from(new Set(appointments.map((a) => a.customer_id)))
  const customers = await Promise.all(
    customerIds.map((id) => synqed.customers.get(id).catch(() => null)),
  )
  const nameById = new Map(
    customers.filter((c): c is NonNullable<typeof c> => c != null).map((c) => [c.id, c.name]),
  )

  const staff = staffResp.staff.map((s) => ({
    id: s.id,
    name: s.name,
    initials: initialOf(s.name),
    role: s.role === 'OWNER' ? 'オーナー' : 'スタッフ',
    takesBookings: true,
    colorKey: colorKeyFor(s.id),
  }))

  const reservations = appointments.map((a) => {
    const customerName = nameById.get(a.customer_id) ?? 'Unknown'
    const duration =
      a.duration_minutes ??
      Math.max(0, Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000))
    return {
      id: a.id,
      staffId: a.staff_id,
      startTime: hmFromIso(a.starts_at),
      duration,
      customerName,
      customerInitials: initialOf(customerName),
      karute: null as string | null,
      service: a.title ?? 'セッション',
      status: statusFor(a.starts_at, duration, now.getTime()),
      recordingConsent: true,
    }
  })

  return NextResponse.json({
    todayIso,
    currentTime,
    businessHours: { start: 10, end: 20 },
    staff,
    reservations,
  })
}
