// Reservation components — mirrors synqed-karute-design-spike/src/components/reservation/*
// All dark-mode focused, mobile + desktop variants.

const { useState, useMemo } = React;

// ─────────────────────────────────────────────────────────
// Page Header
// ─────────────────────────────────────────────────────────
function ReservationPageHeader({ selectedDate, onShift, onToday, onNew, isMobile }) {
  const long = window.dateUtils.formatLongDateJa(selectedDate);
  const compact = window.dateUtils.formatDateJa(selectedDate);
  const wd = window.dateUtils.weekdayJa(selectedDate);
  const fullJa = `${long}（${wd}）`;
  const compactJa = `${compact}（${wd}）`;

  return (
    <div className="resv-header">
      <div className="resv-header-left">
        {!isMobile && <h1 className="resv-title">予約</h1>}
        {isMobile && <h1 className="resv-title-mobile">予約</h1>}
        <button className="icon-btn" onClick={() => onShift(-1)} aria-label="prev">
          <Icon name="chevron-left" size={16} />
        </button>
        <button className="date-pill">
          <span className="tabular">{isMobile ? compactJa : fullJa}</span>
          <Icon name="chevron-down" size={14} className="muted" />
        </button>
        <button className="icon-btn" onClick={() => onShift(1)} aria-label="next">
          <Icon name="chevron-right" size={16} />
        </button>
        <button className="today-btn" onClick={onToday}>今日</button>
      </div>
      <div className="resv-header-right">
        {isMobile ? (
          <button className="primary-icon-btn" onClick={onNew} aria-label="新規予約">
            <Icon name="calendar-plus" size={16} />
          </button>
        ) : (
          <button className="primary-btn" onClick={onNew}>
            <Icon name="calendar-plus" size={14} />
            <span>新規予約</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Filter row: Day/Week/Month + 自分/全スタッフ + staff chips
// ─────────────────────────────────────────────────────────
function FilterRow({ view, onViewChange, mode, onModeChange, specificStaff, onPickStaff }) {
  const bookingStaff = window.STAFF.filter(s => s.takesBookings);
  return (
    <div className="filter-row">
      <div className="segmented">
        {[
          { v: "day", label: "日" },
          { v: "week", label: "週" },
          { v: "month", label: "月" },
        ].map(o => (
          <button
            key={o.v}
            className={`seg-btn ${view === o.v ? "active" : ""}`}
            onClick={() => onViewChange(o.v)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="segmented">
        <button className={`seg-btn ${mode === "self" ? "active" : ""}`} onClick={() => onModeChange("self")}>
          <Icon name="user" size={14} />
          <span>自分</span>
        </button>
        <button className={`seg-btn ${mode === "all" ? "active" : ""}`} onClick={() => onModeChange("all")}>
          <Icon name="users" size={14} />
          <span>全スタッフ</span>
        </button>
      </div>
      <div className="staff-chips">
        {bookingStaff.map(s => {
          const color = getStaffColor(s.id);
          const active = mode === "specific" && specificStaff === s.id;
          return (
            <button
              key={s.id}
              className={`staff-chip ${active ? "active" : ""}`}
              onClick={() => onPickStaff(s.id)}
              style={active ? { background: color.bg, borderColor: color.border, color: color.text } : undefined}
            >
              <span className="staff-chip-avatar" style={{ background: color.bg, color: color.text }}>
                {s.initials}
              </span>
              <span>{s.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Legend
// ─────────────────────────────────────────────────────────
function ReservationLegend() {
  const items = [
    { key: "予約済", label: "予約済" },
    { key: "施術中", label: "施術中" },
    { key: "完了", label: "完了" },
    { key: "新規", label: "新規" },
    { key: "未確定", label: "未確定" },
    { key: "block", label: "オーナー業務" },
  ];
  return (
    <div className="legend">
      <span className="legend-label">凡例</span>
      {items.map(it => {
        if (it.key === "block") {
          return (
            <div key={it.key} className="legend-item">
              <span className="legend-swatch block-pattern" />
              <span>{it.label}</span>
            </div>
          );
        }
        const s = STATUS_STYLES[it.key];
        return (
          <div key={it.key} className="legend-item">
            <span
              className="legend-swatch"
              style={{
                background: s.legendBg,
                border: `1px ${s.borderStyle} ${s.legendBorder}`,
              }}
            />
            <span>{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Mobile agenda — list view for mobile day mode
// ─────────────────────────────────────────────────────────
function MobileAgenda({ reservations, staffFilter }) {
  const filtered = staffFilter
    ? reservations.filter(r => r.staffId === staffFilter)
    : reservations;
  const sorted = [...filtered].sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div className="mobile-agenda">
      {sorted.map(r => {
        const s = STATUS_STYLES[r.status];
        const staff = getStaffById(r.staffId);
        const sc = getStaffColor(r.staffId);
        const isLive = r.status === "施術中";
        const isDone = r.status === "完了";
        return (
          <div key={r.id} className={`agenda-row ${isDone ? "agenda-done" : ""}`}>
            <div className="agenda-time">
              <div className="agenda-time-hh">{r.startTime}</div>
              <div className="agenda-time-dur">{r.duration}分</div>
            </div>
            <div className="agenda-main">
              <div className="agenda-name-row">
                <span className="staff-avatar-sm" style={{ background: sc.bg, color: sc.text }}>{r.customerInitials}</span>
                <span className="agenda-name">{r.customerName}</span>
                <span className="agenda-sama">様</span>
                {r.karute && <span className="karute-badge">{r.karute}</span>}
                {isLive && <span className="live-dot pulse" />}
              </div>
              <div className="agenda-service">{r.service}</div>
              {staff && (
                <div className="agenda-staff">
                  <span className="staff-dot" style={{ background: sc.stripe }} />
                  <span className="muted">担当 {staff.name}</span>
                </div>
              )}
            </div>
            <span
              className="status-chip"
              style={{
                background: s.bg,
                color: isDone ? "rgba(255,255,255,0.6)" : s.accent,
                border: `1px solid ${s.border}`,
              }}
            >
              {s.label}
            </span>
          </div>
        );
      })}
      {sorted.length === 0 && (
        <div className="agenda-empty">本日の予約はありません</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Desktop grid — staff rows + time axis
// ─────────────────────────────────────────────────────────
const HOUR_WIDTH = 110;
const ROW_HEIGHT = 88;
const STAFF_COL_WIDTH = 200;
const TIME_AXIS_HEIGHT = 32;

function timeToMinutes(time, startHour) {
  const [h, m] = time.split(":").map(Number);
  return (h - startHour) * 60 + m;
}

function ReservationGrid({ reservations, staffFilter }) {
  const { start, end } = window.BUSINESS_HOURS;
  const totalWidth = (end - start) * HOUR_WIDTH;
  const ppm = HOUR_WIDTH / 60;
  const allStaff = window.STAFF;
  const staff = staffFilter ? allStaff.filter(s => s.id === staffFilter) : allStaff;
  const cur = window.CURRENT_TIME;
  const curOffset = timeToMinutes(cur, start) * ppm;

  const hours = [];
  for (let h = start; h <= end; h++) hours.push(h);

  return (
    <div className="grid-card">
      <div className="grid-flex">
        <div className="grid-staff-col" style={{ width: STAFF_COL_WIDTH }}>
          <div className="grid-staff-col-header" style={{ height: TIME_AXIS_HEIGHT }}>STAFF</div>
          {staff.map(s => {
            const count = reservations.filter(r => r.staffId === s.id).length;
            const color = getStaffColor(s.id);
            return (
              <div key={s.id} className="staff-row-head" style={{ height: ROW_HEIGHT }}>
                <div
                  className="staff-row-avatar"
                  style={s.takesBookings ? { background: color.bg, color: color.text } : { background: "#111827", color: "#fff" }}
                >
                  {s.initials}
                </div>
                <div className="staff-row-meta">
                  <div className="staff-row-name">{s.name}</div>
                  <div className="staff-row-sub muted">
                    {s.role}
                    {s.takesBookings && <><span className="dot-sep">·</span>{count}件の予約</>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid-scroll">
          <div style={{ width: totalWidth, minWidth: "100%", position: "relative" }}>
            <div className="time-axis" style={{ height: TIME_AXIS_HEIGHT }}>
              {hours.map((h, i) => (
                <span key={h} className="time-axis-label" style={{ left: i * HOUR_WIDTH }}>
                  {String(h).padStart(2, "0")}:00
                </span>
              ))}
              {hours.slice(1).map((h, i) => (
                <span key={`t${h}`} className="time-axis-tick" style={{ left: (i + 1) * HOUR_WIDTH }} />
              ))}
            </div>

            <div style={{ position: "relative" }}>
              {/* current time */}
              <div className="current-line" style={{ left: curOffset }}>
                <div className="current-line-badge">{cur}</div>
                <div className="current-line-bar" />
              </div>

              {staff.map(s => {
                const staffR = reservations.filter(r => r.staffId === s.id);
                return (
                  <div key={s.id} className="lane" style={{ height: ROW_HEIGHT, width: totalWidth }}>
                    {/* hour separators */}
                    {hours.slice(1, -1).map((h, i) => (
                      <span key={`s${h}`} className="lane-tick" style={{ left: (i + 1) * HOUR_WIDTH }} />
                    ))}
                    {!s.takesBookings ? (
                      <div className="lane-block-pattern">
                        <span className="muted">予約を受け付けていません（オーナー業務）</span>
                      </div>
                    ) : (
                      staffR.map(r => (
                        <AppointmentCard
                          key={r.id}
                          r={r}
                          ppm={ppm}
                          startHour={start}
                        />
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AppointmentCard({ r, ppm, startHour }) {
  const s = STATUS_STYLES[r.status];
  const left = timeToMinutes(r.startTime, startHour) * ppm;
  const width = r.duration * ppm;
  const endT = window.dateUtils.endTime(r.startTime, r.duration);
  const tight = width < 90;
  const isLive = r.status === "施術中";
  const isDone = r.status === "完了";
  const canRecord = r.recordingConsent && !isDone;
  return (
    <div
      className="appt-card"
      style={{
        left: left + 2,
        width: width - 4,
        top: 4,
        height: ROW_HEIGHT - 8,
        background: s.bg,
        border: `1px ${s.borderStyle} ${s.border}`,
        opacity: isDone ? 0.65 : 1,
      }}
    >
      <div className="appt-inner">
        <div className="appt-top">
          <div className="appt-name">
            {r.customerName}<span className="muted appt-sama">様</span>
          </div>
          {!tight && (
            <span
              className="status-chip-sm"
              style={{ background: s.chipBg, color: s.chipText }}
            >
              {s.label}
            </span>
          )}
        </div>
        {!tight && <div className="appt-service">{r.service}</div>}
        <div className="appt-bottom">
          <div className="appt-time muted tabular">
            <span>{r.startTime}</span>
            {!tight && <><span className="dim"> – </span><span>{endT}</span></>}
            {width >= 70 && <><span className="dim"> · </span><span>{r.duration}分</span></>}
          </div>
          <div className="appt-icons">
            {canRecord && <Icon name="mic" size={11} className="mic-red" />}
            {isLive && <span className="live-dot pulse-sm" />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Week view — 7 day cards
// ─────────────────────────────────────────────────────────
function WeekView({ anchorDate, today, onPickDay, isMobile }) {
  const weekStart = window.dateUtils.startOfWeekMon(anchorDate);
  const days = Array.from({ length: 7 }, (_, i) => window.dateUtils.addDays(weekStart, i));

  return (
    <div className={`week-grid ${isMobile ? "mobile" : ""}`}>
      {days.map(d => {
        const summary = window.getDailySummary(d);
        const isToday = window.dateUtils.sameDate(d, today);
        return (
          <WeekDayCard key={summary.dateIso} summary={summary} isToday={isToday} onPick={() => onPickDay(d)} />
        );
      })}
    </div>
  );
}

function WeekDayCard({ summary, isToday, onPick }) {
  const { date, count, bookedMinutes, availableMinutes, newCustomerCount, remindersPending, consentPending, unconfirmed, reservations } = summary;
  const util = availableMinutes > 0 ? Math.round((bookedMinutes / availableMinutes) * 100) : 0;
  const openMin = Math.max(0, availableMinutes - bookedMinutes);
  const openHours = Math.floor(openMin / 60);
  const openRem = openMin % 60;
  const openLabel = `${openHours}時間${openRem ? openRem + "分" : ""} 空き時間`;

  const visible = reservations.slice(0, 4);
  const hidden = reservations.length - visible.length;
  const utilTone = util === 0 ? "muted" : util < 30 ? "green" : util < 70 ? "blue" : "amber";

  return (
    <article className={`week-card ${isToday ? "today" : ""}`}>
      <button className="week-card-header" onClick={onPick}>
        <div className="week-card-headline">
          <div className="week-date-line">
            <span className="week-date-num tabular">{date.getDate()}</span>
            <span className="muted week-date-mo tabular">/{date.getMonth() + 1}</span>
            <span className="week-weekday">{window.dateUtils.weekdayJa(date)}</span>
          </div>
          {isToday && <span className="today-badge">今日</span>}
        </div>
        <Icon name="chevron-right" size={14} className="muted" />
      </button>
      <div className="week-card-body">
        {count === 0 ? (
          <div className="muted italic small">予約なし</div>
        ) : (
          <>
            <div className="week-stats">
              <span className="stat-chip-gray tabular">{count}件</span>
              <span className={`util-chip util-${utilTone} tabular`}>{util}% 稼働率</span>
            </div>
            {openMin > 0 && (
              <div className="muted week-open tabular">{openLabel}</div>
            )}
            {(newCustomerCount + remindersPending + consentPending + unconfirmed) > 0 && (
              <div className="week-flags">
                {newCustomerCount > 0 && (
                  <span className="flag flag-green"><Icon name="sparkles" size={10} />{newCustomerCount} 新規</span>
                )}
                {remindersPending > 0 && (
                  <span className="flag flag-amber"><Icon name="bell-ring" size={10} />{remindersPending} リマインド未送信</span>
                )}
                {consentPending > 0 && (
                  <span className="flag flag-slate"><Icon name="shield-alert" size={10} />{consentPending} 同意未確認</span>
                )}
                {unconfirmed > 0 && (
                  <span className="flag flag-yellow"><Icon name="circle" size={10} />{unconfirmed} 未確定</span>
                )}
              </div>
            )}
            <div className="week-bookings">
              {visible.map(r => {
                const sc = getStaffColor(r.staffId);
                const firstName = r.customerName.split(" ")[0] || r.customerName;
                return (
                  <div key={r.id} className="week-booking-row">
                    <span className="staff-dot" style={{ background: sc.stripe }} />
                    <span className="muted tabular booking-time">{r.startTime}</span>
                    <span className="booking-name">{firstName}</span>
                  </div>
                );
              })}
              {hidden > 0 && (
                <button className="week-more" onClick={onPick}>+{hidden} 他</button>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────
// Month view — calendar grid
// ─────────────────────────────────────────────────────────
function MonthView({ anchorDate, today, onPickDay }) {
  const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const last = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
  const gridStart = window.dateUtils.startOfWeekMon(first);
  const gridEnd = window.dateUtils.addDays(window.dateUtils.endOfWeekSun(last), 1);
  const dates = [];
  for (let d = new Date(gridStart); d < gridEnd; d = window.dateUtils.addDays(d, 1)) dates.push(new Date(d));

  const monthOfAnchor = anchorDate.getMonth();
  const weekdays = ["月", "火", "水", "木", "金", "土", "日"];

  return (
    <div className="month-card">
      <div className="month-weekdays">
        {weekdays.map((w, i) => (
          <div key={w} className={`month-weekday ${i === 5 ? "sat" : i === 6 ? "sun" : ""}`}>{w}</div>
        ))}
      </div>
      <div className="month-grid">
        {dates.map(d => {
          const summary = window.getDailySummary(d);
          const inMonth = d.getMonth() === monthOfAnchor;
          const isToday = window.dateUtils.sameDate(d, today);
          const util = summary.availableMinutes > 0 ? Math.round((summary.bookedMinutes / summary.availableMinutes) * 100) : 0;
          const bucket = window.bucketForUtilization(util);
          const dow = d.getDay();
          return (
            <button
              key={summary.dateIso}
              className={`month-cell ${inMonth ? "" : "month-cell-out"}`}
              onClick={() => onPickDay(d)}
            >
              <span
                className={`month-num tabular ${isToday ? "today" : ""} ${dow === 0 ? "sun" : dow === 6 ? "sat" : ""} ${inMonth ? "" : "muted"}`}
              >
                {d.getDate()}
              </span>
              {summary.count > 0 && inMonth && (
                <div className="month-cell-info">
                  {bucket !== "empty" && <span className={`density-dot density-${bucket}`} />}
                  <span className="tabular month-count">{summary.count}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="month-legend">
        <span className="density-legend-item"><span className="density-dot density-light" /> 少ない</span>
        <span className="density-legend-item"><span className="density-dot density-medium" /> 中程度</span>
        <span className="density-legend-item"><span className="density-dot density-busy" /> 多い</span>
      </div>
    </div>
  );
}

window.ReservationPageHeader = ReservationPageHeader;
window.FilterRow = FilterRow;
window.ReservationLegend = ReservationLegend;
window.MobileAgenda = MobileAgenda;
window.ReservationGrid = ReservationGrid;
window.WeekView = WeekView;
window.MonthView = MonthView;
