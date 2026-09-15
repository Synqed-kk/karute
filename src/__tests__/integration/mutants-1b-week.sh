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
VIEW=src/components/appointments/AppointmentsView.tsx

if [[ -n "$(git status --porcelain -- "$METRIC_MENU" "$WEEK_ROWS" "$VIEW")" ]]; then
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
# (filter re-aimed in R2: the four 'free OFF' cases no longer end in
# 稼働時間, so the old 'utilization, bookedTime' substring matches nothing —
# and a filter that matches nothing reports a FALSE survival.)
perl -0pi -e "s/if \(BOOKING_SWITCHES\.freeTimeCell && row\.capacityDefensible && row\.availableMinutes > 0\) \{/if (row.capacityDefensible \&\& row.availableMinutes > 0) {/" $METRIC_MENU
run n3 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'free OFF'

# n4 — the fill order repeats an already-used metric (drops the used-set guard).
perl -0pi -e 's/if \(used\.has\(key\)\) continue/if (false) continue/' $METRIC_MENU
run n4 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'never repeats a cell'

# n5 — the 稼働 band thresholds shift (35 -> 30).
perl -0pi -e "s/if \(pct < 35\) return 'band-low'/if (pct < 30) return 'band-low'/" $METRIC_MENU
run n5 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'exact boundary'

# n6 — the week summary's 新規 sum includes a closed (zero-booking) row.
perl -0pi -e 's/const newSum = openRows\.reduce/const newSum = rows.reduce/' $WEEK_ROWS
run n6 $WEEK_ROWS src/__tests__/integration/week-rows.test.tsx 'excludes a closed row'

# R1 --------------------------------------------------------------------------

# n7 (R1-1) — the grid placement is a no-op, so a duration goes back into the
# narrow 100 px column.
perl -0pi -e 's/function placeForGrid\(cells: Cell\[\]\): Cell\[\] \{/function placeForGrid(cells: Cell[]): Cell[] {\n  return cells/' $METRIC_MENU
run n7 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'holds across typeSlot'

# n8 (R1-1) — RETIRED in R2, and why. The original dropped the early return
# `if (isDuration(cells[2])) return cells`; it died in R1 only because the
# defensible row then carried TWO durations and the mutant traded one for the
# other. R2-1 made 稼働% and 稼働時間 one measure, so a line now carries AT
# MOST ONE duration — and with one, `[1, 3].find(isDuration)` is already
# undefined whenever cell 3 holds it, so the early return is unreachable and
# the old mutant is EQUIVALENT, not a hole. (placeForGrid is private and only
# ever sees weekRowCells' fill order, whose ≤1-duration property is itself
# pinned — 'on BOTH surfaces'.) Replaced with one that DOES differ: only cell 4
# is considered, so a duration sitting in cell 2 is never moved out of the
# narrow column.
perl -0pi -e 's/const narrow = \[1, 3\]\.find\(\(i\) => isDuration\(cells\[i\]\)\)/const narrow = [3].find((i) => isDuration(cells[i]))/' $METRIC_MENU
run n8 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'holds across typeSlot'

# n9 (R1-1) — the DAY LINE gets re-placed too (it has no columns to place for).
perl -0pi -e 's/  return \[count, utilization, freeOrBooked, fourth\]\n\}/  return placeForGrid([count, utilization, freeOrBooked, fourth])\n}/' $METRIC_MENU
run n9 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'the DAY LINE keeps the fill order'

# n10 (R1-2) — `truncated` is ignored, so a cut-off week reads as an empty one.
perl -0pi -e 's/props\.truncated === true \|\| \(props\.weekData === null && !isPending\)/props.weekData === null \&\& !isPending/' $VIEW
run n10 $VIEW src/__tests__/integration/appointments-view-week-wiring.test.tsx 'truncated with rows still on the wire'

# n11 (R1-2) — only `truncated` is honoured, so a week the server never
# answered at all falls back to the calm 「データがありません」 page.
perl -0pi -e 's/props\.truncated === true \|\| \(props\.weekData === null && !isPending\)/props.truncated === true/' $VIEW
run n11 $VIEW src/__tests__/integration/appointments-view-week-wiring.test.tsx 'a null week with no truncation flag'

# R2 --------------------------------------------------------------------------

# m1 (R2-1) — 稼働時間 is allowed beside 稼働% again (the skip is dropped), so a
# defensible row tells the same booked minutes twice.
perl -0pi -e "s/if \(key === 'bookedTime' && used\.has\('utilization'\)\) continue/if (false) continue/" $METRIC_MENU
run m1 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'on BOTH surfaces'

# m2 (R2-2) — the wide column goes back to the mock's 120 px, where
# 「稼働時間 12時間30分」 (130.03 px) runs into its neighbour. jsdom cannot
# measure text, so the named test pins the CLASS STRING; the pixel proof is
# Playwright's, in the lane evidence folder.
perl -0pi -e 's/grid-cols-\[130px_100px\]/grid-cols-[120px_100px]/' $WEEK_ROWS
run m2 $WEEK_ROWS src/__tests__/integration/week-rows.test.tsx 'two-column block'

# m3 (R2-1/R1-1) — the placement seats the NON-duration wide, leaving the
# duration in the narrow 100 px column.
perl -0pi -e 's/const narrow = \[1, 3\]\.find\(\(i\) => isDuration\(cells\[i\]\)\)/const narrow = [1, 3].find((i) => !isDuration(cells[i]))/' $METRIC_MENU
run m3 $METRIC_MENU src/__tests__/integration/metric-menu.test.ts 'a DURATION never sits in the 100 px column'

# NOT a mutant: `props.weekData === null` → `!props.weekData` is EQUIVALENT —
# the prop is `WeekDayRowData[] | null` (the DTO's key is required and only
# nullable), and `![]` is false, so the two spellings cannot disagree on any
# reachable value. The 'an EMPTY week' test pins the INTENT of the spelling.

echo "done — tree restored:"
git status --porcelain -- "$METRIC_MENU" "$WEEK_ROWS" "$VIEW" || true
