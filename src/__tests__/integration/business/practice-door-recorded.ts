/**
 * THE RECORDED ANSWER SET for the practice door (PKT-PR2 §7). Rows are shaped by
 * the SDK types (derived through core-reach, never an SDK import) with the uuids
 * of READBACK-DEV-SALON-2026-09-19.md §1–§3 and MANIFEST-DEV-SALON.md verbatim.
 * No network: every ON proof — the jest suite and the mounted harness outside the
 * repo — reads THIS one copy. The mock honours the filters core honours
 * (store_id, active, from ≥ / to <, status, page / page_size).
 */

import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import { appointments, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { fixtureIdOf, liveIdOf } from '@/business/lib/practice-door/registry'

type Staff = Awaited<ReturnType<CoreReads['staffList']>>['staff'][number]
type Store = Awaited<ReturnType<CoreReads['storesList']>>['stores'][number]
type Sheet = Awaited<ReturnType<CoreReads['answerSheet']>>
type Menu = Awaited<ReturnType<CoreReads['menusList']>>['menus'][number]
type Customer = Awaited<ReturnType<CoreReads['customersList']>>['customers'][number]
type Appointment = Awaited<ReturnType<CoreReads['appointmentsList']>>['appointments'][number]
type Visit = Awaited<ReturnType<CoreReads['customerVisits']>>['visits'][number]

export const TENANT = 'fb44dd68-4af7-44b0-8cc7-4ee10c54491d'
export const STORE = {
  devSalon: '5a171878-4faa-4512-ba07-17ca4e20ab9e',
  devGinza: 'a1a26517-33c0-4e73-9ea2-e56e98d99c6f',
  tokyo: 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f',
  yokohama: '8ac43a4b-7763-4a10-9f73-a662085460af',
  laEstro: '8696b856-11ab-4879-9290-bef40b03ea66',
  // ⚖ §v11 — the two stores whose own hours broke the board (CENSUS-S18 § A).
  gym: 'c33e4c43-bc3b-4470-ac22-aa60fecdabe3',
  jiyugaoka: '0e8fd5dd-8da6-48c4-9ad2-2ab305aa907c',
  closed: '00000000-0000-4000-8000-00000000dead',
} as const
export const LOGIN = { owner: 'owner-login-uuid', probe: 'probe-login-uuid', goro: 'goro-login-uuid', musubi: 'musubi-login-uuid', perry: 'perry-login-uuid', azusa: 'azusa-login-uuid', saburo: 'saburo-login-uuid' } as const
export const CARD = {
  owner: 'da7ccca7-8706-4e3f-bb07-ce2300fbc799',
  saburo: '875f0912-9e21-42d0-9f22-673bed198d88',
  probe: 'b89b95cf-2365-4652-b8f4-d9235cabc8f9',
  perry: 'b61de85f-c873-4231-ad03-70d211e8b32f',
  mio: '75e26903-953c-4e74-bc6b-ec791b5e82f1',
  azusa: 'd27c76c4-eda7-4b12-9491-4eb6d9edaee5',
  goro: '6279b2a0-7f01-4d7b-8644-2f1ce127c947',
  musubi: '00000000-0000-4000-8000-0000000000c9',
  inactive: '00000000-0000-4000-8000-0000000000ca',
} as const
/** ⚖ §v11 PR-B — テスト恵比寿ジム's five, as the live probe read them 9/27 (DIAGNOSIS C3): uuids + names from
 *  evidence/board-broken-2026-09-27/blocks-ebisu-1440.json (`lanes[].key` / `label`), roles from the recipe
 *  (scripts/test-world/recipes/personal_gym.ts: the coaches STYLIST, こはる ASSISTANT). By uuid they seat
 *  だいち←p-01 · りな←p-02 · こはる←c-03 · けんた←p-04 · なつみ←p-05, as production does. */
export const GYM = {
  daichi: '3c7ecb3b-24f6-413b-8292-5b9d5292e511',
  rina: '51971c2d-db2e-4c2f-ae84-8a8da95cbd9c',
  koharu: '8a387e8c-d691-41d8-bf6c-7919ae577822',
  kenta: '8dd49f39-7ae7-4464-b2f7-f2d0cf7f5461',
  natsumi: 'f6adba7d-e8e3-4173-a7db-d8271ef4604c',
} as const

const T0 = '2026-09-15T05:00:00Z'
const stamp = { created_at: T0, updated_at: T0 }

/** SDK 1.36 (#1080) adds `Store.photo_url` and 17 StoreBookingPolicy dials. They enter the rows through two SEPARATELY
 *  declared objects spread into every recorded literal (STORE_136_FIELDS here, POLICY_136_FIELDS below): TypeScript's
 *  excess-property check does not reach spread members, so the same rows compile on 1.34 (names not in the type) and on
 *  1.36 (names required, supplied, each value checked against the SDK's own type). Values READ LIVE 2026-09-28T07:14:14Z
 *  (GET only — stores.list · storePolicies.get, behind the Dev Salon guard): photo_url is null at all seven stores. */
const STORE_136_FIELDS: { photo_url: string | null } = { photo_url: null }
const store = (id: string, name: string, is_primary: boolean, active = true): Store =>
  ({ id, business_id: TENANT, name, address: null, phone: null, is_primary, active, ...stamp, ...STORE_136_FIELDS })
export const STORES: Store[] = [
  store(STORE.devSalon, 'Dev Salon', true),
  store(STORE.devGinza, 'Dev 銀座', false),
  store(STORE.tokyo, 'テスト東京店', false),
  store(STORE.yokohama, 'テスト横浜店', false),
  store(STORE.laEstro, 'La Estro Test Store', false),
  store(STORE.gym, 'テスト恵比寿ジム', false),
  store(STORE.jiyugaoka, 'テスト自由が丘店', false),
  store(STORE.closed, '閉店テスト', false, false), // inactive: must never appear
]

const card = (id: string, name: string, role: Staff['role'], email: string | null, user_id: string | null = null, is_active = true): Staff =>
  ({ id, business_id: TENANT, user_id, name, name_kana: null, email, role, is_active, avatar_url: null, ...stamp })
/** READBACK §2's 15 rows, in its order; user_id only where the packet names a login. */
export const STAFF: Staff[] = [
  card(CARD.owner, 'Dev Salon', 'OWNER', 'dev@karute.test', LOGIN.owner),
  card('b89b95cf-2365-4652-b8f4-d9235cabc8f9', 'Invite Probe 0817', 'STYLIST', 'invite-probe-0817@karute.test', LOGIN.probe),
  card('b61de85f-c873-4231-ad03-70d211e8b32f', 'perry', 'STYLIST', 'jon@kim.com', LOGIN.perry),
  card('52157c64-f2d4-41c3-9396-47046d20db07', 'yes', 'STYLIST', 'yes@yes.com'),
  card(CARD.saburo, 'テスト さぶろう', 'STYLIST', null, LOGIN.saburo),
  card('75e26903-953c-4e74-bc6b-ec791b5e82f1', 'テスト みお', 'STYLIST', null),
  card(CARD.azusa, '見本 あずさ', 'STYLIST', 'azusa@test.invalid', LOGIN.azusa),
  card('36fddcba-258a-4497-846a-bca901ee0aa3', '見本 かい', 'STYLIST', null),
  card(CARD.goro, '見本 ごろう', 'STYLIST', 'goro@test.invalid', LOGIN.goro),
  card('00a86dcc-1204-4438-b295-e20861f3a137', '見本 しろう', 'STYLIST', 'shiro@test.invalid'),
  card('17af2de2-c716-425d-9bd4-ea9a6b445aee', '見本 たろう', 'STYLIST', 'taro@test.invalid'),
  card('088f928a-552b-4068-8ecc-9bc2d9d19cd7', '見本 はなこ', 'STYLIST', 'hanako@test.invalid'),
  card('ff708849-6ed2-4dca-90ae-a7fe2f4ac961', '見本 みらい', 'ASSISTANT', 'mirai@test.invalid'),
  card('0df861fd-c8c5-4772-b226-22f8fa89417f', '見本 ゆうと', 'STYLIST', null),
  card('1b11388c-b441-4eb7-acf8-5b068a3aba6f', '見本 れいな', 'STYLIST', null),
  card(CARD.musubi, '見本 むすび', 'STYLIST', null, LOGIN.musubi), // controlled extra: no assignments row
  card(CARD.inactive, 'inactive card', 'STYLIST', null, null, false), // inactive: must be excluded
  // ⚖ §v11 PR-B — the gym's own five (see GYM).
  card(GYM.daichi, '見本 だいち', 'STYLIST', null), card(GYM.rina, 'テスト りな', 'STYLIST', null), card(GYM.koharu, 'テスト こはる', 'ASSISTANT', null),
  card(GYM.kenta, '見本 けんた', 'STYLIST', null), card(GYM.natsumi, '見本 なつみ', 'STYLIST', null),
]

/** READBACK §2's "store assignment" column — the live truth (さぶろう works BOTH
 *  stores; the manifest's 'floating' label is not trusted). ⚖ §v11 PR-B — むすび (the controlled extra production does
 *  not have) works every recorded store BUT the gym, whose roster is production's five; the floating path is kept by
 *  the suites that assert it, with むすび's row taken out. */
export const ASSIGNMENTS: Record<string, string[]> = {
  [CARD.owner]: [STORE.devSalon],
  'b89b95cf-2365-4652-b8f4-d9235cabc8f9': [STORE.devSalon],
  'b61de85f-c873-4231-ad03-70d211e8b32f': [STORE.devSalon],
  '52157c64-f2d4-41c3-9396-47046d20db07': [STORE.devSalon],
  [CARD.saburo]: [STORE.tokyo, STORE.yokohama],
  '75e26903-953c-4e74-bc6b-ec791b5e82f1': [STORE.laEstro],
  'd27c76c4-eda7-4b12-9491-4eb6d9edaee5': [STORE.tokyo],
  '36fddcba-258a-4497-846a-bca901ee0aa3': [STORE.laEstro],
  [CARD.goro]: [STORE.yokohama, STORE.tokyo],
  '00a86dcc-1204-4438-b295-e20861f3a137': [STORE.tokyo],
  '17af2de2-c716-425d-9bd4-ea9a6b445aee': [STORE.yokohama],
  '088f928a-552b-4068-8ecc-9bc2d9d19cd7': [STORE.tokyo],
  'ff708849-6ed2-4dca-90ae-a7fe2f4ac961': [STORE.tokyo],
  '0df861fd-c8c5-4772-b226-22f8fa89417f': [STORE.laEstro],
  '1b11388c-b441-4eb7-acf8-5b068a3aba6f': [STORE.laEstro],
  [CARD.musubi]: [STORE.devSalon, STORE.devGinza, STORE.tokyo, STORE.yokohama, STORE.laEstro, STORE.jiyugaoka],
  ...Object.fromEntries(Object.values(GYM).map((id) => [id, [STORE.gym]])),
}

// The owner's 18 (READBACK §3: 18, incl. stores.viewAll). Names are the app's own
// capability vocabulary (src/lib/auth/permissions.ts); the door reads only viewAll.
const OWNER_CAPS = [
  'billing.manage', 'business.manage', 'staff.invite', 'staff.manage', 'settings.manage', 'menus.manage',
  'audit.view', 'sync.view', 'data.export', 'records.delete', 'records.reassign', 'records.discardView',
  'records.write', 'recordings.viewAll', 'recordings.viewShared', 'analytics.viewAll', 'stores.viewAll', 'customers.view',
]
const sheet = (staff_id: string, role: Sheet['role'], coarse_role: Sheet['coarse_role'], capabilities: string[], visible_store_ids: string[] | null): Sheet =>
  ({ staff_id, role, coarse_role, capabilities, visible_store_ids, money_scope: null, version: '1.1' })
export const SHEETS: Record<string, Sheet> = {
  [CARD.owner]: sheet(CARD.owner, 'owner', 'OWNER', OWNER_CAPS, null),
  [CARD.goro]: sheet(CARD.goro, 'manager', 'ADMIN', ['customers.view', 'bookings.manage'], [STORE.tokyo, STORE.yokohama]),
  [CARD.musubi]: sheet(CARD.musubi, 'practitioner', 'STYLIST', ['customers.view'], null), // the F-2 case
  // Role-label cases (the Business vocabulary): a practitioner and a frontdesk, each on Dev Salon.
  [CARD.perry]: sheet(CARD.perry, 'practitioner', 'STYLIST', ['customers.view', 'bookings.manage'], [STORE.devSalon]),
  // 見本 あずさ — the twin of the fixture operator p-06: her SAMPLE rows are p-06's.
  [CARD.azusa]: sheet(CARD.azusa, 'practitioner', 'STYLIST', ['customers.view', 'records.write'], [STORE.tokyo]),
  // テスト さぶろう — twin c-03, NO email: only the twin reaches his card (the email tier cannot).
  [CARD.saburo]: sheet(CARD.saburo, 'practitioner', 'STYLIST', ['customers.view', 'records.write'], [STORE.tokyo, STORE.yokohama]),
  [CARD.probe]: sheet(CARD.probe, 'frontdesk', 'ASSISTANT', ['customers.view'], [STORE.devSalon]),
}

const menu = (id: string, store_id: string | null, name: string, price: number, duration_minutes: number, active = true): Menu => ({
  id, business_id: TENANT, store_id, name, description: null, category: null, category_display_order: 0, display_order: 0,
  duration_minutes, price_list_amount: price, price_min_amount: null, currency: 'JPY', tax_included: true,
  nomination_allowed: true, online_visible: true, active, required_room_class: null, required_qualification_id: null, ...stamp,
})
export const MENU = {
  seitai: 'd2884903-7410-4513-b0ef-34586d4522b8',
  kotsuban: '8161483d-0aaa-4465-bac1-710c15f0e2fd',
  stretch: 'f94116ad-8c1e-4555-bf5f-fb78cd319fea',
  shinso: 'aaf7a87f-b440-4617-bbb6-d6a0efb1fae3',
  head: '63a813de-459b-44be-93b4-eae36f24c478',
  zenten: '6b0fe7e1-755d-45c3-9a84-4ac49b6f3375',
  body: '2f1b495b-c916-4dce-8341-ecf390d50c1f',
  inactive: '00000000-0000-4000-8000-0000000000e1',
} as const
export const MENUS: Menu[] = [
  menu(MENU.seitai, STORE.tokyo, 'テスト整体 60分', 6600, 60),
  menu(MENU.kotsuban, STORE.tokyo, 'テスト骨盤ケア 90分', 12100, 90),
  menu(MENU.stretch, STORE.tokyo, 'テストストレッチ 30分', 4400, 30),
  menu(MENU.shinso, STORE.yokohama, 'テスト深層ケア 120分', 14300, 120),
  menu(MENU.head, STORE.yokohama, 'テストヘッドケア 45分', 5500, 45),
  menu(MENU.zenten, null, '見本 全店舗メニュー', 3300, 20),
  menu(MENU.inactive, STORE.tokyo, 'inactive menu', 1000, 10, false), // inactive: never listed
  menu(MENU.body, STORE.laEstro, '見本 ボディケア 60分', 8800, 60), // no twin
]

const customer = (id: string, name: string, member_number: string | null): Customer => ({
  id, business_id: TENANT, name, furigana: null, email: null, phone: null, date_of_birth: null, gender: null,
  guardian_customer_id: null, payer_note: null, occupation: null, member_number, postal_code: null, prefecture: null,
  address: null, phone2: null, dm_opt_in: false, comment: null, remarks2: null, total_sales: 0, installment_outstanding: 0,
  has_ticket_pack: false, first_visit_at: null, last_visit_at: null, locale: 'ja', notes: null, contact_info: null,
  assigned_staff_id: null, is_existing_customer: true, visit_count: 0, karute_number: null, ...stamp,
})
export const KOBAYASHI = '0bb0a261-b23b-4670-90d3-c72a3c1674d0'
export const AKARI = '6f771283-c430-48ad-9770-af2ce6848808'
export const CUSTOMERS: Customer[] = [
  customer(AKARI, '見本 あかり', 'C-3001'),
  customer('a01ed848-969e-4eb5-bfad-98b5530bb45b', '見本 いつき', 'C-3002'),
  customer('c4d42f7a-98d0-44bf-8650-d67b9042497d', '見本 うみ', 'C-3003'),
  customer('219d8e1b-658f-4ec8-960f-8c5db5815d79', 'テスト えいた', 'C-3004'),
  customer('f3b15433-b27f-443e-b937-ddc221fc3268', 'テスト おとは', 'C-3005'),
  customer('f46235be-82a9-4c2e-82e0-f1a7352e6fd3', '見本 かえる', 'C-3006'),
  customer('554c295d-8599-44b0-8394-790c40cfbfc6', '見本 きり', 'C-3007'),
  customer('2b9f210f-f802-492d-aa8c-a11cb6c6afa8', 'テスト くらら', 'C-3008'),
  customer('cd3dc1e0-dcc6-4554-a5f9-a311863375cc', '見本 あかり', 'C-3009'),
  customer('3f15f192-c01c-4cf2-9cf0-f9d57e3a39d6', 'テスト かなで', 'C-3010'),
  customer('5ceaf877-b779-45b9-ad3e-efaffe4cefe3', '見本 さくら', 'C-3011'),
  customer('12953e0a-e638-430f-8d96-7862daac6ec0', '見本 そら', 'C-3801'),
  customer('65fda38c-0c7b-47ff-8e2e-48d43a48ef0c', 'テスト なぎ', 'C-3802'),
  customer(KOBAYASHI, '小林 あや', null), // unseeded (READBACK §5)
]

/** Core's event-derived store membership, restated over the seeded world (fold 1):
 *  a twin customer belongs to a practice store when the fixture world books them at
 *  that store's twin fixture store. DERIVED here, never hand-listed; La Estro holds
 *  the one unseeded customer; the Dev stores hold nobody. */
export function membership(storeId: string): string[] {
  const twinOf: Record<string, string> = { [STORE.tokyo]: STORE_A, [STORE.yokohama]: STORE_B }
  if (storeId === STORE.laEstro) return [KOBAYASHI]
  // ⚖ §v11 (Greptile P2) — the gym and 自由が丘 twin no fixture store: their members are the customers their own recorded bookings name.
  if (storeId === STORE.gym || storeId === STORE.jiyugaoka) return [...new Set(APPOINTMENTS.filter((a) => a.store_id === storeId && a.kind === 'BOOKING').map((a) => a.customer_id!))]
  const fixtureStore = twinOf[storeId]
  if (!fixtureStore) return []
  const ids = new Set(
    appointments(new Date()).filter((a) => a.store_id === fixtureStore).map((a) => liveIdOf('customers', a.customer_id)),
  )
  // ⚖ §v11 PR-B — …and the no-twin customers its own recorded bookings name (東京's two live C6 rows).
  for (const a of APPOINTMENTS) if (a.store_id === storeId && a.customer_id !== null && fixtureIdOf('customers', a.customer_id) === null) ids.add(a.customer_id)
  return CUSTOMERS.filter((c) => ids.has(c.id)).map((c) => c.id)
}

const jst = (ymdhm: string): string => new Date(`${ymdhm}:00+09:00`).toISOString()
const plus = (iso: string, min: number): string => new Date(Date.parse(iso) + min * 60_000).toISOString()
const booking = (
  id: string, starts: string, customer_id: string | null, staff_id: string | null, store_id: string | null, menu_id: string | null,
  minutes: number, price: number, status: Appointment['status'], extra: Partial<Appointment> = {},
): Appointment => {
  const starts_at = jst(starts)
  return {
    id, business_id: TENANT, customer_id, staff_id, kind: 'BOOKING', store_id, starts_at, ends_at: plus(starts_at, minutes),
    duration_minutes: minutes, title: null, notes: null, menu_id, resource_id: null, occupied_until: null,
    booked_price_amount: price, booked_price_currency: 'JPY', status, source: 'MANUAL', external_refs: {}, cancelled_at: null,
    status_source: 'STAFF', status_set_by: null, status_reason: null, status_set_at: null, rebooked_from_appointment_id: null,
    ...stamp, ...extra,
  }
}
const S = { hanako: '088f928a-552b-4068-8ecc-9bc2d9d19cd7', taro: '17af2de2-c716-425d-9bd4-ea9a6b445aee', azusa: 'd27c76c4-eda7-4b12-9491-4eb6d9edaee5', mio: '75e26903-953c-4e74-bc6b-ec791b5e82f1' }
const C = { itsuki: 'a01ed848-969e-4eb5-bfad-98b5530bb45b', umi: 'c4d42f7a-98d0-44bf-8650-d67b9042497d', eita: '219d8e1b-658f-4ec8-960f-8c5db5815d79', kaeru: 'f46235be-82a9-4c2e-82e0-f1a7352e6fd3', kiri: '554c295d-8599-44b0-8394-790c40cfbfc6', kurara: '2b9f210f-f802-492d-aa8c-a11cb6c6afa8', nagi: '65fda38c-0c7b-47ff-8e2e-48d43a48ef0c' }
export const APT = {
  a01: '19337574-cc07-43f7-96b6-60531d04eb1c',
  a03: '6130237f-d992-4446-a23c-b52e9da94b45',
  a05: '0e2d1a07-fe38-4912-acf8-09be58d4019e',
  a09: '0d3e1333-87fb-453a-ab37-5035767fd8c6',
  a13: '2fba5792-eb22-4875-8dc6-c880dfb33288',
  a14: '1bc1c829-e755-49f5-a2e0-ee7e7ee86101',
  a16: '2967fdf4-27ea-46b1-945c-3c3a6a3ffff5',
  a25: '7ee1cc23-08e0-4686-a48a-f2dad9e97a05',
  a34: '6e1fca00-a4e3-4d3a-9ee1-5625b81d1709',
  a35: 'b0c3212a-7bed-4830-a8e6-9b7c0002c7ee',
  laEstro: '3e48d4f5-855c-424a-8832-9be0ef3dbd4b',
  nullStore: '00000000-0000-4000-8000-0000000000a1',
  blockUntitled: '00000000-0000-4000-8000-0000000000b1',
  blockMidnight: '00000000-0000-4000-8000-0000000000b2',
  blockTwoNights: '00000000-0000-4000-8000-0000000000b3',
  blockOvernightBefore: '00000000-0000-4000-8000-0000000000b4',
  blockNullStore: '00000000-0000-4000-8000-0000000000b5',
  blockBackwards: '00000000-0000-4000-8000-0000000000b6',
  inactiveStore: '00000000-0000-4000-8000-0000000000a2',
} as const
export const APPOINTMENTS: Appointment[] = [
  booking(APT.a01, '2026-09-07T10:00', AKARI, S.hanako, STORE.tokyo, MENU.seitai, 60, 6600, 'COMPLETED'),
  booking(APT.a03, '2026-09-11T13:00', C.eita, CARD.goro, STORE.yokohama, MENU.head, 45, 5500, 'SCHEDULED'),
  booking(APT.a05, '2026-08-31T16:00', C.kaeru, CARD.saburo, STORE.tokyo, MENU.kotsuban, 90, 12100, 'CANCELLED'),
  booking(APT.a09, '2026-09-14T14:05', C.kiri, CARD.goro, STORE.tokyo, MENU.zenten, 20, 3300, 'NO_SHOW'),
  booking(APT.a13, '2026-09-14T11:00', C.umi, S.taro, STORE.yokohama, MENU.head, 45, 5500, 'IN_PROGRESS'),
  booking(APT.a14, '2026-09-14T13:00', C.kaeru, CARD.saburo, STORE.tokyo, MENU.kotsuban, 90, 12100, 'SCHEDULED', { updated_at: '2026-09-15T06:30:00Z' }),
  booking(APT.a16, '2026-09-16T14:00', C.eita, CARD.goro, STORE.yokohama, MENU.shinso, 120, 14300, 'SCHEDULED'),
  booking(APT.a25, '2026-09-14T11:00', C.eita, CARD.goro, STORE.tokyo, MENU.seitai, 60, 6600, 'SCHEDULED'),
  booking(APT.a34, '2026-09-14T15:45', C.kurara, CARD.goro, STORE.yokohama, MENU.head, 45, 5500, 'SCHEDULED'),
  booking(APT.a35, '2026-09-04T11:00', C.nagi, S.azusa, STORE.tokyo, MENU.seitai, 60, 6600, 'SCHEDULED'),
  // Unseeded La Estro booking, priced in USD → booked_price null.
  booking(APT.laEstro, '2026-09-16T11:00', KOBAYASHI, S.mio, STORE.laEstro, MENU.body, 60, 88, 'SCHEDULED', { source: 'SYNQED_RESERVE', booked_price_currency: 'USD' }),
  booking(APT.nullStore, '2026-09-14T12:00', AKARI, S.hanako, null, null, 30, 3300, 'SCHEDULED'),
  // Two BLOCKs at 東京: one with no title, one crossing JST midnight (23:30 → 00:30).
  booking(APT.blockUntitled, '2026-09-14T12:00', null, CARD.saburo, STORE.tokyo, null, 30, 0, 'SCHEDULED',
    { kind: 'BLOCK', booked_price_amount: null, booked_price_currency: null }),
  booking(APT.blockMidnight, '2026-09-14T23:30', null, CARD.saburo, STORE.tokyo, null, 60, 0, 'SCHEDULED',
    { kind: 'BLOCK', title: 'recorded block', notes: 'recorded note', booked_price_amount: null, booked_price_currency: null }),
  // A BLOCK crossing TWO midnights (9/15 22:00 → 9/17 02:00 JST): three day pieces.
  booking(APT.blockTwoNights, '2026-09-15T22:00', null, CARD.saburo, STORE.tokyo, null, 28 * 60, 0, 'SCHEDULED',
    { kind: 'BLOCK', booked_price_amount: null, booked_price_currency: null }),
  // A BLOCK begun the day BEFORE 9/14 (9/13 23:30 → 9/14 00:30 JST): its 00:00–00:30 piece is 9/14's.
  booking(APT.blockOvernightBefore, '2026-09-13T23:30', null, CARD.saburo, STORE.tokyo, null, 60, 0, 'SCHEDULED',
    { kind: 'BLOCK', booked_price_amount: null, booked_price_currency: null }),
  // A null-store BLOCK (a bed hold no store owns): hidden under a store lens, '' under viewAll.
  booking(APT.blockNullStore, '2026-09-14T09:00', null, CARD.saburo, null, null, 30, 0, 'SCHEDULED',
    { kind: 'BLOCK', booked_price_amount: null, booked_price_currency: null }),
  // A booking at the INACTIVE store — never VISIBLE, so the door drops it even under the owner's viewAll.
  booking(APT.inactiveStore, '2026-09-14T15:00', AKARI, S.hanako, STORE.closed, MENU.seitai, 60, 6600, 'SCHEDULED'),
]

// ⚖ §v11 — the gym's and 自由が丘's days, INVENTED in this file's style at the starts and lengths the probe
// MEASURED live on 9/27 (DIAGNOSIS A1 · B1 · B4 · B6; blocks-ebisu-1440*.json), set on the recorded today (9/14)
// and tomorrow (9/15): outside the old shared 10–19 window, inside each store's own (07–22 · 10–20).
// Each booking's customer is its own recorded row (unseeded, no member number), named as the probe read the live card.
// ⚖ §v11 PR-B — each gym booking sits on the staff member the probe MEASURED it on (blocks-ebisu-1440*.json, DIAGNOSIS C1 · C5
// · E1), and the gym's day is production's whole day: + 山田 美穂 · 佐藤 直樹 · 伊藤 翼 (drawn 9/27, same file) and the
// three だいち rows E1 counted but the probe could not see (hidden by the 13:00 勤務不可): their COUNT and 「from 13:00」
// are measured, their times and customers (石井 · 中村 · 林) are INVENTED, on the planner's own anchors
// (scripts/test-world/plan.ts preferredStart: pm 14:30, eve 20:30); + 長谷川 恵 on tomorrow (blocks-ebisu-1440-day1.json).
const G = (n: number) => `00000000-0000-4000-8000-00000000cc${String(n).padStart(2, '0')}`
CUSTOMERS.push(...['松田 亜希子', '加藤 麻美', '清水 亮', '森 大樹', '近藤 雄一', '高橋 美穂', '井上 拓也', '小林 健太郎', '鈴木 拓海', '斎藤 美紀', '上田 彩',
  '山田 美穂', '佐藤 直樹', '伊藤 翼', '石井 陽介', '中村 早紀', '林 大輔', '長谷川 恵', '後藤 大輔', '青木 修']
  .map((name, i) => customer(G(i + 1), name, null)))
const gymDay = (n: number, starts: string, minutes: number, price: number, staff: string) =>
  booking(`00000000-0000-4000-8000-00000000c3${String(n).padStart(2, '0')}`, starts, G(n), staff, STORE.gym, MENU.zenten, minutes, price, 'SCHEDULED')
APPOINTMENTS.push(
  gymDay(1, '2026-09-14T07:00', 30, 6600, GYM.daichi), gymDay(2, '2026-09-14T07:00', 60, 11000, GYM.natsumi), gymDay(3, '2026-09-14T13:00', 75, 11000, GYM.kenta),
  gymDay(4, '2026-09-14T18:30', 90, 16500, GYM.kenta), gymDay(5, '2026-09-14T19:00', 60, 11000, GYM.natsumi), gymDay(6, '2026-09-14T20:30', 60, 11000, GYM.natsumi),
  gymDay(7, '2026-09-14T20:30', 60, 11000, GYM.kenta),
  gymDay(8, '2026-09-15T07:00', 30, 6600, GYM.kenta), gymDay(9, '2026-09-15T20:30', 60, 11000, GYM.kenta), gymDay(10, '2026-09-15T20:30', 60, 11000, GYM.natsumi),
  booking('00000000-0000-4000-8000-00000000e301', '2026-09-14T18:30', G(11), CARD.musubi, STORE.jiyugaoka, MENU.zenten, 60, 6600, 'SCHEDULED'),
  gymDay(12, '2026-09-14T12:00', 90, 16500, GYM.rina), gymDay(13, '2026-09-14T14:30', 60, 11000, GYM.rina), gymDay(14, '2026-09-14T14:30', 75, 11000, GYM.kenta),
  gymDay(15, '2026-09-14T14:30', 60, 11000, GYM.daichi), gymDay(16, '2026-09-14T17:00', 60, 11000, GYM.daichi), gymDay(17, '2026-09-14T20:30', 60, 11000, GYM.daichi),
  gymDay(18, '2026-09-15T14:30', 30, 6600, GYM.daichi),
  // ⚖ §v11 PR-B (DIAGNOSIS C6) — テスト東京店's two live rows the sample day contradicted, ids + times + people from the AFTER
  // probe (evidence/board-fix/pr-a/after-results.json): 後藤 大輔 16:30–17:30 on ごろう (past his 17:00 終業) · 青木 修
  // 10:00–11:00 on みらい (no sample shift at all).
  booking('388e5229-8c55-4431-a046-22d3381222b1', '2026-09-14T16:30', G(19), CARD.goro, STORE.tokyo, MENU.seitai, 60, 6600, 'SCHEDULED'),
  booking('cc1b09bb-9d0f-4373-8237-672cd5f3f056', '2026-09-14T10:00', G(20), 'ff708849-6ed2-4dca-90ae-a7fe2f4ac961', STORE.tokyo, MENU.seitai, 60, 6600, 'SCHEDULED'),
)

type Policy = Awaited<ReturnType<CoreReads['storePolicyGet']>>
/** SDK 1.36's 17 new StoreBookingPolicy dials — the shape its types.d.ts declares, restated because 1.34 has no such
 *  names (why a spread: STORE_136_FIELDS). READ LIVE 2026-09-28T07:14:14Z, identical at all seven recorded stores
 *  (default- and custom-source alike). */
type Policy136Fields = {
  override_roles: string[]; override_locked_out: string[]; override_hold_to_confirm: boolean; override_strict_wall: boolean
  min_sellable_min: number; gap_fill_min_min: number | null; held_rank_access: 'closed' | 'silver' | 'gold' | 'platinum'
  release_held_roles: string[]; booking_step_min: number; block_step_min: number; gap_fill_discount_pct: number | null
  lead_time_min: number | null; reserve_start_grid_min: 15 | 30 | 60 | null; standard_session_min: number | null
  price_lock_during_recalc: boolean | null; breaks_paid: boolean; special_open_days: { date: string; open: string; close: string }[]
}
const POLICY_136_FIELDS: Policy136Fields = {
  override_roles: ['オーナー', '店舗管理者', 'スタッフ'], override_locked_out: [], override_hold_to_confirm: true, override_strict_wall: false,
  min_sellable_min: 30, gap_fill_min_min: null, held_rank_access: 'closed', release_held_roles: ['オーナー', '店舗管理者'],
  booking_step_min: 30, block_step_min: 15, gap_fill_discount_pct: null, lead_time_min: null, reserve_start_grid_min: null,
  standard_session_min: null, price_lock_during_recalc: null, breaks_paid: false, special_open_days: [],
}
/** ⚖ §v11 — core's store policies as READ LIVE 2026-09-27T05:47:19Z (14:47 JST, CENSUS-S18.md § A):
 *  weekly_hours · source · updated_at verbatim. The census read no other dial, so those carry neutral
 *  values the door never reads — except the 1.36 dials, READ LIVE 9/28 (POLICY_136_FIELDS). */
const policy = (store_id: string, source: Policy['source'], updated_at: string | null, weekly_hours: Policy['weekly_hours']): Policy => ({
  store_id, booking_open_days: 0, cutoff_minutes: 0, cancel_free_until_hours: 0, cancel_late_pct: 0, no_show_pct: 0,
  gap_guard_mode: 'OFF', new_client_session_minutes: 60, weekly_hours, source, updated_by: null, updated_at, ...POLICY_136_FIELDS,
})
const every = (open: string, close: string, tue: { open: string; close: string } | null = { open, close }) =>
  ({ mon: { open, close }, tue, wed: { open, close }, thu: { open, close }, fri: { open, close }, sat: { open, close }, sun: { open, close } })
export const POLICIES: Record<string, Policy> = {
  [STORE.tokyo]: policy(STORE.tokyo, 'custom', '2026-09-23T23:07:53Z', every('10:00', '19:00', null)),
  [STORE.gym]: policy(STORE.gym, 'custom', '2026-09-24T14:44:56Z', every('07:00', '22:00')),
  [STORE.jiyugaoka]: policy(STORE.jiyugaoka, 'custom', '2026-09-24T14:57:02Z', every('10:00', '20:00', null)),
  [STORE.yokohama]: policy(STORE.yokohama, 'default', null, null),
  [STORE.laEstro]: policy(STORE.laEstro, 'custom', '2026-09-15T22:30:33Z', null),
  [STORE.devSalon]: policy(STORE.devSalon, 'default', null, null),
  [STORE.devGinza]: policy(STORE.devGinza, 'default', null, null),
}

/** 9/14 12:00 → 11:00 JST: ends before it starts (opt-in via `backwardsBlock`). */
const BACKWARDS_BLOCK: Appointment = {
  ...booking(APT.blockBackwards, '2026-09-14T12:00', null, CARD.saburo, STORE.tokyo, null, 30, 0, 'SCHEDULED',
    { kind: 'BLOCK', booked_price_amount: null, booked_price_currency: null }),
  ends_at: jst('2026-09-14T11:00'),
}

/** ⚖ §v11 V11-15(i) (PR-C) — 9/14 22:30–23:15 JST at テスト恵比寿ジム (07:00–22:00), wholly after close, on りな (already on
 *  the gym's roster — no person added) for a customer the gym already holds. Opt-in via `outOfHours`, never in the
 *  default world, so V11-6 P1 over the default world stays as it is. */
const OUT_OF_HOURS = [
  booking('00000000-0000-4000-8000-00000000c399', '2026-09-14T22:30', G(12), GYM.rina, STORE.gym, MENU.zenten, 45, 11000, 'SCHEDULED'),
  // ⚖ amendment B2 — and one on a 'sample' store (テスト横浜店, no hours in core): 19:30–20:15 on たろう for うみ.
  booking('00000000-0000-4000-8000-00000000c398', '2026-09-14T19:30', C.umi, S.taro, STORE.yokohama, MENU.head, 45, 5500, 'SCHEDULED'),
]

const visit = (id: string, store_id: string | null, used_at: string, sales_amount: number): Visit => ({
  id, customer_id: AKARI, store_id, qr_reservation_id: 1, used_at, status: 'visited', course_name: null, sales_amount, staff_name: null, treatment_comment: null,
})
export const VISITS: Record<string, Visit[]> = {
  [AKARI]: [
    visit('00000000-0000-4000-8000-0000000000f1', STORE.tokyo, '2026-09-07T01:00:00.000Z', 6600),
    visit('00000000-0000-4000-8000-0000000000f2', null, '2026-09-01T01:00:00.000Z', 3300),
  ],
}

export interface RecordedOptions {
  /** Force every paged read to this many rows per page (the paging proof). */
  forcePageSize?: number
  /** staff.list claims 1000 rows but returns 3 per page forever (the 50-page cap). */
  runawayStaff?: boolean
  /** orgSettings.get's name; `null` → the whole record is null. */
  orgName?: string | null
  /** Every paged read reports this `total` (an under-reporting count). */
  lyingTotal?: number
  /** Adds a BLOCK whose ends_at is before its starts_at. */
  backwardsBlock?: boolean
  /** Adds a gym booking wholly after the gym's close + one after テスト横浜店's sample close (⚖ §v11 V11-15(i), B2). */
  outOfHours?: boolean
}

function paged<T>(rows: T[], q: { page?: number; page_size?: number } | undefined, force?: number) {
  const size = force ?? q?.page_size ?? 20
  const page = q?.page ?? 1
  return { rows: rows.slice((page - 1) * size, page * size), page, size }
}

/** The eleven bound reads, answering from the rows above. */
export function recordedReads(o: RecordedOptions = {}): CoreReads {
  return {
    storesList: async () => ({ stores: STORES }),
    staffList: async (q) => {
      if (o.runawayStaff) return { staff: STAFF.slice(0, 3), total: 1000, page: q?.page ?? 1, page_size: 3 }
      const p = paged(STAFF, q, o.forcePageSize)
      return { staff: p.rows, total: o.lyingTotal ?? STAFF.length, page: p.page, page_size: p.size }
    },
    staffStoresList: async () => ({ assignments: ASSIGNMENTS }),
    answerSheet: async (id) => {
      const s = SHEETS[id]
      if (!s) throw new Error(`recorded: no answer sheet for ${id}`)
      return s
    },
    menusList: async (q) => ({
      menus: MENUS.filter((m) => (q?.store_id === undefined || m.store_id === q.store_id) && (q?.active === undefined || m.active === q.active)),
    }),
    customersList: async (q) => {
      const rows = q?.store_id === undefined ? CUSTOMERS : CUSTOMERS.filter((c) => membership(q.store_id!).includes(c.id))
      const p = paged(rows, q, o.forcePageSize)
      const total = o.lyingTotal ?? rows.length
      return { customers: p.rows, total, page: p.page, page_size: p.size, total_pages: Math.ceil(total / p.size) }
    },
    customerVisits: async (id) => ({ visits: VISITS[id] ?? [] }),
    appointmentsList: async (q) => {
      const extra = [...(o.backwardsBlock ? [BACKWARDS_BLOCK] : []), ...(o.outOfHours ? OUT_OF_HOURS : [])]
      const rows = [...APPOINTMENTS, ...extra].filter(
        (a) =>
          (!q?.from || Date.parse(a.starts_at) >= Date.parse(q.from)) &&
          (!q?.to || Date.parse(a.starts_at) < Date.parse(q.to)) &&
          (!q?.store_id || a.store_id === q.store_id) &&
          (!q?.status || a.status === q.status),
      )
      const p = paged(rows, q, o.forcePageSize)
      return { appointments: p.rows, total: o.lyingTotal ?? rows.length, page: p.page, page_size: p.size }
    },
    orgSettingsGet: async () =>
      o.orgName === null ? null : { business_id: TENANT, name: o.orgName ?? 'Dev Salon', settings: {}, ...stamp },
    resourcesList: async () => ({ resources: [] }), // READBACK §5: 0 at every store
    storePolicyGet: async (id) => {
      const p = POLICIES[id]
      if (!p) throw new Error(`recorded: no store policy for ${id}`)
      return p
    },
  }
}
