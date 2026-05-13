import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { getStaffList } from '@/lib/staff'
import { getAppointmentsByDate } from '@/actions/appointments'

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

  const [staffList, appointments] = await Promise.all([
    getStaffList(),
    getAppointmentsByDate(todayIso, -now.getTimezoneOffset()).catch(() => []),
  ])

  const staff = staffList.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    initials: initialOf(s.full_name ?? '?'),
    role: s.display_role ?? s.position ?? 'スタッフ',
    takesBookings: true,
    colorKey: colorKeyFor(s.id),
  }))

  const reservations = appointments.map((a) => {
    const customerName = a.customers?.name ?? 'Unknown'
    return {
      id: a.id,
      staffId: a.staff_profile_id,
      startTime: hmFromIso(a.start_time),
      duration: a.duration_minutes,
      customerName,
      customerInitials: initialOf(customerName),
      karute: a.karute_record_id ? `#${a.karute_record_id.slice(0, 8)}` : null,
      service: a.title ?? 'セッション',
      status: statusFor(a.start_time, a.duration_minutes, now.getTime()),
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
