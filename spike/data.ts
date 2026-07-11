import type { CustomerProfileData } from '@/components/customers/redesign/types'
import type { CustomerSessionEntry } from '@/components/customers/redesign/profile/SessionsTabContent'
import type { CustomerPhoto } from '@/components/customers/redesign/profile/PhotosTabContent'

// ── Config (parameterized — hard requirement). API base + Supabase come from
//    build env, never hardcoded; the shell's later custom-domain swap is a
//    config change, not a rewrite. Fallbacks are the current deployed origins.
const API_BASE =
  import.meta.env.VITE_API_BASE ?? 'https://karute-omega.vercel.app'
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://rvkhxludlxxidjjgcnva.supabase.co'
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON ?? ''

// ── Live cross-origin probes. Origin here is http://localhost:<port> (python
//    http.server), which is NOT capacitor://localhost — but a browser still
//    enforces CORS, so a failure here is a real one the shell will also hit.
//    Read-only: GET only, no session, no mutations.
async function probe(label: string, url: string, init?: RequestInit) {
  try {
    const res = await fetch(url, init)
    const body = await res.text()
    console.warn(
      `[PROBE ${label}] ${res.status} ${res.statusText} :: ${body.slice(0, 200)}`,
    )
  } catch (e) {
    console.error(`[PROBE ${label}] NETWORK/CORS FAILURE ::`, e)
  }
}

export async function runProbes() {
  // 1. The one client-callable data route the app exposes today (bulk export),
  //    unauthenticated — shows the cookie-auth wall + whether CORS even lets us.
  await probe('deployed-api/export', `${API_BASE}/api/export?scope=customers&format=json`)
  // 2. Supabase PostgREST with the public anon key, no user session — shows
  //    whether the profile's Supabase-resident tables are client-reachable
  //    under RLS (customer_contacts is one of them).
  await probe(
    'supabase-rest/customer_contacts',
    `${SUPABASE_URL}/rest/v1/customer_contacts?select=*&limit=1`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } },
  )
}

// ── Representative fixture — shaped like the server page's output. The customer
//    identity + karute history are synqed-core-only (server API key, no client
//    endpoint), so a live client fetch of THIS page's core data is impossible
//    today; the fixture stands in so the UI still renders for the proof.
const profile: CustomerProfileData = {
  id: 'spike-cust-0001',
  name: '田中 花子',
  initials: '田',
  karuteNumber: '#00042',
  age: 34,
  gender: '女性',
  joinDate: '2024年6月1日',
  totalKarute: 8,
  visitCount: 11,
  phone: '090-1234-5678',
  email: 'hanako@example.com',
  preferredStaffId: 'staff-1',
  preferredStaffName: '佐藤 美咲',
  bookingStaffName: '佐藤 美咲',
  status: 'on-track',
  memoryCount: 5,
  sessionCount: 8,
  photoCount: 2,
  lastVisitDate: '2026年4月19日',
  occupation: 'マーケティング',
  hasTicketPack: false,
  memberNumber: 'QR-88213',
  isBirthdayMonth: true,
  dateOfBirth: '1992-07-14',
  genderCode: 'female',
  bookingMemo: '▶症状: 肩こり ▶ゴール: 定期メンテナンス',
  visitPace: {
    hasDates: true,
    pending: false,
    rhythm: 'on-rhythm',
    avgIntervalDays: 32,
    totalVisits: 11,
    lastVisitIso: '2026-04-19',
  } as CustomerProfileData['visitPace'],
  visitPaceLastVisitDate: '4/19(日)',
  visitPaceLastService: 'カット',
  noShowCount: 0,
}

const sessions: CustomerSessionEntry[] = [
  {
    id: 's1',
    karuteId: 's1',
    date: '2026年4月19日',
    weekday: '日',
    service: 'カット',
    duration: 60,
    summary: '肩こり改善のメンテ施術。次回は3週間後を提案。',
    staffName: '佐藤 美咲',
    entryCount: 3,
    aiSummarized: true,
    memoryAdded: null,
    isLatest: true,
  },
  {
    id: 's2',
    karuteId: 's2',
    date: '2026年3月15日',
    weekday: '土',
    service: 'カット',
    duration: 45,
    summary: '前回より張りが軽減。ホームケアの助言。',
    staffName: '佐藤 美咲',
    entryCount: 2,
    aiSummarized: true,
    memoryAdded: null,
    isLatest: false,
  },
]

const photos: CustomerPhoto[] = []

export async function fetchProfileData() {
  await runProbes()
  return { profile, sessions, photos }
}
