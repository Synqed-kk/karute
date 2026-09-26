// Fit harness entry — mounts ONE list tab's real view with fixture data:
//   ?tab=karute|customers|appointments  &lang=ja|en
//   staff state rides the tab's own URL param, exactly as a shared link:
//   カルテ/顧客 `?s=self|<id>`, 予約 `?staff=self|<id>` (the page's server
//   param, handed to the view as its staffFilter prop here).
// No providers beyond the locale; no data port; no network.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import ja from '../../messages/ja.json'
import en from '../../messages/en.json'
import '../../src/app/globals.css'
import '../../thin/fonts.css'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import { CustomersListView } from '@/components/customers/redesign/list/CustomersListView'
import { AppointmentsView } from '@/components/appointments/AppointmentsView'
import {
  SELF_ID,
  STAFF,
  customerRows,
  dayTotals,
  karuteItems,
  reservationViews,
} from './fixtures'

const q = new URLSearchParams(location.search)
const tab = q.get('tab') ?? 'karute'
const lang = q.get('lang') === 'en' ? 'en' : 'ja'
document.documentElement.lang = lang

function todayJstIso(): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
  return new Date(`${ymd}T00:00:00+09:00`).toISOString()
}

function View() {
  if (tab === 'customers') {
    return (
      <CustomersListView
        rows={customerRows()}
        totalRegistered={1234}
        query=""
        selfStaffId={SELF_ID}
        staffList={STAFF}
        assignableStaff={[]}
        bookingDataAvailable
        burnByCustomer={{}}
      />
    )
  }
  if (tab === 'appointments') {
    const selectedDateIso = todayJstIso()
    return (
      <AppointmentsView
        staff={STAFF.map((s) => ({ id: s.id, name: s.name, avatarInitials: s.initials }))}
        activeStaffId={SELF_ID}
        authProfileId={SELF_ID}
        customers={[]}
        locale={lang}
        orgSettings={null}
        initialView="day"
        selectedDateIso={selectedDateIso}
        weekData={null}
        weekStartIso={null}
        monthData={null}
        monthStartIso={null}
        dayTotals={dayTotals(selectedDateIso.slice(0, 10))}
        soloMode={false}
        reservationViews={reservationViews()}
        reservationStaff={[]}
        businessHours={{ start: 10, end: 20 }}
        staffFilter={q.get('staff') ?? 'all'}
        loadMonthCells={async () => []}
      />
    )
  }
  return (
    <KaruteRecordListView
      items={karuteItems()}
      monthCount={96}
      total={1234}
      discardedCount={12}
      initialWindowStart={null}
      initialHasMore={false}
      staffList={STAFF}
      currentStaffId={SELF_ID}
      sharedCount={48}
      viewerHoldsViewShared
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : ja} timeZone="Asia/Tokyo">
      {/* The shell's content column (thin/chrome/Chrome.tsx): py-4 under the
       *  header; each view owns its own px-4. */}
      <div data-harness-root="" className="mx-auto max-w-7xl py-4">
        <View />
      </div>
    </NextIntlClientProvider>
  </StrictMode>,
)
