/**
 * Quick Reserve API client.
 * Direct API calls — no Puppeteer needed.
 *
 * Timestamps are Unix ms. Dates in JST.
 */

const QR_API_BASE = 'https://api.quick-reserve.com/v1/console'

export interface QRReservation {
  id: number
  store_id: number
  customer_id: number
  treatment_course_id: number
  staff_id: number
  booth_id: number
  start_at: number          // Unix ms
  end_at: number            // Unix ms
  request: string
  deleted: boolean
  rid: string
  is_new_customer_flag: boolean
  nominated_staff_id: number | null
  Customer: {
    id: number
    name: string
    name_kana: string
    phone1: string
    mail1: string
    remarks1: string
    visits_number_cache: number
    is_existing_customer: boolean
  }
  Staff: {
    id: number
    name: string
    name_kana: string
  }
  TreatmentCourse: {
    id: number
    name: string
    duration: number        // ms
    price: number
    treatment_category_id: number
  }
}

export interface QRStaff {
  id: number
  name: string
  name_kana: string
}

interface QRSession {
  token: string
  cookies: string
}

/**
 * Log into Quick Reserve console and get session.
 */
export async function qrLogin(username: string, password: string): Promise<QRSession> {
  const res = await fetch(`${QR_API_BASE}/la-estro/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_id: username, password }),
  })

  if (!res.ok) {
    throw new Error(`QR login failed: ${res.status} ${res.statusText}`)
  }

  // Session is cookie-based
  const cookies = res.headers.get('set-cookie') ?? ''
  let token = ''

  try {
    const data = await res.json()
    token = data.token ?? data.access_token ?? data.jwt ?? ''
  } catch {
    // Token might be in cookies only
  }

  return { token, cookies }
}

function qrHeaders(session: QRSession): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session.token) h['Authorization'] = `Bearer ${session.token}`
  if (session.cookies) h['Cookie'] = session.cookies
  return h
}

/**
 * Fetch reservations for a date. The endpoint returns full objects
 * with nested Customer, Staff, and TreatmentCourse.
 */
export async function qrGetReservations(
  session: QRSession,
  storeSlug: string,
  storeId: number,
  date: string, // YYYY-MM-DD
): Promise<QRReservation[]> {
  const headers = qrHeaders(session)

  // Convert date to unix ms for start/end of day in JST
  const dayStart = new Date(`${date}T00:00:00+09:00`).getTime()
  const dayEnd = new Date(`${date}T23:59:59+09:00`).getTime()

  const url = `${QR_API_BASE}/${storeSlug}/${storeId}/get-customer-reservations-by-date`

  // Try with date string
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ date }),
  })

  console.log(`[QR] ${url} (date=${date}) → ${res.status}`)

  if (res.ok) {
    const data = await res.json()
    if (Array.isArray(data)) return data
    // 200 with a non-array body (error object / unexpected shape) — fall through
    // to the timestamp-format retry rather than treating it as an empty day.
    console.warn(`[QR] non-array 200 body (date=${date}); retrying with timestamp form`)
  }

  // Try with unix timestamp
  const res2 = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ date: dayStart }),
  })

  console.log(`[QR] ${url} (date=${dayStart}) → ${res2.status}`)

  if (res2.ok) {
    const data = await res2.json()
    if (Array.isArray(data)) return data
    // A non-array 200 on the retry too. Do NOT return [] — a silent "empty day"
    // would let the cancel-sweep treat a day's real bookings as cancelled and
    // wipe them. Throw so the caller skips the day (its rows are never swept).
    throw new Error(`QR get-reservations-by-date: non-array 200 body (date=${date})`)
  }

  const body = await res2.text().catch(() => '')
  throw new Error(`QR get-reservations-by-date failed: ${res.status} / ${res2.status} — ${body}`)
}

/**
 * Convert QR reservation to our appointment fields.
 */
export function mapReservation(r: QRReservation) {
  return {
    qrId: r.id,
    qrRid: r.rid,
    customerName: r.Customer.name,
    customerKana: r.Customer.name_kana,
    customerPhone: r.Customer.phone1,
    customerEmail: r.Customer.mail1,
    customerNotes: r.Customer.remarks1,
    customerVisits: r.Customer.visits_number_cache,
    isExistingCustomer: r.Customer.is_existing_customer,
    isNewCustomer: r.is_new_customer_flag || !r.Customer.is_existing_customer,
    staffName: r.Staff.name,
    staffQrId: r.Staff.id,
    nominatedStaffQrId: r.nominated_staff_id,
    treatmentName: r.TreatmentCourse.name,
    startTime: new Date(r.start_at).toISOString(),
    endTime: new Date(r.end_at).toISOString(),
    durationMinutes: Math.round((r.end_at - r.start_at) / 60000),
  }
}

const QR_GENDER: Record<number, 'male' | 'female' | null> = { 0: null, 1: 'male', 2: 'female' }

/** Map one raw QR reservation object to our customer_visits shape. */
export function mapVisit(r: {
  id: number; start_at: number; deleted: boolean; request?: string
  Bill: { BillItems?: { price_consumed?: number }[] } | null
  Staff?: { name?: string } | null
  TreatmentCourse?: { name?: string } | null
}) {
  const items = r.Bill?.BillItems ?? []
  return {
    qr_reservation_id: r.id,
    used_at: new Date(r.start_at).toISOString(),
    status: r.deleted ? 'cancelled' : r.Bill ? 'settled' : 'booked',
    course_name: r.TreatmentCourse?.name ?? null,
    sales_amount: items.reduce((s, i) => s + (i.price_consumed ?? 0), 0),
    staff_name: r.Staff?.name ?? null,
    treatment_comment: r.request || null,
  }
}

/** Map the nested QR Customer object to our extended customer fields. */
export function mapDeepCustomer(c: {
  gender?: number; born_at?: number | null; profession?: string; membership_id?: string
  post_code?: string; prefecture?: string; address1?: string; phone2?: string
  direct_mail?: boolean; comment?: string; remarks2?: string; postpaid_remaining_cache?: number
  has_ticket_pack?: boolean; last_visit_at_cache?: number | null; visits_number_cache?: number
  is_existing_customer?: boolean
}) {
  return {
    gender: c.gender != null ? QR_GENDER[c.gender] ?? null : null,
    date_of_birth: c.born_at ? new Date(c.born_at).toISOString().slice(0, 10) : null,
    occupation: c.profession || null,
    member_number: c.membership_id || null,
    postal_code: c.post_code || null,
    prefecture: c.prefecture || null,
    address: c.address1 || null,
    phone2: c.phone2 || null,
    dm_opt_in: !!c.direct_mail,
    comment: c.comment || null,
    remarks2: c.remarks2 || null,
    installment_outstanding: c.postpaid_remaining_cache ?? 0,
    has_ticket_pack: !!c.has_ticket_pack,
    last_visit_at: c.last_visit_at_cache ? new Date(c.last_visit_at_cache).toISOString() : null,
    visit_count: c.visits_number_cache ?? 0,
    is_existing_customer: !!c.is_existing_customer,
  }
}

export async function qrGetCustomerReservationsByCustomerId(
  session: QRSession, storeSlug: string, storeId: number, customerId: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const res = await fetch(`${QR_API_BASE}/${storeSlug}/${storeId}/get-customer-reservations-by-customer-id`,
    { method: 'POST', headers: qrHeaders(session), body: JSON.stringify({ customer_id: customerId }) })
  if (!res.ok) throw new Error(`QR reservations-by-customer ${customerId}: ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export async function qrGetCustomersServerSide(
  session: QRSession, storeSlug: string, storeId: number, page: number, pageSize = 100,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ count: number; rows: any[] }> {
  // QR's verified contract: filters + 0-indexed pagination.{page,pageSize} + sorts;
  // response is { count, rows: Customer[] } where each row is the full Customer object.
  const res = await fetch(`${QR_API_BASE}/${storeSlug}/${storeId}/get-customers-server-side`, {
    method: 'POST',
    headers: qrHeaders(session),
    body: JSON.stringify({
      filters: [
        { field: 'store_id', operator: 'in', value: [storeId] },
        { field: 'deleted', operator: 'eq', value: false },
      ],
      pagination: { page, pageSize },
      sorts: [],
    }),
  })
  if (!res.ok) throw new Error(`QR customers-server-side p${page}: ${res.status}`)
  const data = await res.json()
  return { count: data.count ?? 0, rows: Array.isArray(data.rows) ? data.rows : [] }
}
