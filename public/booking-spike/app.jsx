// Main app — orchestrates the booking page UI.
// Handles: view (day/week/month), staff mode/filter, current date, viewport (mobile/desktop).

const { useState, useEffect } = React;
const {
  ReservationPageHeader,
  FilterRow,
  ReservationLegend,
  MobileAgenda,
  ReservationGrid,
  WeekView,
  MonthView,
} = window;

function Sidebar({ currentRoute }) {
  const items = [
    { id: "record", label: "録音", icon: "mic" },
    { id: "dashboard", label: "ダッシュボード", icon: "home" },
    { id: "reservation", label: "予約", icon: "calendar-plus" },
    { id: "customers", label: "顧客", icon: "users" },
    { id: "karute", label: "カルテ", icon: "clipboard" },
    { id: "coaching", label: "コーチング", icon: "grad-cap" },
    { id: "ai", label: "AI相談", icon: "sparkles" },
    { id: "import", label: "インポート", icon: "upload" },
    { id: "settings", label: "設定", icon: "settings" },
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-name">SYNQED</div>
        <div className="sidebar-brand-sub">KARUTE</div>
      </div>
      <nav className="sidebar-nav">
        {items.map(it => (
          <button
            key={it.id}
            className={`sidebar-link ${currentRoute === it.id ? "active" : ""}`}
          >
            <Icon name={it.icon} size={16} />
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span className="sidebar-user-avatar">JC</span>
          <div className="sidebar-user-meta">
            <div className="sidebar-user-name">Jon Chan</div>
            <div className="sidebar-user-role">オーナー</div>
          </div>
          <Icon name="chevron-up-down" size={14} className="muted" />
        </div>
      </div>
    </aside>
  );
}

function MobileHeader() {
  return (
    <div className="mobile-header">
      <div className="mobile-header-title">予約</div>
      <button className="mobile-header-bell" aria-label="通知">
        <Icon name="bell" size={20} />
        <span className="mobile-header-bell-dot">3</span>
      </button>
    </div>
  );
}

function TabBar() {
  const items = [
    { id: "reservation", label: "予約", icon: "calendar-plus", active: true },
    { id: "karute", label: "カルテ", icon: "clipboard" },
    { id: "rec", label: "田中 美咲様", center: true },
    { id: "customers", label: "顧客", icon: "users" },
    { id: "menu", label: "メニュー", icon: "menu" },
  ];
  return (
    <div className="tab-bar">
      {items.map(it => (
        <button key={it.id} className={`tab-item ${it.active ? "active" : ""} ${it.center ? "center" : ""}`}>
          {it.center ? (
            <span className="tab-mic"><Icon name="mic" size={20} /></span>
          ) : (
            <Icon name={it.icon} size={20} />
          )}
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

function RecordingFAB() {
  return (
    <button className="recording-fab">
      <span className="recording-fab-mic"><Icon name="mic" size={14} /></span>
      <span>録音を開始</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────
// Reservation page body — owns view + filter state.
// ─────────────────────────────────────────────────────────
function ReservationPageBody({ viewport, initialView }) {
  const isMobile = viewport === "mobile";

  const todayDate = (() => {
    const [y, m, d] = window.TODAY_ISO.split("-").map(Number);
    return new Date(y, m - 1, d);
  })();
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [view, setView] = useState(initialView);
  const [mode, setMode] = useState("all"); // self | all | specific
  const [specificStaff, setSpecificStaff] = useState(null);

  // Sync external initialView changes (from Tweaks panel)
  useEffect(() => { setView(initialView); }, [initialView]);

  function shiftDate(dir) {
    const next = new Date(selectedDate);
    if (view === "week") next.setDate(next.getDate() + dir * 7);
    else if (view === "month") {
      next.setDate(1);
      next.setMonth(next.getMonth() + dir);
    } else {
      next.setDate(next.getDate() + dir);
    }
    setSelectedDate(next);
  }
  function pickStaff(id) {
    if (mode === "specific" && specificStaff === id) {
      setMode("all"); setSpecificStaff(null);
    } else {
      setMode("specific"); setSpecificStaff(id);
    }
  }
  function setModeOnly(m) { setMode(m); setSpecificStaff(null); }

  const staffFilter = mode === "specific" ? specificStaff : (mode === "self" ? "s1" : null);
  const reservations = window.getReservationsForDate(selectedDate);
  const filtered = staffFilter ? reservations.filter(r => r.staffId === staffFilter) : reservations;
  const statusCounts = filtered.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const isToday = window.dateUtils.sameDate(selectedDate, todayDate);
  const totalLabel = `${isToday ? "本日" : window.dateUtils.formatLongDateJa(selectedDate)}の予約 ${filtered.length}件`;

  return (
    <div className={`viewport-${viewport}`}>
      <ReservationPageHeader
        selectedDate={selectedDate}
        onShift={shiftDate}
        onToday={() => setSelectedDate(todayDate)}
        onNew={() => {}}
        isMobile={isMobile}
      />
      <FilterRow
        view={view}
        onViewChange={setView}
        mode={mode}
        onModeChange={setModeOnly}
        specificStaff={specificStaff}
        onPickStaff={pickStaff}
      />
      <ReservationLegend />

      {view === "day" && (
        isMobile ? (
          <MobileAgenda reservations={reservations} staffFilter={staffFilter} />
        ) : (
          <>
            <ReservationGrid reservations={reservations} staffFilter={staffFilter} />
            <div className="day-statusbar">
              <span className="day-statusbar-total">{totalLabel}</span>
              {filtered.length > 0 && (
                <>
                  <span className="day-statusbar-sep">·</span>
                  <span>完了 {statusCounts["完了"] || 0}</span>
                  <span>施術中 {statusCounts["施術中"] || 0}</span>
                  <span>予約済 {statusCounts["予約済"] || 0}</span>
                  <span>新規 {statusCounts["新規"] || 0}</span>
                  <span>未確定 {statusCounts["未確定"] || 0}</span>
                </>
              )}
            </div>
          </>
        )
      )}

      {view === "week" && (
        <WeekView
          anchorDate={selectedDate}
          today={todayDate}
          isMobile={isMobile}
          onPickDay={(d) => { setSelectedDate(d); setView("day"); }}
        />
      )}

      {view === "month" && (
        <MonthView
          anchorDate={selectedDate}
          today={todayDate}
          onPickDay={(d) => { setSelectedDate(d); setView("day"); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Tweaks panel
// ─────────────────────────────────────────────────────────
function TweaksPanel({ open, onClose, viewport, setViewport, initialView, setInitialView }) {
  if (!open) return null;
  return (
    <div className="tweaks-panel">
      <div className="tweaks-header">
        <span>Tweaks</span>
        <button className="tweaks-close" onClick={onClose} aria-label="close">×</button>
      </div>
      <div className="tweaks-body">
        <div>
          <div className="tweaks-label">Viewport</div>
          <div className="tweaks-pillrow">
            {[
              { v: "desktop", l: "Desktop" },
              { v: "mobile",  l: "Mobile" },
            ].map(o => (
              <button
                key={o.v}
                className={`tweaks-pill ${viewport === o.v ? "active" : ""}`}
                onClick={() => setViewport(o.v)}
              >{o.l}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="tweaks-label">View mode</div>
          <div className="tweaks-pillrow">
            {[
              { v: "day",   l: "Day · 日" },
              { v: "week",  l: "Week · 週" },
              { v: "month", l: "Month · 月" },
            ].map(o => (
              <button
                key={o.v}
                className={`tweaks-pill ${initialView === o.v ? "active" : ""}`}
                onClick={() => setInitialView(o.v)}
              >{o.l}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────
function App() {
  const TWEAKS_DEFAULTS = /*EDITMODE-BEGIN*/{
    "viewport": "desktop",
    "initialView": "day"
  }/*EDITMODE-END*/;

  const [viewport, setViewport] = useState(TWEAKS_DEFAULTS.viewport);
  const [initialView, setInitialView] = useState(TWEAKS_DEFAULTS.initialView);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  useEffect(() => {
    function onMessage(e) {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "__activate_edit_mode") setTweaksOpen(true);
      if (data.type === "__deactivate_edit_mode") setTweaksOpen(false);
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function updateTweak(key, value) {
    if (key === "viewport") setViewport(value);
    if (key === "initialView") setInitialView(value);
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [key]: value } }, "*");
  }

  return (
    <>
      {viewport === "desktop" ? (
        <div className="app-shell">
          <Sidebar currentRoute="reservation" />
          <main className="main">
            <ReservationPageBody viewport="desktop" initialView={initialView} />
          </main>
          <RecordingFAB />
        </div>
      ) : (
        <div className="app-shell" style={{ background: "#000", justifyContent: "center" }}>
          <div className="phone-frame">
            <MobileHeader />
            <div className="mobile-body">
              <ReservationPageBody viewport="mobile" initialView={initialView} />
            </div>
          </div>
        </div>
      )}
      <TweaksPanel
        open={tweaksOpen}
        onClose={() => {
          setTweaksOpen(false);
          window.parent.postMessage({ type: "__edit_mode_dismissed" }, "*");
        }}
        viewport={viewport}
        setViewport={(v) => updateTweak("viewport", v)}
        initialView={initialView}
        setInitialView={(v) => updateTweak("initialView", v)}
      />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
