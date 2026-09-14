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

if [[ -n "$(git status --porcelain -- "$BY_DATE" "$HOURS" "$ADAPTER" "$SCREEN")" ]]; then
  echo "refusing to run: the source files under mutation are dirty" >&2
  exit 1
fi

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

# m7 — an absent weekday in weekly_hours reads as open instead of 定休日.
perl -0pi -e 's/if \(day == null\) return \{ \.\.\.CLOSED_FACT \}/if (day === undefined) { \/* fall through *\/ } else if (day === null) return { ...CLOSED_FACT }/' $HOURS
run m7 $HOURS src/__tests__/integration/resolve-day-hours.test.ts 'an ABSENT weekday'

# m8 — an unplaceable staff filter falls back to UNFILTERED.
perl -0pi -e 's/return \{ staffId: null, unknown: true \}/return { staffId: null, unknown: false }/' $SCREEN
run m8 $SCREEN src/__tests__/integration/resolve-fetch-staff-id.test.ts 'cannot place'

echo "done — tree restored:"
git status --porcelain -- "$BY_DATE" "$HOURS" "$ADAPTER" "$SCREEN" || true
