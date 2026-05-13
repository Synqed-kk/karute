// Mock data for the booking page redesign.
// Matches the structure from synqed-karute-design-spike/src/mock/reservation.ts
//
// Real-data wiring: a synchronous XHR to /api/booking-spike/data tries to
// load actual staff + today's reservations from the running karute backend.
// If the user is logged in and the request succeeds, window.STAFF and
// window.RESERVATIONS_TODAY get replaced with real values (and a banner is
// set so the prototype can show "live data" provenance). On 401 / network
// failure / empty response the mock data below stays in place untouched.
(function tryLoadRealData() {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/booking-spike/data", false); // sync
    xhr.send();
    if (xhr.status !== 200) return;
    const payload = JSON.parse(xhr.responseText);
    window.__BOOKING_SPIKE_DATA_SOURCE = "live";
    window.__BOOKING_SPIKE_STAFF = payload.staff;
    window.__BOOKING_SPIKE_RESERVATIONS = payload.reservations;
    window.__BOOKING_SPIKE_TODAY_ISO = payload.todayIso;
    window.__BOOKING_SPIKE_CURRENT_TIME = payload.currentTime;
    window.__BOOKING_SPIKE_BUSINESS_HOURS = payload.businessHours;
  } catch (_err) {
    /* keep mocks */
  }
})();

window.STAFF = window.__BOOKING_SPIKE_STAFF || [
  { id: "s1", name: "Jon Chan", initials: "JC", role: "オーナー", takesBookings: false, colorKey: "blue" },
  { id: "s2", name: "佐藤 あかり", initials: "佐", role: "スタイリスト", takesBookings: true, colorKey: "violet" },
  { id: "s3", name: "中村 直美", initials: "中", role: "セラピスト", takesBookings: true, colorKey: "teal" },
];

window.BUSINESS_HOURS = window.__BOOKING_SPIKE_BUSINESS_HOURS || { start: 10, end: 20 };
window.CURRENT_TIME = window.__BOOKING_SPIKE_CURRENT_TIME || "14:25";
window.TODAY_ISO = window.__BOOKING_SPIKE_TODAY_ISO || "2026-04-18"; // Saturday

window.RESERVATIONS_TODAY = window.__BOOKING_SPIKE_RESERVATIONS || [
  { id: "r1", staffId: "s2", startTime: "10:00", duration: 60, customerName: "高橋 由美", customerInitials: "高", karute: "#00123", service: "フェイシャル・ベーシック", status: "完了", recordingConsent: true },
  { id: "r2", staffId: "s3", startTime: "11:30", duration: 90, customerName: "鈴木 優子", customerInitials: "鈴", karute: "#00116", service: "ボディケア・90分", status: "完了", recordingConsent: true },
  { id: "r3", staffId: "s2", startTime: "12:30", duration: 45, customerName: "斎藤 麗子", customerInitials: "斎", karute: "#00112", service: "ヘッドスパ", status: "完了", recordingConsent: true },
  { id: "r4", staffId: "s2", startTime: "14:00", duration: 60, customerName: "田中 美咲", customerInitials: "田", karute: "#00120", service: "フェイシャル・保湿強化", status: "施術中", recordingConsent: true },
  { id: "r5", staffId: "s3", startTime: "15:30", duration: 75, customerName: "小林 あや", customerInitials: "小", karute: null, service: "アロマトリートメント", status: "新規", recordingConsent: false, aiFlag: "初回カウンセリング要" },
  { id: "r6", staffId: "s2", startTime: "16:30", duration: 60, customerName: "山田 美月", customerInitials: "山", karute: "#00104", service: "フェイシャル・エイジングケア", status: "予約済", recordingConsent: true, aiFlag: "リマインド未送信" },
  { id: "r7", staffId: "s3", startTime: "17:30", duration: 90, customerName: "渡辺 知美", customerInitials: "渡", karute: "#00098", service: "ボディケア・90分", status: "予約済", recordingConsent: false, aiFlag: "前回キャンセル" },
];

// Synth deterministic-ish reservations for any other date in the week/month.
// Tiny seeded PRNG (mulberry32).
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const CUSTOMER_POOL = [
  { name: "高橋 由美", initials: "高", karute: "#00123" },
  { name: "鈴木 優子", initials: "鈴", karute: "#00116" },
  { name: "斎藤 麗子", initials: "斎", karute: "#00112" },
  { name: "田中 美咲", initials: "田", karute: "#00120" },
  { name: "小林 あや", initials: "小", karute: null },
  { name: "山田 美月", initials: "山", karute: "#00104" },
  { name: "渡辺 知美", initials: "渡", karute: "#00098" },
  { name: "木村 加奈", initials: "木", karute: "#00087" },
  { name: "伊藤 さくら", initials: "伊", karute: "#00076" },
  { name: "松本 千尋", initials: "松", karute: "#00065" },
  { name: "森 花子", initials: "森", karute: "#00054" },
  { name: "橋本 りえ", initials: "橋", karute: "#00043" },
  { name: "青木 翠", initials: "青", karute: null },
  { name: "岡田 直子", initials: "岡", karute: "#00032" },
];

const SERVICES = [
  { name: "フェイシャル・ベーシック", duration: 60 },
  { name: "フェイシャル・保湿強化", duration: 60 },
  { name: "フェイシャル・エイジングケア", duration: 75 },
  { name: "ボディケア・60分", duration: 60 },
  { name: "ボディケア・90分", duration: 90 },
  { name: "アロマトリートメント", duration: 75 },
  { name: "ヘッドスパ", duration: 45 },
];

const STATUSES_FUTURE = ["予約済", "新規", "未確定"];
const STATUSES_PAST = ["完了"];

function pad(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function generateForDate(date) {
  const iso = ymd(date);
  if (iso === window.TODAY_ISO) {
    return window.RESERVATIONS_TODAY.slice();
  }
  const today = new Date(window.TODAY_ISO);
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const isPast = target < today;

  const r = mulberry32(hashString(iso));
  const dow = date.getDay();
  // weekends busier, sundays a bit lighter
  let count;
  if (dow === 0) count = 4 + Math.floor(r() * 4);
  else if (dow === 6) count = 7 + Math.floor(r() * 4);
  else count = 3 + Math.floor(r() * 5);

  const reservations = [];
  let hour = 10;
  let minute = 0;
  for (let i = 0; i < count; i++) {
    if (hour >= 19) break;
    const customer = CUSTOMER_POOL[Math.floor(r() * CUSTOMER_POOL.length)];
    const service = SERVICES[Math.floor(r() * SERVICES.length)];
    const staffPool = window.STAFF.filter(s => s.takesBookings);
    const staff = staffPool[Math.floor(r() * staffPool.length)];
    const status = isPast
      ? STATUSES_PAST[0]
      : STATUSES_FUTURE[Math.floor(r() * STATUSES_FUTURE.length)];
    const aiFlag = r() < 0.18 ? "リマインド未送信" : (r() < 0.05 ? "前回キャンセル" : undefined);
    reservations.push({
      id: `${iso}-${i}`,
      staffId: staff.id,
      startTime: `${pad(hour)}:${pad(minute)}`,
      duration: service.duration,
      customerName: customer.name,
      customerInitials: customer.initials,
      karute: customer.karute,
      service: service.name,
      status,
      recordingConsent: r() > 0.3,
      aiFlag,
    });
    // bump time
    minute += service.duration + (Math.floor(r() * 4) * 15);
    while (minute >= 60) { hour += 1; minute -= 60; }
  }
  return reservations;
}

window.getReservationsForDate = generateForDate;

// Compute a daily summary used by week + month views.
window.getDailySummary = function (date) {
  const reservations = generateForDate(date);
  const bookedMinutes = reservations.reduce((sum, r) => sum + r.duration, 0);
  // average shop hours: 10–20 across 3 staff (but 1 is owner, doesn't book), times 2 booking staff
  const availableMinutes = (window.BUSINESS_HOURS.end - window.BUSINESS_HOURS.start) * 60 * 2;
  return {
    date,
    dateIso: ymd(date),
    reservations,
    count: reservations.length,
    bookedMinutes,
    availableMinutes,
    newCustomerCount: reservations.filter(r => r.status === "新規").length,
    remindersPending: reservations.filter(r => r.aiFlag === "リマインド未送信").length,
    consentPending: reservations.filter(r => !r.recordingConsent).length,
    unconfirmed: reservations.filter(r => r.status === "未確定").length,
  };
};
