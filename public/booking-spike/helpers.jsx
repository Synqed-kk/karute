// Helpers — staff colors, date formatters, status styles.
// Mirrors synqed-karute-design-spike/src/lib/staff-colors.ts

const STAFF_COLORS = {
  s1: { stripe: "#3b82f6", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.30)", text: "#bfdbfe", name: "blue" },
  s2: { stripe: "#8b5cf6", bg: "rgba(139,92,246,0.14)", border: "rgba(139,92,246,0.32)", text: "#ddd6fe", name: "violet" },
  s3: { stripe: "#14b8a6", bg: "rgba(20,184,166,0.14)", border: "rgba(20,184,166,0.32)", text: "#99f6e4", name: "teal" },
  s4: { stripe: "#ec4899", bg: "rgba(236,72,153,0.14)", border: "rgba(236,72,153,0.32)", text: "#fbcfe8", name: "pink" },
  s5: { stripe: "#06b6d4", bg: "rgba(6,182,212,0.14)", border: "rgba(6,182,212,0.32)", text: "#a5f3fc", name: "cyan" },
};
window.getStaffColor = function (staffId) {
  return STAFF_COLORS[staffId] || {
    stripe: "#9ca3af", bg: "rgba(156,163,175,0.14)", border: "rgba(156,163,175,0.32)", text: "#e5e7eb", name: "neutral",
  };
};
window.getStaffById = function (id) {
  return (window.STAFF || []).find((s) => s.id === id) || null;
};

// Status visual config used by the AppointmentCard + the mobile agenda chip stripe.
window.STATUS_STYLES = {
  予約済: {
    label: "予約済",
    bg: "rgba(34,197,94,0.10)",
    border: "rgba(34,197,94,0.32)",
    borderStyle: "solid",
    accent: "#22c55e",
    chipBg: "#16a34a",
    chipText: "#ffffff",
    legendBg: "rgba(34,197,94,0.15)",
    legendBorder: "rgba(34,197,94,0.35)",
  },
  施術中: {
    label: "施術中",
    bg: "rgba(249,115,22,0.18)",
    border: "rgba(251,146,60,0.85)",
    borderStyle: "solid",
    accent: "#f97316",
    chipBg: "#ea580c",
    chipText: "#ffffff",
    legendBg: "rgba(249,115,22,0.18)",
    legendBorder: "rgba(251,146,60,0.85)",
  },
  完了: {
    label: "完了",
    bg: "rgba(255,255,255,0.04)",
    border: "rgba(255,255,255,0.10)",
    borderStyle: "solid",
    accent: "rgba(255,255,255,0.25)",
    chipBg: "rgba(255,255,255,0.08)",
    chipText: "rgba(255,255,255,0.70)",
    legendBg: "rgba(255,255,255,0.04)",
    legendBorder: "rgba(255,255,255,0.10)",
  },
  新規: {
    label: "新規",
    bg: "rgba(59,130,246,0.10)",
    border: "rgba(59,130,246,0.55)",
    borderStyle: "dashed",
    accent: "#3b82f6",
    chipBg: "#2563eb",
    chipText: "#ffffff",
    legendBg: "rgba(59,130,246,0.10)",
    legendBorder: "rgba(59,130,246,0.55)",
  },
  未確定: {
    label: "未確定",
    bg: "rgba(234,179,8,0.10)",
    border: "rgba(234,179,8,0.45)",
    borderStyle: "dashed",
    accent: "#eab308",
    chipBg: "rgba(234,179,8,0.20)",
    chipText: "#fde68a",
    legendBg: "rgba(234,179,8,0.10)",
    legendBorder: "rgba(234,179,8,0.45)",
  },
};

// Date helpers
window.dateUtils = {
  pad: (n) => String(n).padStart(2, "0"),
  ymd: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
  weekdayJa: (d) => ["日", "月", "火", "水", "木", "金", "土"][d.getDay()],
  formatDateJa: (d) => `${d.getMonth() + 1}月${d.getDate()}日`,
  formatLongDateJa: (d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
  addDays: (d, n) => {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  },
  startOfWeekMon: (d) => {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    const day = out.getDay();
    const offset = (day + 6) % 7; // Mon-based
    out.setDate(out.getDate() - offset);
    return out;
  },
  endOfWeekSun: (d) => {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    const day = out.getDay();
    const offset = (7 - day) % 7;
    out.setDate(out.getDate() + offset);
    return out;
  },
  sameDate: (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(),
  endTime: (start, durationMin) => {
    const [h, m] = start.split(":").map(Number);
    const t = h * 60 + m + durationMin;
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  },
};

window.bucketForUtilization = function (pct) {
  if (pct === 0) return "empty";
  if (pct < 30) return "light";
  if (pct < 70) return "medium";
  return "busy";
};

// Map to icon-fonts not available; we provide minimal inline SVG icons.
window.Icon = function Icon({ name, size = 16, className = "", strokeWidth = 2, style }) {
  const s = size;
  const props = {
    width: s, height: s, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth, strokeLinecap: "round", strokeLinejoin: "round",
    className, style,
  };
  switch (name) {
    case "chevron-left": return <svg {...props}><path d="M15 18l-6-6 6-6"/></svg>;
    case "chevron-right": return <svg {...props}><path d="M9 18l6-6-6-6"/></svg>;
    case "chevron-down": return <svg {...props}><path d="M6 9l6 6 6-6"/></svg>;
    case "calendar-plus": return <svg {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M10 16h4M12 14v4"/></svg>;
    case "user": return <svg {...props}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
    case "users": return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case "mic": return <svg {...props}><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v3M8 21h8"/></svg>;
    case "bell": return <svg {...props}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>;
    case "menu": return <svg {...props}><path d="M3 6h18M3 12h18M3 18h18"/></svg>;
    case "clipboard": return <svg {...props}><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>;
    case "home": return <svg {...props}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/></svg>;
    case "sparkles": return <svg {...props}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/></svg>;
    case "bell-ring": return <svg {...props}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0M4 2C2.8 3.7 2 5.7 2 8M22 8c0-2.3-.8-4.3-2-6"/></svg>;
    case "shield-alert": return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4M12 16h.01"/></svg>;
    case "circle": return <svg {...props}><circle cx="12" cy="12" r="9"/></svg>;
    case "settings": return <svg {...props}><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
    case "upload": return <svg {...props}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
    case "grad-cap": return <svg {...props}><path d="M22 10L12 4 2 10l10 6 10-6z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>;
    case "chevron-up-down": return <svg {...props}><path d="M7 9l5-5 5 5M7 15l5 5 5-5"/></svg>;
    default: return <svg {...props}><circle cx="12" cy="12" r="9"/></svg>;
  }
};
