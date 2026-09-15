#!/usr/bin/env bash
# PKT-1b-week mutation proof. Each mutant breaks ONE rule of the week
# rows / day-line metric menu (spec §8); a NAMED test must go red for it.
# Run from the repo root on a COMMITTED tree — the script reverts with
# `git checkout --` after each run.
#
#   bash src/__tests__/integration/mutants-1b-week.sh
#
# Output: one line per mutant, KILLED (the named test failed) or SURVIVED.
set -uo pipefail

METRIC_MENU=src/lib/appointments/metric-menu.ts
WEEK_ROWS=src/components/appointments/WeekRows.tsx

if [[ -n "$(git status --porcelain -- "$METRIC_MENU" "$WEEK_ROWS")" ]]; then
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

# n1 — 未設定 shown for a non-solo store (drops the soloMode conjunct).
perl -0pi -e "s/if \(ctx\.soloMode && !row\.hoursSaved && !row\.closed\) return unsetCell\(ctx\)/if (!row.hoursSaved \&\& !row.closed) return unsetCell(ctx)/" $METRIC_MENU
run n1 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'no unset even with hours unsaved'

# n2 — a closed day WITH bookings still shows 休 (drops the count===0 conjunct).
perl -0pi -e "s/return row\.closed && row\.count === 0 && BOOKING_SWITCHES\.closedDays/return row.closed \&\& BOOKING_SWITCHES.closedDays/" $METRIC_MENU
run n2 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'closed day WITH bookings still shows numbers'

# n3 — the 空き cell renders even with the freeTimeCell switch OFF.
perl -0pi -e "s/if \(BOOKING_SWITCHES\.freeTimeCell && row\.capacityDefensible && row\.availableMinutes > 0\) \{/if (row.capacityDefensible \&\& row.availableMinutes > 0) {/" $METRIC_MENU
run n3 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'utilization, bookedTime'

# n4 — the fill order repeats an already-used metric (drops the used-set guard).
perl -0pi -e 's/if \(used\.has\(key\)\) continue/if (false) continue/' $METRIC_MENU
run n4 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'never repeats a cell'

# n5 — the 稼働 band thresholds shift (35 -> 30).
perl -0pi -e "s/if \(pct < 35\) return 'band-low'/if (pct < 30) return 'band-low'/" $METRIC_MENU
run n5 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'exact boundary'

# n6 — the week summary's 新規 sum includes a closed (zero-booking) row.
perl -0pi -e 's/const newSum = openRows\.reduce/const newSum = rows.reduce/' $WEEK_ROWS
run n6 $WEEK_ROWS src/__tests__/integration/week-rows.test.tsx 'excludes a closed row'

echo "done — tree restored:"
git status --porcelain -- "$METRIC_MENU" "$WEEK_ROWS" || true
