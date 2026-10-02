#!/usr/bin/env python3
"""PR-B commit 8 mutation proof (PACKET-S64-PRB P:90 + RULING-S72-PRB-WEB-DOOR R-4
+ R-I5 + R-S74-10/11/12 = M-B1…M-B17; BUILD-S64-PRB § S76 register = M-S75-1…17
incl. 5b/6b; LAUNCH-S84-PRB-C8). Shape copied from mutants-s65o.py.

    python3 src/__tests__/integration/mutants-s64b.py                 # all, Node on PATH
    python3 src/__tests__/integration/mutants-s64b.py --node20        # all, Node 20 via npx
    python3 src/__tests__/integration/mutants-s64b.py --only M-B16
    python3 src/__tests__/integration/mutants-s64b.py --dry-run all   # apply + restore, no tests
    python3 src/__tests__/integration/mutants-s64b.py --discover M-B4 # list the red tests

Kill rule (K-7, verbatim from mutants-s65o.py): a mutant is KILLED only when
Jest's JSON report parses, success is false, no suite errored at runtime, and
EVERY test named for that mutant is among the tests that failed on assertion.
Red tests that miss a named one = MISSED; a green run = SURVIVED; no JSON / a
runtime-errored suite / zero tests = BROKEN. Only KILLED passes. A mutant with
no named test yet (None) is never given a verdict: --discover it first.

Every mutant edits PRODUCTION files only; each anchor must match EXACTLY once.
After each run the original bytes are written back and every edited file is
compared byte-for-byte with `git show HEAD:<path>` (R-S84-2: production is at
HEAD; the commit-8 test files may be uncommitted), and `git status
--porcelain` must equal the snapshot taken before the first mutant.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

IT = 'src/__tests__/integration'
FATE = 'src/lib/recording/blob-fate.ts'
SECURE = 'src/lib/recording/secure-take.ts'
STORE = 'src/lib/karute/take-store.ts'
THIN = 'thin/ports/recording.vite.ts'
WEB = 'src/lib/ports/recording-port.ts'
DIAG = 'src/lib/recording/take-diag.ts'
INBOX = 'src/lib/recordings/inbox.ts'
CARD = 'src/components/karute/redesign/record/PipelineErrorCard.tsx'
REC = 'src/lib/global-recorder.ts'
GP = 'src/lib/global-pipeline.ts'
AIP = 'src/lib/ai-pipeline.ts'
SW = 'src/lib/recording/recording-switches.ts'
UPL = 'src/lib/recording/segment-uploader.ts'

DOOR_T = f'{IT}/prb-damaged-blob-door.test.ts'
CARD_T = f'{IT}/prb-card-tells-truth.test.tsx'
FLIGHT_T = f'{IT}/prb-flight-record.test.ts'
HIST_T = f'{IT}/prb-history-row.test.tsx'
PUMP_T = f'{IT}/prb-pump-stop.test.ts'
T5B_T = f'{IT}/prb-t5b-session-null-diff.test.ts'
TD_T = f'{IT}/take-durability.test.ts'
W1_T = f'{IT}/s76-w1-held-copy-wins.test.ts'
A5_T = f'{IT}/s76-a5-start-guard.test.ts'
W2_T = f'{IT}/s76-w2-late-commit.test.ts'
W3D_T = f'{IT}/s76-w3-damaged-row.test.ts'
W3R_T = f'{IT}/s76-w3-row-tells-truth.test.ts'

ENV = {  # LAUNCH-S72 TESTING RULE — dummy values, never a .env
    'NEXT_PUBLIC_SUPABASE_URL': 'https://test-dummy.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'dummy-not-a-key',
}

HELD_BLOCK = (
    "    const held = meta.heldUpload\n"
    "    if (RECORDING_SWITCHES.stagedPartialDoor && held && meta.recordingSessionId) {\n"
    "      const mime = meta.mimeType || DEFAULT_MIME\n"
    "      if ((await finishHeldUpload(port, takeId, mime, meta.recordingSessionId, held, meta.secureError)) !== 'absent')\n"
    "        return\n"
    "    }\n"
)
TERMINAL_LINE = "    if (meta.secureError && TERMINAL_SECURE_ERRORS.has(meta.secureError)) return\n"
PARTIAL_LINE = "              ...(opts.partial === true ? { partial: true } : {}),\n"

# id, what breaks, [(file, old, new)], killer suites, named tests (substrings of
# the Jest fullName; EVERY one must fail for a KILL; None = not named yet)
MUTANTS = [
    # ── M-B1…M-B11: PACKET-S64-PRB.md:90, in the packet's order ──
    ('M-B1', 'sniff skipped (a headless blob is never unreadable)',
     [(FATE, "  if (facts.head && facts.head.length >= PROBE_MIN_HEAD_BYTES && sniffContainer(facts.head).kind === 'unknown')\n    return 'unreadable'\n", '')],
     [DOOR_T], ['R-2 on the thin port (i) damaged + session, unreadable (no container head)', 'the verdict (B1, B7) two facts decide']),
    ('M-B2', 'byte compare inverted',
     [(FATE, 'facts.size < facts.bytesEmitted', 'facts.size > facts.bytesEmitted')],
     [DOOR_T], ['R-2 on the thin port (i) damaged + session, partial (fewer bytes than the recorder emitted)']),
    ('M-B3', '`partial:false` sent (thin staged body)',
     [(THIN, PARTIAL_LINE, '              partial: opts.partial === true,\n')],
     [DOOR_T], ['R-2 on the thin port a staged body without partial never carries partial:false (N2)']),
    ('M-B4', '`partial` sent on a client-named mint body (thin take-key mint)',
     [(THIN, '      body: JSON.stringify({ takeId, mimeType, recordingSessionId }),\n',
       '      body: JSON.stringify({ takeId, mimeType, recordingSessionId, partial: true }),\n')],
     [DOOR_T], ['M-B4 — the thin take-key mint body never carries partial']),  # R-S84-4 path 2 (dedicated test)
    ('M-B5', 'invalid `diag` sent (the phone check keeps a bad value)',
     [(DIAG, '    if (!ok) return undefined\n', '    if (!ok) void 0\n')],
     [FLIGHT_T], ['send a valid diag or none (A13) first_byte = 256 → the phone omits the whole diag']),
    ('M-B6', 'the damaged codes missing from the terminal set (the loop keeps retrying)',
     [(STORE, '  ...(RECORDING_SWITCHES.stagedPartialDoor ? [...DAMAGED_SECURE_CODES] : []),\n', '')],
     [TD_T], ['damaged audio_partial, no receipt, through settle → SEALED, live empty']),  # R-S84-4 path 1 (existing Wn row, red on toEqual)
    ('M-B7', 'the prune deletes a partial take',
     [(STORE, 'so it is never pruned.\n  if (isDamagedTake(meta)) return false\n', 'so it is never pruned.\n')],
     [TD_T], ['a damaged take is never pruned (B3, B-S66-3) audio_partial: staged + words settled + 8 days']),
    ('M-B8', '`oncomplete` not awaited (the append answers before the commit)',
     [(STORE, '      if (RECORDING_SWITCHES.awaitSegmentCommit && !(await segmentCommitted(tx))) return false\n',
       '      if (RECORDING_SWITCHES.awaitSegmentCommit) void segmentCommitted(tx)\n')],
     [TD_T], ['P:89 a transaction that aborts after onsuccess → false']),
    ('M-B9', 'retry shown for a new code (audio-partial)',
     [(CARD, "code === 'audio-unreadable' || code === 'audio-partial'", "code === 'audio-unreadable'")],
     [CARD_T], ['the card tells the truth audio-partial → its own sentence, a labelled reference number, and NO 再試行']),
    ('M-B10', 'reference number missing',
     [(STORE, '    return meta.takeId.slice(0, 8)\n  return meta.recordingSessionId ? meta.recordingSessionId.slice(0, 8) : null\n',
       '    return null\n  return null\n')],
     [CARD_T], ['takeReference — ONE home (B11/F12d) the take uuid first, else the session id, else null']),
    ('M-B11', '`bytesEmitted` not mirrored',
     [(STORE, '      const counted = emitted === undefined ? meta : { ...meta, bytesEmitted: emitted }\n', '      const counted = meta\n')],
     [TD_T], ['PR-B commit 1 — the recorder counts what it emits mirrors the bytes on disk into the take meta at every flush']),
    # ── M-B12/M-B13: RULING-S72-PRB-WEB-DOOR R-4 ──
    ('M-B12', 'the staged branch refuses a damaged blob',
     [(SECURE, "  if (fate !== 'ok') {\n    const staged = await port.prepareTranscription(",
       "  if (fate !== 'ok') {\n    throw new Error('M-B12 staged branch refuses')\n    const staged = await port.prepareTranscription(")],
     [DOOR_T], ['R-2 on the thin port (i) damaged + session, unreadable', 'R-2 on the web port (i) damaged + session, unreadable']),
    ('M-B13', 'the web staged body drops `partial`',
     [(WEB, PARTIAL_LINE, '')],
     [DOOR_T], ['R-2 on the web port (i) damaged + session, unreadable (no container head) → one staged PUT with partial:true']),
    # ── M-B14: R-I5 ──
    ('M-B14', 'the history row keeps 再試行 for an unreadable job',
     [(INBOX, "        canRetry: !damaged && !take?.damaged && (!!take || s.serverAudio === 'object'),\n",
       "        canRetry: !take?.damaged && (!!take || s.serverAudio === 'object'),\n")],
     [HIST_T], ['an audio_unreadable job → the card\'s string on the row, no 再試行 button (M-B14)']),
    # ── M-B15/16/17: R-S74-10 / -11 / -12 ──
    ('M-B15', 'the pump stops without a code',
     [(UPL, '  if (!RECORDING_SWITCHES.takeDiag || lastPumpStop.get(takeId) === stop) return\n', '  return\n')],
     [PUMP_T], ['an exit records its code; the same code again writes nothing; a new code writes once']),
    ('M-B16', 'the stop leg passes zero instead of the session-null difference',
     [(REC, '              nullReads,\n', '              0,\n')],
     [T5B_T], ["the recorder's start-to-stop difference reaches the finalize input"]),
    ('M-B17', "a long take's hidden count comes up short (counted from the bounded ring)",
     [(DIAG, '  return { diagRing: pushDiagEntry(m.diagRing, { ...e, at }), diagCounts, lastPumpStop }\n',
       "  const diagRing = pushDiagEntry(m.diagRing, { ...e, at })\n"
       "  return { diagRing, diagCounts: { ...diagCounts, hidden: diagRing.filter((x) => x.code === 'hidden').length }, lastPumpStop }\n")],
     [DOOR_T], ['M-B17: one early hidden, then > 64 alternating pump exits']),
    # ── M-S75-*: BUILD-S64-PRB.md § S76 — Commit W, the register ──
    ('M-S75-1', 'the choke point ignores heldCopyWins',
     [(SECURE, '      heldCopyWins(blob.size, { size: stored.size, bytesEmitted: meta.bytesEmitted, tailIncomplete: meta.tailIncomplete })\n',
       '      false\n')],
     [W1_T], ['RED 2 → green: the TAKE-KEY route']),
    ('M-S75-2', 'heldCopyWins size-only',
     [(FATE, "  return decideBlobFate({ ...stored, head: null, size: stored.size }) === 'partial' && heldBytes > stored.size\n",
       '  return heldBytes > stored.size\n')],
     [W1_T], ['R-S77-5 — a whole stored copy is not beaten by size alone']),
    ('M-S75-3', 'the :276 belt ignores heldCopyWins',
     [(AIP, '        (s) => heldCopyWins(audioBlob.size, { size: s?.size, bytesEmitted: after?.bytesEmitted, tailIncomplete: after?.tailIncomplete }),\n',
       '        () => false,\n')],
     [W1_T], ['R-S76-8 — the damaged belt sizes by the REAL stored copy']),
    ('M-S75-4', '`>` → `>=` in heldCopyWins',
     [(FATE, "=== 'partial' && heldBytes > stored.size", "=== 'partial' && heldBytes >= stored.size")],
     [W1_T], ['(c) stored == held (LIMIT 14) → refused as partial']),
    ('M-S75-5', 'the start() guard removed',
     [(GP, '    const keep =\n      RECORDING_SWITCHES.stagedPartialDoor &&\n', '    const keep =\n      false &&\n')],
     [A5_T], ['A5 — start() guard kept blob']),
    ('M-S75-5b', 'the guard ignores takeId',
     [(GP, '      this.context?.takeId === context.takeId &&\n', '')],
     [A5_T], ['A5 — start() guard another take']),
    ('M-S75-6', 'the note never written before the mint',
     [(SECURE, '      if (held && !(await markTakeHeldUpload(takeId, blob.size, durationSeconds))) return null\n', '')],
     [W1_T], ['RED 2 → green: the TAKE-KEY route']),
    ('M-S75-6b', 'the upload proceeds when the note failed',
     [(SECURE, '      if (held && !(await markTakeHeldUpload(takeId, blob.size, durationSeconds))) return null\n',
       '      if (held) await markTakeHeldUpload(takeId, blob.size, durationSeconds)\n')],
     [W1_T], ['A1: the note did not commit']),
    ('M-S75-7', 'the held branch after the terminal check',
     [(SECURE, HELD_BLOCK, ''), (SECURE, TERMINAL_LINE, TERMINAL_LINE + HELD_BLOCK)],
     [W1_T], ['…the same with audio_partial pre-marked']),
    ('M-S75-8', 'the held branch PUTs on a url',
     [(SECURE, "    if ('url' in minted && minted.url) {\n      await clear()\n",
       "    if ('url' in minted && minted.url) {\n      await fetch(minted.url, { method: 'PUT', body: new Blob([]) })\n      await clear()\n")],
     [W1_T], ['(i) mint answers a url (nothing landed)']),
    ('M-S75-9', 'finalize with the stored size',
     [(SECURE, '      byteLength: held.bytes,\n', '      byteLength: (await loadTakeBlob(takeId))?.size ?? held.bytes,\n')],
     [W1_T], ['no url (the PUT landed) → finalize the NOTED size']),
    ('M-S75-10', 'awaitSegmentCommit default true',
     [(SW, '  awaitSegmentCommit: false,\n', '  awaitSegmentCommit: true,\n')],
     [W2_T], ['RED: the append answer agrees with the disk']),
    ('M-S75-11', 'listOwnTakes omits damaged',
     [(STORE, '...(damaged ? { damaged } : {}),\n', '\n')],
     [TD_T], ['S76 A4: audio_partial alone']),
    ('M-S75-12', 'damagedKind ignores the switch',
     [(STORE, '  if (kind || !RECORDING_SWITCHES.stagedPartialDoor || meta.tailIncomplete !== true) return kind\n',
       '  if (kind || meta.tailIncomplete !== true) return kind\n')],
     [W3R_T], ['damagedKind — the code’s kind plus R-S76-7’s rows only; never the note switch false']),
    ('M-S75-13', 'the damaged helper in the session branch only (the no-job branch drops it)',
     [(INBOX, "      rows.push(withDamage({ ...base, state: 'recoverable', reason: recoverableReason(take) }, take))\n",
       "      rows.push({ ...base, state: 'recoverable', reason: recoverableReason(take) })\n")],
     [W3R_T], ['no job + take → damaged row']),
    ('M-S75-14', 'FAILED/DONE keep 再試行 for a damaged take',
     [(INBOX, "        canRetry: !damaged && !take?.damaged && (!!take || s.serverAudio === 'object'),\n",
       "        canRetry: !damaged && (!!take || s.serverAudio === 'object'),\n"),
      (INBOX, '        canRetry: !!take && !take.damaged,\n', '        canRetry: !!take,\n')],
     [W3R_T], ['FAILED job + damaged take → the local damaged word, no 再試行', 'DONE job + damaged take → no 再試行']),
    ('M-S75-15', 'partial ↔ unreadable swapped on the row',
     [(INBOX, "  return damaged === 'partial' ? 'audioPartial' : 'audioUnreadable'\n",
       "  return damaged === 'partial' ? 'audioUnreadable' : 'audioPartial'\n")],
     [W3D_T], ["secureError 'audio_partial' → reason audioPartial"]),
    ('M-S75-16', 'damaged beats unsettled',
     [(INBOX, '    rows.push(unsettled ? row : withDamage(row, take))\n', '    rows.push(withDamage(row, take))\n')],
     [W3R_T], ['unlisted session: past the grace → damaged; inside the grace → unsettled']),
    ('M-S75-17', 'unreadable_object → partial',
     [(STORE, "  return code === AUDIO_PARTIAL ? 'partial' : 'unreadable'\n",
       "  return code === AUDIO_PARTIAL || code === UNREADABLE_OBJECT ? 'partial' : 'unreadable'\n")],
     [TD_T], ['S76 A4: unreadable_object']),
]


def sh(*a):
    return subprocess.run(list(a), capture_output=True, check=True).stdout


def porcelain():
    return sh('git', 'status', '--porcelain').decode()


def apply(edits):
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
            raise SystemExit(f'anchor matched {n}x (need 1) in {path}: {old[:70]!r}')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text.replace(old, new, 1))
    return originals


def restore(originals):
    """Write the original bytes back; each must equal `git show HEAD:<path>`."""
    proofs = []
    for path, data in originals.items():
        with open(path, 'wb') as f:
            f.write(data)
        with open(path, 'rb') as f:
            now = f.read()
        if now != sh('git', 'show', f'HEAD:{path}'):
            raise SystemExit(f'RESTORE FAILED: {path} differs from git show HEAD:{path}')
        proofs.append(f'{path} cmp HEAD identical ({len(now)} B)')
    return proofs


def jest_cmd(node20, killers, out):
    pre = ['npx', '--yes', '--package=node@20', '--'] if node20 else []
    return pre + ['npx', 'jest', '--ci', *killers, '--silent', '--json', '--outputFile', out]


def run_killers(killers, named, env, node20):
    fd, out = tempfile.mkstemp(prefix='mutants-s64b-', suffix='.json')
    os.close(fd)
    os.unlink(out)
    try:
        subprocess.run(jest_cmd(node20, killers, out), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            with open(out, encoding='utf-8') as f:
                rep = json.load(f)
        except (OSError, ValueError) as e:
            return 'BROKEN', f'no parseable jest JSON ({type(e).__name__})', [], {}
    finally:
        if os.path.exists(out):
            os.unlink(out)
    counts = {k: rep.get(k) for k in ('numTotalTests', 'numFailedTests', 'numPassedTests', 'numRuntimeErrorTestSuites', 'success')}
    if rep.get('numRuntimeErrorTestSuites', 0) != 0:
        return 'BROKEN', f"{rep['numRuntimeErrorTestSuites']} runtime-errored suite(s)", [], counts
    if not rep.get('numTotalTests', 0):
        return 'BROKEN', 'zero tests ran', [], counts
    failed = [a.get('fullName') or a.get('title') or '?'
              for tr in rep.get('testResults', []) for a in tr.get('assertionResults', []) if a.get('status') == 'failed']
    success, failed_n = rep.get('success'), rep.get('numFailedTests', 0)
    if success is True and failed_n == 0:
        return 'SURVIVED', '', [], counts
    if success is False and failed_n > 0:
        if named is None:
            return 'DISCOVERED', 'no named test yet', failed, counts
        missing = [n for n in named if not any(n in f for f in failed)]
        if missing:
            return 'MISSED', 'named test(s) stayed green: ' + ' | '.join(missing), failed, counts
        return 'KILLED', '', failed, counts
    return 'BROKEN', f'success={success} numFailedTests={failed_n}', [], counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='run one mutant id')
    ap.add_argument('--dry-run', metavar='ID', help="apply + restore one mutant (or 'all'), no test run")
    ap.add_argument('--discover', metavar='ID', help='run one mutant and list its red tests (no verdict)')
    ap.add_argument('--node20', action='store_true', help='npx --yes --package=node@20 -- npx jest')
    ap.add_argument('--out', help='transcript directory (one file per mutant)')
    args = ap.parse_args()

    ids = [m[0] for m in MUTANTS]
    pick = args.discover or args.only or (args.dry_run if args.dry_run != 'all' else None)
    if pick and pick not in ids:
        raise SystemExit(f'unknown mutant {pick}; known: {", ".join(ids)}')
    chosen = [m for m in MUTANTS if not pick or m[0] == pick]
    if not args.dry_run and not args.discover:
        unnamed = [m[0] for m in chosen if m[4] is None]
        if unnamed:
            raise SystemExit(f'refusing to run: no named test yet for {unnamed} (--discover them first)')
    targets = sorted({e[0] for m in chosen for e in m[2]})
    for t in targets:  # production must be at HEAD before any edit
        with open(t, 'rb') as f:
            if f.read() != sh('git', 'show', f'HEAD:{t}'):
                raise SystemExit(f'refusing to run: {t} differs from HEAD')
    before = porcelain()
    node = sh(*(['npx', '--yes', '--package=node@20', '--', 'node', '-v'] if args.node20 else ['node', '-v'])).decode().strip()
    print(f'node {node} · {len(chosen)} mutant(s)')
    env = {**os.environ, **ENV}
    if args.out:
        os.makedirs(args.out, exist_ok=True)
    rows = []
    for mid, what, edits, killers, named in chosen:
        originals = apply(edits)
        failed, counts, why = [], {}, ''
        try:
            if args.dry_run:
                verdict = 'applied'
            else:
                verdict, why, failed, counts = run_killers(killers, named, env, args.node20)
        finally:
            proofs = restore(originals)
        if porcelain() != before:
            raise SystemExit(f'RESTORE FAILED: git status --porcelain changed after {mid}')
        suites = ' + '.join(os.path.basename(k) for k in killers)
        rows.append((mid, verdict, suites, why))
        if args.out:
            with open(os.path.join(args.out, f'{mid}.txt'), 'w', encoding='utf-8') as f:
                f.write(f'{mid} · node {node} · {verdict} {why}\nwhat: {what}\n')
                for p, o, n in edits:
                    f.write(f'edit {p}\n--- {o!r}\n+++ {n!r}\n')
                f.write(f'killers: {suites}\nnamed: {named}\njest: {json.dumps(counts)}\n')
                f.writelines(f'red: {n}\n' for n in failed)
                f.writelines(f'restore: {p}\n' for p in proofs)
                f.write('porcelain: unchanged from the pre-run snapshot\n')
        print(f'{mid} · {verdict} · {suites}' + (f' · {why}' if why else ''))
        if args.discover:
            for n in failed:
                print(f'  red: {n}')
        if verdict in ('SURVIVED', 'MISSED', 'BROKEN'):
            print(f'STOP at {mid}: {verdict}')
            sys.exit(2)
    ok = sum(1 for r in rows if r[1] in ('KILLED', 'applied', 'DISCOVERED'))
    print(f'node {node} · {ok}/{len(rows)} {"applied" if args.dry_run else "KILLED"} · porcelain unchanged · every restore cmp HEAD identical')


if __name__ == '__main__':
    main()
