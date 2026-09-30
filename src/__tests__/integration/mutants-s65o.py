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
OUTCOME_SRC = 'src/lib/karute/outcome.ts'
DATE = 'src/lib/date/jst.ts'

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
GUARD_T = f'{IT}/revisit-eligibility-guard.test.ts'

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
     [(CORE, '        ...linkUpdateOf(existing, payload, autoLinked),\n',
       '        appointment_id: payload.appointment_id ?? null, // M-O2a\n')],
     [SAVE_T], ["S4-facade: a second save with no booking, same customer, keeps the first save's link"]),
    ('M-O2b', 'worker converge sends the payload booking (null clears the link)',
     [(WORKER, '      ...(fill.kept ? {} : linkUpdateOf(recordLink, { customer_id: recordLink.customer_id, appointment_id: fill.given }, autoLinked)),\n',
       '      appointment_id: payload.appointment_id ?? null, // M-O2b\n')],
     [JOB_T], ["S4-job: a job re-run with no booking keeps the first save's link"]),
    ('M-O2c', 'keepLinkUnlessGiven loses its re-point arm (the old booking rides along)',
     [(LINK, '  return (write.customer_id ?? null) !== (existing.customer_id ?? null)\n', '  return false // M-O2c\n')],
     [SAVE_T], ['S4-facade: a re-point to another customer with no booking moves both']),
    # M-O25 — A2 (S69 commit 24): the converge always sends the link key (the snapshot clobbers an interleaved link)
    ('M-O25', 'linkUpdateOf always sends the key (a no-change converge sends the snapshot back)',
     [(LINK, '  if (movesCustomer(existing, write)) return { appointment_id: null }\n  return {}\n',
       '  if (movesCustomer(existing, write)) return { appointment_id: null }\n  return { appointment_id: null } // M-O25\n')],
     [SAVE_T], ["S4-facade: a second save with no booking, same customer, keeps the first save's link"]),
    # M-O26 — A3 (S69 commit 25): the worker's fill-only guard removed (a stale job's booking overwrites a re-pick)
    ('M-O26', "fillOnlyLinkOf loses the linked-record guard (a stale job's booking lands over a re-pick)",
     [(LINK, '  if (linked !== null) return { kept: true, appointmentId: linked }\n', '')],
     [JOB_T], ['A3-job: a same-customer re-pick after the enqueue keeps its link']),
    # M-O27 — A4 (S69 commit 26): `??` back on the record's field (a returned null link reads as the computed one)
    ('M-O27', "returnedOr falls back on a returned null (the create reports the payload's booking, not core's record)",
     [(LINK, '  return returned !== undefined ? returned : computed\n', '  return returned ?? computed // M-O27\n')],
     [SAVE_T, JOB_T], ['A4-facade: core returns the record with no link', 'A4-job: core returns the record with no link']),
    # M-O28 — A5 (S69 commit 26): page 1 judged as the whole day again
    ('M-O28', 'the total/full-page check removed (a day with more bookings than one page links from page 1)',
     [(LINK, "    if ((typeof res.total === 'number' && res.total > rows.length) || rows.length >= DAY_BOOKINGS_PAGE_SIZE) {\n      return { link: 'ambiguous', appointmentId: null }\n    }\n", '')],
     [AUTO_T], ['A5: total 51 with one qualifying row', 'A5: no total and a full page']),
    # M-O29 — A4 ruled-in (S69 commit 26): the worker's create skips the keep-decided read again
    ('M-O29', "the keep-decided read skips a create again (a replayed record's decided answer is overwritten)",
     [(FATE, '  if (input.keepDecidedAnswer) {\n', '  if (input.keepDecidedAnswer && !input.fresh) { // M-O29\n')],
     [JOB_T], ['A4-job: a replayed record with a decided answer on it']),
    # M-O30 — A8 (S69 commit 27): the chokepoint answers an empty word for Error('') (the failure reads as success)
    ('M-O30', "an outcome write failure with an empty message returns error '' (read as success by the fate and the skip path)",
     [(OUTCOME_SRC, "    return { error: (err instanceof Error ? err.message : String(err)) || 'outcome write failed' }\n",
       '    return { error: err instanceof Error ? err.message : String(err) } // M-O30\n')],
     [GUARD_T, JOB_T], ["A8: the upsert rejects with Error('')", "A8 skip path: the outcome write rejects with Error('')"]),
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
     [(WORKER, "    logTag: '[job]',\n    keepDecidedAnswer: true,\n  })\n",
       "    logTag: '[job]',\n    keepDecidedAnswer: true,\n  })\n"
       "  if (fate.link.startsWith('failed:')) throw fate.cause instanceof Error ? fate.cause : new Error(String(fate.cause)) // M-O5d\n")],
     [JOB_T], ['S2/S5-job failed (the write errors)', 'S2/S5-job failed (the write THROWS)']),
    # M-O7 — the auto-link fires with two candidates or another customer/store/day (commit 4, S7)
    ('M-O7a', 'two candidates link the first (ambiguity removed)',
     [(LINK, "    if (sameDay.length > 1) return { link: 'ambiguous', appointmentId: null }\n", '')],
     [AUTO_T, SAVE_T, JOB_T], ['condition 7', 'S7-facade: two bookings', 'S7-job: two bookings']),
    ('M-O7b', 'customer check removed',
     [(LINK, '      if (a.customer_id !== input.customerId || (a.store_id ?? null) !== input.storeId) return false\n',
       '      if ((a.store_id ?? null) !== input.storeId) return false // M-O7b\n')],
     [AUTO_T], ["condition 1 — another customer's booking"]),
    ('M-O7c', 'store check removed',
     [(LINK, '      if (a.customer_id !== input.customerId || (a.store_id ?? null) !== input.storeId) return false\n',
       '      if (a.customer_id !== input.customerId) return false // M-O7c\n')],
     [AUTO_T], ['condition 2 — a booking in another store']),
    ('M-O7d', 'JST-day check removed',
     [(LINK, '      return bookingDay === null || bookingDay === day\n', '      return bookingDay === null || bookingDay !== null // M-O7d\n')],
     [AUTO_T], ['condition 3 at midnight']),
    ('M-O7e', 'other-karute check removed',
     [(LINK, '    if (other) return none\n', '')],
     [AUTO_T], ['condition 6 — another karute already points at it']),
    ('M-O7f', 'the window becomes a fixed 60/120-min constant',
     [(LINK, '    if (sessionMs < startsMs - ownMs || sessionMs > startsMs + 2 * ownMs) return none\n',
       '    if (sessionMs < startsMs - 60 * 60_000 || sessionMs > startsMs + 120 * 60_000) return none // M-O7f\n')],
     [AUTO_T], ["the window is the booking's OWN duration on each side"]),
    # M-O12 — the status filter moves back before the count (S67 fix round 2, commit 10, B-1)
    ('M-O12', 'the two-booking count sees only SCHEDULED/IN_PROGRESS again (a COMPLETED visit + the next booking links the next)',
     [(LINK, "      if (a.cancelled_at || a.status === 'CANCELLED') return false\n",
       "      if (a.cancelled_at || !LINKABLE_STATUSES.has(a.status)) return false // M-O12\n")],
     [AUTO_T], ['B-1 A5a: the real visit 09:00–10:00 already COMPLETED']),
    # M-O13 — the facade converge searches the request's store again (commit 11, SF-1)
    ('M-O13', "the converge's auto-link is handed the request store, not the record's",
     [(CORE, '        autoLinked = await autoLink({ storeId: existing.store_id ?? null })\n',
       '        autoLinked = await autoLink({ storeId: payload.store_id ?? null }) // M-O13\n')],
     [SAVE_T], ['SF-1 F-1: a converge onto a store-A karute', "SF-1 F-1b: the same converge finds the karute's OWN store-A booking"]),
    # M-O14 — the two doors fill the menu differently again (commit 12, SF-2)
    ('M-O14a', 'the one menu fill loses the booking title (both doors lose the menu)',
     [(LINK, '    return (booking as { title?: string | null } | null)?.title ?? null\n', '    return null // M-O14a\n')],
     [SAVE_T, JOB_T], ['SF-2 F-2: a create auto-linked', 'SF-2 W-F2: a create auto-linked']),
    ('M-O14b', 'the facade create skips the one menu fill (the S67 divergence)',
     [(CORE, '          service: payload.service ?? (await menuOfAutoLinked(synqed.appointments, autoLinked)),\n',
       '          service: payload.service, // M-O14b\n')],
     [SAVE_T], ['SF-2 F-2: a create auto-linked']),
    # M-O15 — a 保留 placeholder reads as a decided answer again (commit 13, SF-3(b))
    ('M-O15', 'isDecidedOutcome counts the pending placeholder as decided (the fate says kept; the worker skip path refuses the real label)',
     [(FATE, "  if (!row || row.outcome === 'pending') return false\n", '  if (!row) return false // M-O15\n')],
     [SAVE_T, JOB_T], ['SF-3 M1: a converge with no answer over a 保留 placeholder is never kept',
                       'T9 existing record + a recorded PENDING (保留) row']),
    # M-O31..M-O33 — A9 + A17 (S69 commit 28): an auto answer is not the staff's; a failed read is never not_sent
    ('M-O31', "isDecidedOutcome loses the auto_decided branch (a staff's real late answer is kept away by the auto-decide)",
     [(FATE, '  if (row.auto_decided === true && incoming) return false\n', '')],
     [JOB_T], ['A9 W1: an auto-decided no_deal + incoming success']),
    ('M-O32', 'isDecidedOutcome loses the incoming-pending guard (a stale 保留 clears an auto-decided answer)',
     [(FATE, "  if (incoming === 'pending') return true\n", '')],
     [JOB_T], ['A9 W2: an auto-decided no_deal + incoming pending']),
    ('M-O33', 'a failed keep-decided read answers not_sent again (a failure wearing the word for a true no)',
     [(FATE, "        return { link: `skipped:${input.outcomeMissing ?? 'kept_unknown'}` }\n",
       "        return { link: `skipped:${input.outcomeMissing ?? 'not_sent'}` } // M-O33\n")],
     [SAVE_T], ['A17 F1: a converge with no answer whose keep-decided read throws']),
    # M-O34..M-O35 — A11 + NIT-a (S69 commit 29): date reads are null-safe and one shape
    ('M-O34', 'jstDayOf throws on an unparseable date again (the guard answers unknown; the enqueue clogs on every retry)',
     [(DATE, '  return Number.isNaN(d.getTime()) ? null : ymdInJst(d)\n',
       "  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid time value') // M-O34\n  return ymdInJst(d)\n")],
     [RULE_T, GATE_T], ['A11 clog: a placeholder with a malformed long session_date', 'A11 R: a malformed provisional date']),
    ('M-O35', "the auto-link reads a booking's date before its cancellation (a cancelled bad-date booking blocks the good one)",
     [(LINK, "      if (a.cancelled_at || a.status === 'CANCELLED') return false\n      const bookingDay = jstDayOf(a.starts_at)\n",
       "      const bookingDay = jstDayOf(a.starts_at)\n      if (bookingDay === null) return true // M-O35\n      if (a.cancelled_at || a.status === 'CANCELLED') return false\n")],
     [AUTO_T], ['A11 L1: a CANCELLED booking with a bad date']),
    # M-O16 — the guard reads ONE page again (commit 14, SF-4; the base regression)
    ('M-O16', 'the prior-visit read stops after page 1 (placeholders push a regular off the page)',
     [(GUARD, '    if (count > 0 || rows.length < PRIOR_VISIT_PAGE_SIZE) return count\n', '    return count // M-O16\n')],
     [RULE_T, ENQ_T], ['SF-4 F-5: own record + 2 same-day placeholders', 'SF-4 M5: the enqueue exclusion',
                       'SF-4 M5: three same-day placeholders']),
    # M-O17 — the row / reply stop telling the record's link (commit 15, SF-5)
    ('M-O17a', 'appointmentLinkOf loses `kept` (a kept link reads as null again)',
     [(LINK, "  return linkReason ?? (kept ? 'kept' : (autoLink ?? null))\n", '  return linkReason ?? autoLink ?? null // M-O17a\n')],
     [SAVE_T, JOB_T], ['SF-5 F-6: a kept-link converge → row and reply say kept', 'SF-5 F-6: a kept-link converge → the row says kept']),
    ('M-O17b', "the facade's row and reply name the payload's booking, not the record's",
     [(CORE, "    const result = { ...persisted, appointmentLink:",
       "    persisted.appointmentId = payload.appointment_id ?? autoLinked?.appointmentId ?? null // M-O17b\n    const result = { ...persisted, appointmentLink:")],
     [SAVE_T], ['SF-5 F-6: a kept-link converge → row and reply say kept']),
    ('M-O17c', "the worker's row names the payload's booking, not the record's",
     [(WORKER, '      appointment_id: linkedId,\n', '      appointment_id: payload.appointment_id ?? autoLinked?.appointmentId ?? null, // M-O17c\n')],
     [JOB_T], ['SF-5 F-6: a kept-link converge → the row says kept']),
    # M-O18 — a job with no session start says 'none' again (commit 16, SF-6)
    ('M-O18', "no session start reads as 'none' (the same word as no booking)",
     [(LINK, "      return { link: 'skipped:no_session_start', appointmentId: null }\n", '      return none // M-O18\n')],
     [AUTO_T, JOB_T], ['no start → skipped:no_session_start', 'SF-6 W1: an older job with no session start']),
    # M-O19 — the worker clobbers a decided answer / files it under the stale customer (commit 17, SF-7)
    ('M-O19a', "the worker's mid-run converge overwrites a decided answer (no keep-decided check)",
     [(FATE, '    if (isDecidedOutcome(recorded, input.outcome.status)) return { link: \'kept\' }\n  }\n\n  let result',
       '  }\n\n  let result')],
     [JOB_T], ['SF-7 W10: a mid-run converge onto a record whose staff set no_deal since']),
    ('M-O19b', "the worker files the answer under the payload's stale customer",
     [(WORKER, '    customerId: recordCustomerId,\n    staffId: payload.staff_id,\n',
       '    customerId: payload.customer_id, // M-O19b\n    staffId: payload.staff_id,\n')],
     [JOB_T], ["SF-7: a mid-run converge onto a re-pointed record with no decided answer → written under the record's current customer"]),
    # M-O20 — a failed read says 'none' again (S68 fix round 3, commit 22, S-3)
    ('M-O20', "a failed read reads as 'none' (the same word as no booking)",
     [(LINK, "    return { link: 'skipped:read_failed', appointmentId: null }\n", '    return none // M-O20\n')],
     [AUTO_T, SAVE_T, JOB_T],
     ['S-3: appointments.list throws', 'S-3: the karute list (condition 6) throws',
      'S-3: the session row read throws', 'A11 L3: the session start will not parse', "S-3 F: the day's bookings cannot be read", 'S-3 F: the session row cannot be read',
      "S-3 W: the day's bookings cannot be read"]),
    # M-O21..M-O23 — A19 (S69 commit 31): the auto-link conditions Astra predicted would survive
    ('M-O21', "the window's edges become exclusive (a session exactly at start - own / start + 2 x own no longer links)",
     [(LINK, '    if (sessionMs < startsMs - ownMs || sessionMs > startsMs + 2 * ownMs) return none\n',
       '    if (sessionMs <= startsMs - ownMs || sessionMs >= startsMs + 2 * ownMs) return none // M-O21\n')],
     [AUTO_T], ['A19 M-O21: the window edges are inclusive']),
    ('M-O22', 'the duration_minutes fallback removed (a booking with no usable end time links nothing)',
     [(LINK, '        : (booking.duration_minutes ?? 0) * 60_000\n', '        : 0 // M-O22\n')],
     [AUTO_T], ['A19 M-O22: a booking with no usable end time']),
    ('M-O23', "condition 6's query loses its booking filter (the five karute read are not the ones pointing at this booking)",
     [(LINK, '    const linked = await synqed.karuteRecords.list({ appointment_id: booking.id, page_size: 5 })\n',
       '    const linked = await synqed.karuteRecords.list({ page_size: 5 }) // M-O23\n')],
     [AUTO_T], ['A19 M-O23: condition 6 asks core for the karute pointing at THIS booking']),
    # M-O24 — A19 (S69 commit 31): a failed keep-decided read (an answer rides the save) treated as kept
    ('M-O24', "a failed keep-decided read with an incoming answer reads as kept (the answer is dropped, the job completes)",
     [(FATE, "    } catch (err) {\n      return failed(err)\n    }\n    if (isDecidedOutcome(recorded, input.outcome.status)) return { link: 'kept' }\n",
       "    } catch (err) {\n      return { link: 'kept', cause: err } // M-O24\n    }\n    if (isDecidedOutcome(recorded, input.outcome.status)) return { link: 'kept' }\n")],
     [JOB_T], ["A4-job: the create's keep-decided read fails"]),
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
     [(LINK, "  return linkReason ?? (kept ? 'kept' : (autoLink ?? null))\n", "  return kept ? 'kept' : (autoLink ?? null) // M-O10\n")],
     [SAVE_T, f'{IT}/karute-save-audit.test.ts'],
     ["booking not found → 200, saved in the caller's store, link dropped",
      'booking not found → saved, one karute.save row with severity notice and appointment_link appointment_not_found']),
    # M-O11 — the worker's row computes appointment_link locally again (commit 9)
    ('M-O11', "the worker's row drops the one link expression (a local null)",
     [(WORKER, '      appointment_link: appointmentLinkOf(null, autoLinked?.link, keptLink),\n', '      appointment_link: null, // M-O11\n')],
     [JOB_T], ['S7-job: one booking in its window → created on it; the row says auto_linked',
               'S7-job: two bookings → ambiguous, no link']),
    # M-G1 — the save's return is not the walker's call-through shape (commit 6)
    ('M-G1', '`return await emitSave(...)` (the S67 list failure)',
     [(CORE, '  return emitSave({\n    id: record.id,\n', '  return await emitSave({\n    id: record.id,\n')],
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
