#!/usr/bin/env bash
# PKT-1a mutation proof. Each mutant breaks ONE rule of the 予約 numbers
# foundation; a NAMED test must go red for it. Run from the repo root on a
# COMMITTED tree — the script reverts with `git checkout --` after each run.
#
#   bash src/__tests__/integration/mutants-1a.sh
#
# Output: one line per mutant, KILLED (the named test failed) or SURVIVED.
set -uo pipefail

BY_DATE=src/lib/appointments/by-date.ts
HOURS=src/lib/operating-hours.ts
ADAPTER=src/lib/adapters/reservation.ts
SCREEN=src/lib/appointments/screen.ts
ACTION=src/actions/appointments-window.ts

if [[ -n "$(git status --porcelain -- "$BY_DATE" "$HOURS" "$ADAPTER" "$SCREEN" "$ACTION")" ]]; then
  echo "refusing to run: the source files under mutation are dirty" >&2
  exit 1
fi

# TZ=UTC mirrors Vercel and CI. m5 (the JST weekday) is ONLY discriminating
# there: on a JST developer machine the runtime calendar already agrees with
# JST, so date.getDay() gives the right answer and no assertion can catch it.
export TZ=UTC

run() { # run <mutant-id> <file> <named test path> <test name filter>
  local id=$1 file=$2 suite=$3 name=$4
  if npx jest "$suite" -t "$name" --silent >/dev/null 2>&1; then
    echo "$id  SURVIVED  ($suite -t '$name' still passes)"
  else
    echo "$id  KILLED    ($suite -t '$name')"
  fi
  git checkout -- "$file"
}

# m1 — drop the `kind` check: a BLOCK capacity hold counts as a booking.
perl -0pi -e "s/\(a\.kind \?\? 'BOOKING'\) === 'BOOKING' &&\n    a\.customer_id != null/a.customer_id != null/" $BY_DATE
run m1 $BY_DATE src/__tests__/integration/booking-count-parity.test.ts 'a BLOCK row never counts'

# m2 — drop the customer check: a customerless booking counts.
perl -0pi -e "s/a\.customer_id != null &&\n    !isTerminalStatus/!isTerminalStatus/" $BY_DATE
run m2 $BY_DATE src/__tests__/integration/booking-count-parity.test.ts 'a customerless BOOKING row never counts'

# m3 — `>= total` becomes `> total`: the pager overshoots by a page.
perl -0pi -e 's/rows\.length >= res\.total/rows.length > res.total/' $BY_DATE
run m3 $BY_DATE src/__tests__/integration/appointment-window-paging.test.ts 'exactly 2 calls for 1000'

# m4 — a truncated window returns its partial rows instead of nothing.
perl -0pi -e 's/if \(rows\.length < total\) return \{ \.\.\.EMPTY_WINDOW, truncated: true \}/if (false) return { ...EMPTY_WINDOW, truncated: true }/' $BY_DATE
run m4 $BY_DATE src/__tests__/integration/appointment-window-paging.test.ts 'the cap: 4000 rows'

# m5 — getWeekdayKey back to the runtime calendar.
perl -0pi -e 's/JS_DAY_TO_KEY\[partsInJst\(date\)\.weekday\]/JS_DAY_TO_KEY[date.getDay()]/' $HOURS
run m5 $HOURS src/__tests__/integration/operating-hours-jst.test.ts 'already Tuesday in JST'

# m6 — the overlap check inverted: overlapping bookings read as clear.
perl -0pi -e 's/if \(aStart < bEnd && bStart < aEnd\) return true/if (aStart >= bEnd \&\& bStart >= aEnd) return true/' $ADAPTER
run m6 $ADAPTER src/__tests__/integration/capacity-conjunction.test.ts 'overlapping bookings'

# m7 — an absent weekday in weekly_hours reads as OPEN instead of 定休日.
# Spelled as a wrong VALUE, never a crash: the first spelling let `day` stay
# undefined and the resolver threw on day.open before the test's own
# assertions ran, so the kill proved nothing about them (L3 HIGH).
perl -0pi -e "s/  const day = weekly\[key\]\n/  const day = weekly[key] ?? { open: '10:00', close: '24:00' }\n/" $HOURS
run m7 $HOURS src/__tests__/integration/resolve-day-hours.test.ts 'an ABSENT weekday'

# m8 — an unplaceable staff filter falls back to UNFILTERED.
perl -0pi -e 's/return \{ staffId: null, unknown: true \}/return { staffId: null, unknown: false }/' $SCREEN
run m8 $SCREEN src/__tests__/integration/resolve-fetch-staff-id.test.ts 'cannot place'

# m9 — the WEB action's unplaceable filter falls back to a FETCH: one stylist's
# 自分 week becomes the whole salon's, under her name.
perl -0pi -e 's/^    unknown\n      \? Promise\.resolve/    !unknown\n      ? Promise.resolve/m' $ACTION
run m9 $ACTION src/__tests__/integration/appointments-window-action.test.ts 'an unplaceable'

# m10 — the WEB action drops the store clamp on the window fetch: the
# Apple-review bug (a 銀座-only frontdesk reading the 代官山 week).
perl -0pi -e 's/fetchAppointmentWindow\(synqed, fromIso, toIso, \{ storeId, staffId \}\)/fetchAppointmentWindow(synqed, fromIso, toIso, { storeId: undefined, staffId })/' $ACTION
run m10 $ACTION src/__tests__/integration/appointments-window-action.test.ts 'forwards the RESOLVED store id'

# m11 — 稼働 is allowed past 100% again: the day claims a capacity its own
# bookings already overran.
perl -0pi -e 's/bookedMinutes <= fact\.minutes/true/' $ADAPTER
run m11 $ADAPTER src/__tests__/integration/capacity-conjunction.test.ts 'booked PAST the saved window'

# m12 — overlap goes back to START-day bucketing: two bookings that collide
# across JST midnight are never compared.
perl -0pi -e 's/s\.start <= dayEndMs && dayStartMs < s\.end/s.start >= dayStartMs \&\& s.start < dayEndMs/' $ADAPTER
run m12 $ADAPTER src/__tests__/integration/capacity-conjunction.test.ts 'OVERLAP ACROSS JST MIDNIGHT'

# m13 — the dayTotals window loses its LAST day: the selected day falls outside
# a window that genuinely covers it and the day line reads "no bookings yet".
# NOTE the spelling: `<=` → `<` cannot be the mutant here. selectedDate is a JST
# MIDNIGHT and rangeTo is that day's 23:59:59.999, so the two operators agree on
# every reachable input — a vacuous mutant of exactly the kind m7 used to be.
perl -0pi -e 's/selectedDate <= r\.rangeTo/selectedDate <= new Date(r.rangeTo.getTime() - 86_400_000)/' $SCREEN
run m13 $SCREEN src/__tests__/integration/screen-truncated.test.ts 'LAST day'

echo "done — tree restored:"
git status --porcelain -- "$BY_DATE" "$HOURS" "$ADAPTER" "$SCREEN" "$ACTION" || true
