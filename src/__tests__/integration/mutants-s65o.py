#!/usr/bin/env python3
"""S65 PR-O server mutation proof (PACKET-S65-PRO proof list item 2; S67 fix
round 1). Each mutant breaks ONE rule of the server half; the NAMED tests must
go red for it (KILLED). Run from the repo root on a COMMITTED tree:

    python3 src/__tests__/integration/mutants-s65o.py            # the whole list
    python3 src/__tests__/integration/mutants-s65o.py --only M-O7d
    python3 src/__tests__/integration/mutants-s65o.py --dry-run M-O2a

The harness is mutants-s60a.py's (S63 FIX-3 kill rule), one step stricter: a
mutant is KILLED only when Jest's JSON report parses, success is false, no
suite errored at runtime, and EVERY test named for that mutant is among the
tests that failed on assertion. Red tests that miss a named one = MISSED; a
green run = SURVIVED; no JSON / a runtime-errored suite / zero tests = BROKEN.
Only KILLED passes. Every mutant is a text edit whose anchor must match
EXACTLY once; the file's original bytes are written back after each run and
`git diff --quiet` proves the restoration.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

IT = 'src/__tests__/integration'
CORE = 'src/lib/karute/karute.core.ts'
WORKER = 'src/lib/jobs/process-recording.ts'
LINK = 'src/lib/karute/appointment-link.ts'
FATE = 'src/lib/karute/outcome-fate.ts'
SIGNALS = 'src/lib/customers/status-signals.ts'
GUARD = 'src/lib/karute/revisit-guard.ts'
SCREEN = 'src/lib/karute/record-screen.ts'

SAVE_T = f'{IT}/app-api-karute-save.test.ts'
JOB_T = f'{IT}/process-recording-existing-karute.test.ts'
OUTCOME_T = f'{IT}/process-recording-outcome.test.ts'
AUTO_T = f'{IT}/appointment-auto-link.test.ts'
RULE_T = f'{IT}/revisit-prior-visit-rule.test.ts'
ENQ_T = f'{IT}/app-api-recording-job.test.ts'
GATE_T = f'{IT}/record-screen-cross-store-target.test.ts'
DTO_T = f'{IT}/app-api-karute-detail-screen.test.ts'
CP2_T = f'{IT}/audit-coveredby.test.ts'
CP7_T = f'{IT}/audit-writer-emission.test.ts'

# The dummy values from ci.yml (not secrets).
ENV = {
    'NEXT_PUBLIC_SUPABASE_URL': 'https://test-dummy.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'dummy-not-a-key',
}

# id, what breaks, [(file, old, new)], killer suites, named tests (substrings of
# the Jest fullName; EVERY one must fail for a KILL)
MUTANTS = [
    # M-O2 — the converge clears a link (commit 1, S4)
    ('M-O2a', 'facade converge sends the payload booking (null clears the link)',
     [(CORE, '        appointment_id: appointmentId,\n        ...(omitEntries',
       '        appointment_id: payload.appointment_id, // M-O2a\n        ...(omitEntries')],
     [SAVE_T], ["S4-facade: a second save with no booking, same customer, keeps the first save's link"]),
    ('M-O2b', 'worker converge sends the payload booking (null clears the link)',
     [(WORKER, '      appointment_id: appointmentId,\n    })\n    // CEILING (mirrors',
       '      appointment_id: payload.appointment_id ?? null, // M-O2b\n    })\n    // CEILING (mirrors')],
     [JOB_T], ["S4-job: a job re-run with no booking keeps the first save's link"]),
    ('M-O2c', 'keepLinkUnlessGiven loses its re-point arm (the old booking rides along)',
     [(LINK, '  if ((write.customer_id ?? null) !== (existing.customer_id ?? null)) return null\n', '')],
     [SAVE_T], ['S4-facade: a re-point to another customer with no booking moves both']),
    # M-O5 — the audit row lacks the fate (commit 2, S5 + R-O2)
    ('M-O5a', 'the facade row drops outcome_link',
     [(CORE, '        ...(outcomeLink === undefined ? {} : { outcome_link: outcomeLink }),\n', '')],
     [SAVE_T], ['S2/S5-facade written', 'S2/S5-facade failed (the write errors)']),
    ('M-O5b', 'the worker row drops outcome_link',
     [(WORKER, '      outcome_link: fate.link,\n', '')],
     [JOB_T], ['S2/S5-job written', 'S2/S5-job failed (the write errors)']),
    ('M-O5c', 'the fate lies: a failed write reads as written',
     [(FATE, '  if (result.error) return failed(result.error)\n', "  if (result.error) return { link: 'written' } // M-O5c\n")],
     [SAVE_T, JOB_T], ['S2/S5-facade failed (the write errors)', 'S2/S5-job failed (the write errors)']),
    ('M-O5d', 'the worker fails BEFORE its row (a failed label leaves no row)',
     [(WORKER, '  const actorUserId = await resolveActorUserId(synqed, payload.staff_id)\n',
       "  if (fate.link.startsWith('failed:')) throw fate.cause instanceof Error ? fate.cause : new Error(String(fate.cause)) // M-O5d\n"
       '  const actorUserId = await resolveActorUserId(synqed, payload.staff_id)\n')],
     [JOB_T], ['S2/S5-job failed (the write errors)', 'S2/S5-job failed (the write THROWS)']),
    # M-O7 — the auto-link fires with two candidates or another customer/store/day (commit 4, S7)
    ('M-O7a', 'two candidates link the first (ambiguity removed)',
     [(LINK, "    if (sameDay.length > 1) return { link: 'ambiguous', appointmentId: null }\n", '')],
     [AUTO_T, SAVE_T, JOB_T], ['condition 7', 'S7-facade: two bookings', 'S7-job: two bookings']),
    ('M-O7b', 'customer check removed',
     [(LINK, '        a.customer_id === input.customerId &&\n', '')],
     [AUTO_T], ["condition 1 — another customer's booking"]),
    ('M-O7c', 'store check removed',
     [(LINK, '        (a.store_id ?? null) === input.storeId &&\n', '')],
     [AUTO_T], ['condition 2 — a booking in another store']),
    ('M-O7d', 'JST-day check removed',
     [(LINK, '        jstDayOf(a.starts_at) === day &&\n', '')],
     [AUTO_T], ['condition 3 at midnight']),
    ('M-O7e', 'other-karute check removed',
     [(LINK, '    if (other) return none\n', '')],
     [AUTO_T], ['condition 6 — another karute already points at it']),
    ('M-O7f', 'the window becomes a fixed 60/120-min constant',
     [(LINK, '    if (sessionMs < startsMs - ownMs || sessionMs > startsMs + 2 * ownMs) return none\n',
       '    if (sessionMs < startsMs - 60 * 60_000 || sessionMs > startsMs + 120 * 60_000) return none // M-O7f\n')],
     [AUTO_T], ["the window is the booking's OWN duration on each side"]),
    # M-O8 — the draft makes a first-timer returning (commit 3, R-O7 + V7)
    ('M-O8a', 'countsAsPriorVisit always true (the placeholder counts)',
     [(SIGNALS, '  if (!isProvisionalKaruteRow(row)) return true\n  return karuteRowDayJst(row) !== anchorDayJst\n',
       '  return true // M-O8a\n')],
     [RULE_T, ENQ_T, GATE_T, DTO_T],
     ['V7-1: a same-day', 'the midnight edge', 'a first-timer whose only karute is today']),
    ('M-O8b', 'the server guard bypasses the predicate',
     [(GUARD, '  return others.filter((row) => countsAsPriorVisit(row, anchorDay)).length\n',
       '  return others.length // M-O8b\n')],
     [RULE_T, ENQ_T, DTO_T], ['V7-1: a same-day', 'the midnight edge']),
    ('M-O8c', 'the record screen bypasses the predicate',
     [(SCREEN, '    const priorKarute = customerKarute.filter((r) => countsAsPriorVisit(r, ymdInJst(now)))\n',
       '    const priorKarute = customerKarute // M-O8c\n')],
     [GATE_T], ["a first-timer whose only karute is today's placeholder stays a first visit"]),
    ('M-O8d', 'the anchor is the clock, not the session start',
     [(GUARD, '    return session?.created_at ? ymdInJst(new Date(session.created_at)) : null\n',
       '    return ymdInJst(new Date()) // M-O8d\n')],
     [RULE_T], ['the midnight edge']),
    # M-O9 — the log line and the row carry different references (commit 7, R-O9 (ii))
    ('M-O9', 'the log line gets its own ref, not the row\'s',
     [(FATE, '        ref,\n', '        ref: randomUUID().slice(0, 8), // M-O9\n')],
     [SAVE_T, JOB_T], ['one reference joins the log line and the audit row (the write errors)',
                       'one reference joins the log line and the audit row (the write THROWS)']),
    # M-O10 — the one appointment_link expression loses the degraded reason
    # (commit 8): BOTH the reply and the row must go red — both call it.
    ('M-O10', 'appointmentLinkOf drops the degraded-booking reason',
     [(LINK, '  return linkReason ?? autoLink ?? null\n', '  return autoLink ?? null // M-O10\n')],
     [SAVE_T, f'{IT}/karute-save-audit.test.ts'],
     ["booking not found → 200, saved in the caller's store, link dropped",
      'booking not found → saved, one karute.save row with severity notice and appointment_link appointment_not_found']),
    # M-O11 — the worker's row computes appointment_link locally again (commit 9)
    ('M-O11', "the worker's row drops the one link expression (a local null)",
     [(WORKER, '      appointment_link: appointmentLinkOf(null, autoLinked?.link),\n', '      appointment_link: null, // M-O11\n')],
     [JOB_T], ['S7-job: one booking in its window → created on it; the row says auto_linked',
               'S7-job: two bookings → ambiguous, no link']),
    # M-G1 — the save's return is not the walker's call-through shape (commit 6)
    ('M-G1', '`return await emitSave(...)` (the S67 list failure)',
     [(CORE, '  return emitSave({ id: record.id, fresh: true,', '  return await emitSave({ id: record.id, fresh: true,')],
     [CP2_T, CP7_T], ['createOrUpdateKaruteRecord resolves and emits on every non-error path']),
]


def git_clean(paths):
    out = subprocess.run(['git', 'status', '--porcelain', '--', *paths], capture_output=True, text=True, check=True)
    return out.stdout.strip() == ''


def apply(edits):
    """Apply every edit; return {file: original bytes}. An anchor that does not
    match EXACTLY once is refused (a mutant that applies nowhere proves nothing)."""
    originals = {}
    for path, old, new in edits:
        if path not in originals:
            with open(path, 'rb') as f:
                originals[path] = f.read()
        with open(path, encoding='utf-8') as f:
            text = f.read()
        n = text.count(old)
        if n != 1:
            restore(originals)
            raise SystemExit(f'anchor matched {n}x (need 1) in {path}: {old[:60]!r}')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text.replace(old, new, 1))
    return originals


def restore(originals):
    for path, data in originals.items():
        with open(path, 'wb') as f:
            f.write(data)
    if subprocess.run(['git', 'diff', '--quiet', '--', *originals]).returncode != 0:
        raise SystemExit(f'RESTORE FAILED: git diff is not quiet on {list(originals)}')


def run_killers(killers, named, env):
    fd, out = tempfile.mkstemp(prefix='mutants-s65o-', suffix='.json')
    os.close(fd)
    os.unlink(out)
    try:
        subprocess.run(['npx', 'jest', '--ci', *killers, '--silent', '--json', '--outputFile', out], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            with open(out, encoding='utf-8') as f:
                rep = json.load(f)
        except (OSError, ValueError) as e:
            return 'BROKEN', f'no parseable jest JSON ({type(e).__name__})', []
    finally:
        if os.path.exists(out):
            os.unlink(out)
    total = rep.get('numTotalTests', 0)
    failed_n = rep.get('numFailedTests', 0)
    runtime = rep.get('numRuntimeErrorTestSuites', 0)
    success = rep.get('success')
    if runtime != 0:
        return 'BROKEN', f'{runtime} runtime-errored suite(s)', []
    if not total:
        return 'BROKEN', 'zero tests ran', []
    failed = [a.get('fullName') or a.get('title') or '?'
              for tr in rep.get('testResults', [])
              for a in tr.get('assertionResults', [])
              if a.get('status') == 'failed']
    if success is True and failed_n == 0:
        return 'SURVIVED', '', []
    if success is False and failed_n > 0:
        missing = [n for n in named if not any(n in f for f in failed)]
        if missing:
            return 'MISSED', 'named test(s) stayed green: ' + ' | '.join(missing), failed
        return 'KILLED', '', failed
    return 'BROKEN', f'success={success} numFailedTests={failed_n}', []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='run one mutant id')
    ap.add_argument('--dry-run', metavar='ID', help='apply + restore one mutant, no test run')
    args = ap.parse_args()

    ids = [m[0] for m in MUTANTS]
    pick = args.dry_run or args.only
    if pick and pick not in ids:
        raise SystemExit(f'unknown mutant {pick}; known: {", ".join(ids)}')
    chosen = [m for m in MUTANTS if not pick or m[0] == pick]
    targets = sorted({e[0] for m in chosen for e in m[2]})
    if not git_clean(targets):
        raise SystemExit('refusing to run: the source files under mutation are dirty')

    env = {**os.environ, **ENV}
    rows = []
    for mid, what, edits, killers, named in chosen:
        originals = apply(edits)
        try:
            if args.dry_run:
                subprocess.run(['git', '--no-pager', 'diff', '--', *originals])
                verdict = 'dry-run'
            else:
                verdict, why, failed = run_killers(killers, named, env)
                if why:
                    print(f'{verdict} {mid} {why}')
                for name in failed:
                    print(f'  {mid} red: {name}')
        finally:
            restore(originals)
        target = ' + '.join(sorted({os.path.basename(e[0]) for e in edits}))
        rows.append((mid, f'{target} — {what}', ' + '.join(os.path.basename(k) for k in killers), verdict))

    print('id · target · killer suites · verdict')
    for row in rows:
        print(' · '.join(row))
    whole = subprocess.run(['git', 'diff', '--quiet']).returncode == 0
    print(f'restored: git diff --quiet → {"clean" if whole else "DIRTY"}')
    if not whole or any(r[3] not in ('KILLED', 'dry-run') for r in rows):
        sys.exit(1)


if __name__ == '__main__':
    main()
