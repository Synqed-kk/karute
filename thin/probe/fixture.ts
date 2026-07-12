// Render fixture for the first-paint probe — shaped like the customer page's
// server output. The customer identity + karute history are synqed-core-only
// (server API key, no client endpoint), so a live client fetch is impossible
// without the BFF; the fixture stands in so a REAL screen renders and the bundle
// is representative for the parse/compile budget. This is render input, NOT a
// faked measurement — the probe marks below are wall-clock real.
//
// Ported from the export spike (spike/data.ts) minus its live CORS probes — the
// production thin target must not fire cross-origin probes on boot.

import type { CustomerProfileData } from '@/components/customers/redesign/types'
import type { CustomerSessionEntry } from '@/components/customers/redesign/profile/SessionsTabContent'
import type { CustomerPhoto } from '@/components/customers/redesign/profile/PhotosTabContent'

export const profile: CustomerProfileData = {
  id: 'probe-cust-0001',
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
    totalVisits: 11,
    lastVisitAgoDays: 20,
    avgIntervalDays: 32,
    spanMonths: 18,
    state: 'on-rhythm',
    ratio: 0.63,
    segment: 'jouren',
    pending: false,
  },
  visitPaceLastVisitDate: '4/19(日)',
  visitPaceLastService: 'カット',
  noShowCount: 0,
}

export const sessions: CustomerSessionEntry[] = [
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

export const photos: CustomerPhoto[] = []
