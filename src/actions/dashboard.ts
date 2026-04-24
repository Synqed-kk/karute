'use server'

import { getSynqedClient } from '@/lib/synqed/client'

export interface DashboardBar {
  id: string
  staffId: string
  startMinute: number
  durationMinute: number
  title: string
  subtitle?: string
  customerName?: string
}

/**
 * Convert a UTC Date to local hours+minutes using the client's timezone offset.
 * On the server (Vercel UTC), Date.getHours() returns UTC hours.
 * We subtract tzOffsetMinutes to get the client's local time.
 */
function utcToLocalMinute(utcDate: Date, tzOffsetMinutes: number): number {
  const utcMinutes = utcDate.getUTCHours() * 60 + utcDate.getUTCMinutes()
  let localMinutes = utcMinutes - tzOffsetMinutes
  if (localMinutes < 0) localMinutes += 1440
  if (localMinutes >= 1440) localMinutes -= 1440
  return localMinutes
}

function formatTimeRange(startMin: number, endMin: number): string {
  const h1 = Math.floor(startMin / 60)
  const m1 = startMin % 60
  const h2 = Math.floor(endMin / 60)
  const m2 = endMin % 60
  return `${h1}:${String(m1).padStart(2, '0')}-${h2}:${String(m2).padStart(2, '0')}`
}

export async function getBarsByDate(dateStr: string, tzOffsetMinutes: number = 0): Promise<DashboardBar[]> {
  const dayStartUTC = new Date(`${dateStr}T00:00:00Z`)
  dayStartUTC.setUTCMinutes(dayStartUTC.getUTCMinutes() + tzOffsetMinutes)
  const dayEndUTC = new Date(`${dateStr}T23:59:59Z`)
  dayEndUTC.setUTCMinutes(dayEndUTC.getUTCMinutes() + tzOffsetMinutes)

  try {
    const synqed = await getSynqedClient()
    const list = await synqed.karuteRecords.list({
      from: dayStartUTC.toISOString(),
      to: dayEndUTC.toISOString(),
      page_size: 500,
    })

    // Customer names (the old supabase join) — batch fetch uniques
    const uniqueCustomerIds = Array.from(
      new Set(
        list.karute_records
          .map((r) => r.customer_id)
          .filter((id): id is string => id !== null),
      ),
    )
    const customers = await Promise.all(
      uniqueCustomerIds.map((id) => synqed.customers.get(id).catch(() => null)),
    )
    const nameById = new Map(
      customers.filter((c): c is NonNullable<typeof c> => c != null).map((c) => [c.id, c.name]),
    )

    return list.karute_records
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((record) => {
        const createdAt = new Date(record.created_at)
        const startMinute = utcToLocalMinute(createdAt, tzOffsetMinutes)
        const durationMinute = 15
        const customerName = record.customer_id ? nameById.get(record.customer_id) ?? '' : ''
        const title = formatTimeRange(startMinute, startMinute + durationMinute)

        return {
          id: record.id,
          staffId: record.staff_id,
          startMinute,
          durationMinute,
          title,
          subtitle: customerName,
          customerName,
        }
      })
  } catch {
    return []
  }
}
