// Seed a handful of customers + appointments for today, attached to the
// staff profile of dev@karute.test. Used to populate the booking-spike
// prototype so the day grid has real cards to render.
//
// Usage:
//   npx tsx --env-file=.env scripts/seed-booking-data.ts
//
// Idempotent: customers are created fresh each run (test data, fine to
// accumulate). Appointments are scattered across today's business hours.

import { createClient } from '@supabase/supabase-js'
import { SynqedClient } from '@synqed-kk/client'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SYNQED_URL = process.env.SYNQED_CORE_URL!
const SYNQED_KEY = process.env.SYNQED_CORE_API_KEY!

const EMAIL = 'dev@karute.test'

const CUSTOMERS = [
  { name: '高橋 由美', furigana: 'タカハシ ユミ' },
  { name: '鈴木 優子', furigana: 'スズキ ユウコ' },
  { name: '斎藤 麗子', furigana: 'サイトウ レイコ' },
  { name: '田中 美咲', furigana: 'タナカ ミサキ' },
  { name: '小林 あや', furigana: 'コバヤシ アヤ' },
  { name: '山田 美月', furigana: 'ヤマダ ミヅキ' },
]

const SERVICES = [
  { title: 'フェイシャル・ベーシック', duration: 60 },
  { title: 'ボディケア・90分', duration: 90 },
  { title: 'ヘッドスパ', duration: 45 },
  { title: 'フェイシャル・保湿強化', duration: 60 },
  { title: 'アロマトリートメント', duration: 75 },
  { title: 'フェイシャル・エイジングケア', duration: 60 },
]

function todayAt(hour: number, minute = 0): Date {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY || !SYNQED_URL || !SYNQED_KEY) {
    console.error('Missing env vars (SUPABASE_URL/SERVICE_ROLE_KEY/SYNQED_CORE_URL/SYNQED_CORE_API_KEY)')
    process.exit(1)
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // 1. Look up the dev user + their business id
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listErr) throw listErr
  const user = list.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase())
  if (!user) {
    console.error(`No auth user for ${EMAIL}. Run scripts/seed-test-user.ts first.`)
    process.exit(1)
  }
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, customer_id, full_name')
    .eq('id', user.id)
    .single()
  if (profileErr) throw profileErr
  if (!profile?.customer_id) {
    console.error('Profile has no customer_id (= business id). Re-run seed-test-user.ts.')
    process.exit(1)
  }
  const businessId = profile.customer_id as string
  console.log(`Business: ${businessId}, owner: ${profile.full_name} (${profile.id})`)

  const synqed = new SynqedClient({ baseUrl: SYNQED_URL, apiKey: SYNQED_KEY, businessId })

  // Look up the synqed-core staff record (its primary key differs from auth user id)
  const staffList = await synqed.staff.list({ page_size: 50 })
  const ownerStaff = staffList.staff.find((s) => s.user_id === user.id)
  if (!ownerStaff) {
    console.error('No synqed-core staff record found for this user.')
    process.exit(1)
  }
  const staffId = ownerStaff.id
  console.log(`Synqed staff: ${staffId}`)

  // 2. Create customers
  console.log(`Creating ${CUSTOMERS.length} customers…`)
  const created: { id: string; name: string }[] = []
  for (const c of CUSTOMERS) {
    const cust = await synqed.customers.create({ name: c.name, furigana: c.furigana, phone: null, email: null })
    created.push({ id: cust.id, name: cust.name })
  }

  // 3. Create appointments spread across today's business hours
  const slots = [
    { hour: 10, minute: 0, serviceIdx: 0 },  // past — completed
    { hour: 11, minute: 30, serviceIdx: 1 }, // past — completed
    { hour: 13, minute: 0, serviceIdx: 2 },  // past — completed (or current depending on time)
    { hour: 14, minute: 30, serviceIdx: 3 }, // possibly current
    { hour: 16, minute: 0, serviceIdx: 4 },  // future — booked
    { hour: 18, minute: 0, serviceIdx: 5 },  // future — booked
  ]
  console.log(`Creating ${slots.length} appointments for today…`)
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const customer = created[i % created.length]
    const service = SERVICES[slot.serviceIdx]
    const starts = todayAt(slot.hour, slot.minute)
    const ends = new Date(starts.getTime() + service.duration * 60000)
    const appt = await synqed.appointments.create({
      customer_id: customer.id,
      staff_id: staffId,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      duration_minutes: service.duration,
      title: service.title,
      notes: null,
    })
    console.log(`  ${slot.hour}:${String(slot.minute).padStart(2, '0')} ${customer.name.padEnd(8)} ${service.title}  → ${appt.id}`)
  }

  console.log('\nDone. Reload /booking-spike/index.html to see the populated grid.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
