#!/usr/bin/env python3
"""S60 PR-A mutation proof (REV 2.3 A6). Each mutant breaks ONE rule of the
unreadable-take guard; a NAMED test file must go red for it (KILLED). Run from
the repo root on a COMMITTED tree, on Node 24:

    python3 src/__tests__/integration/mutants-s60a.py            # the whole list
    python3 src/__tests__/integration/mutants-s60a.py --only M-A4
    python3 src/__tests__/integration/mutants-s60a.py --dry-run M-A1

--dry-run applies ONE mutant, prints its diff, restores it and proves the
restoration with `git diff --quiet` — no test run (the syntax check of this
script). Every mutant is a targeted text edit whose anchor must match EXACTLY
once; the file's original bytes are written back after each run, then
`git diff --quiet` proves it. Output: a table `id · target · expected killer ·
killed?`. A survivor is printed as SURVIVED, never hidden. KILLED means the
named tests failed on assertion (Jest's JSON report); a run that proves
nothing (no JSON, a runtime-errored suite, zero tests) is BROKEN, not killed.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

IT = 'src/__tests__/integration'
FINALIZE = 'src/lib/recording/finalize-take.ts'
METER = 'src/lib/ai/transcribe.ts'
VOICE = 'src/app/api/app/v1/staff/[id]/voice/route.ts'

# The dummy values from ci.yml (not secrets) — the Node lines' ENV.
ENV = {
    'NEXT_PUBLIC_SUPABASE_URL': 'https://test-dummy.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'dummy-not-a-key',
}

METER_PROBE_BLOCK = (
    '  if (RECORDING_SWITCHES.finalizeProbe) {\n'
    '    const unreadable = await unreadableHead(params.audio)\n'
    '    if (unreadable) throw new AudioUnreadableError(unreadable)\n'
    '  }\n'
)
RELEASE_ANCHOR = '  // ⚖ RELEASED ONLY WHEN THE PROVIDER SAID NO'

# id, target, what breaks, [(file, old, new)], killer test files
MUTANTS = [
    ('M-A1', FINALIZE, 'finalize probe skipped (every head judged readable)',
     [(FINALIZE, '      const probe = await probeTakeHead(key)\n',
       "      const probe: ProbeResult = { state: 'readable', kind: 'webm' } // M-A1\n")],
     [f'{IT}/s60-a2-finalize-refusal.test.ts', f'{IT}/s60-layer-off.test.ts']),
    ('M-A2', METER, 'meter probe moved below the reserve',
     [(METER, METER_PROBE_BLOCK, ''),
      (METER, RELEASE_ANCHOR, METER_PROBE_BLOCK + RELEASE_ANCHOR)],
     [f'{IT}/s60-a3-meter-refusal.test.ts']),
    ('M-A3', FINALIZE, '`unknown` treated as `unreadable` (refused, audited)',
     # S63 re-anchor: S62 (S4) grew the one-line `unknown` return into a block
     # with its warn line; the mutant replaces the WHOLE block with the same
     # refusing line as before, so the mutated program is unchanged.
     [(FINALIZE, "      if (probe.state === 'unknown') {\n"
       "        // Fail closed (frozen R2), but never silently: codes and numbers only,\n"
       "        // never the key or the URL — a signing/Range/timeout problem shows the\n"
       "        // day it happens.\n"
       "        console.warn('[finalize-take] probe unknown', {\n"
       "          recordingSessionId: row.id,\n"
       "          reason: probe.reason,\n"
       "          bytesRead: probe.bytesRead ?? null,\n"
       "        })\n"
       "        return { error: 'failed' }\n"
       "      }\n",
       "      if (probe.state === 'unknown') return emitFinalizeRefused(actor, row.id, { bytes: input.byteLength, first_byte: -1 }) // M-A3\n")],
     [f'{IT}/s60-a2-finalize-refusal.test.ts']),
    ('M-A4', FINALIZE, 'audit row on every attempt (ignores `exists`)',
     [(FINALIZE, "        if (marked === 'created') return emitFinalizeRefused(actor, row.id, facts)\n",
       "        if (marked === 'created' || marked === 'exists') return emitFinalizeRefused(actor, row.id, facts) // M-A4\n")],
     [f'{IT}/s60-a2-finalize-refusal.test.ts']),
    ('M-A5', FINALIZE, '`first_byte` replaced by a hex string of the head',
     [(FINALIZE, 'const facts = { bytes: input.byteLength, first_byte: probe.firstByte }',
       "const facts = { bytes: input.byteLength, first_byte: probe.firstByte.toString(16).padStart(2, '0') as unknown as number } // M-A5")],
     [f'{IT}/s60-a2-finalize-refusal.test.ts']),
    ('M-A6', VOICE, 'the voice route re-inlines its own magic-bytes check',
     [(VOICE,
       "  const { kind } = sniffContainer(head)\n"
       "  return kind !== 'unknown' && VOICE_ALLOWED_CONTAINERS.has(kind)\n",
       "  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true // M-A6\n"
       "  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to))\n"
       "  if (ascii(4, 8) === 'ftyp') return true\n"
       "  return false\n")],
     [f'{IT}/app-api-staff-voice.test.ts']),
    ('M-A7', METER, 'the meter writes a `refused` mark',
     [(METER, "import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'\n",
       "import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'\n"
       "import { markTake } from '@/lib/recording/take-mark' // M-A7\n"),
      (METER, '    if (unreadable) throw new AudioUnreadableError(unreadable)\n',
       '    if (unreadable && meter.audioKey) {\n'
       "      await markTake(createServiceClient(), meter.businessId, meter.audioKey, 'refused', {\n"
       '        bytes: unreadable.bytesRead,\n'
       '        first_byte: unreadable.firstByte,\n'
       '      }) // M-A7\n'
       '    }\n'
       '    if (unreadable) throw new AudioUnreadableError(unreadable)\n')],
     [f'{IT}/s60-layer-off.test.ts', f'{IT}/s60-a3-meter-refusal.test.ts']),
    ('M-A8.f', FINALIZE, 'finalize refusal keyed on the key\'s extension',
     [(FINALIZE, '      const probe = await probeTakeHead(key)\n',
       '      const probe = await probeTakeHead(key)\n'
       "      if (probe.state === 'readable' && !key.endsWith(`.${probe.kind}`)) return { error: 'unreadable_object' } // M-A8\n")],
     [f'{IT}/s60-layer-off.test.ts']),
    ('M-A8.m', METER, 'meter refusal keyed on the URL\'s extension',
     [(METER, "  return probe.state === 'unreadable' ? { firstByte: probe.firstByte, bytesRead: probe.bytesRead } : null\n",
       "  if (probe.state === 'readable' && /\\.webm(\\?|$)/.test(audio.url) && probe.kind !== 'webm') return { firstByte: -1, bytesRead: 0 } // M-A8\n"
       "  return probe.state === 'unreadable' ? { firstByte: probe.firstByte, bytesRead: probe.bytesRead } : null\n")],
     [f'{IT}/s60-layer-off.test.ts', f'{IT}/s60-a3-meter-refusal.test.ts']),
]


def git_clean(paths):
    out = subprocess.run(['git', 'status', '--porcelain', '--', *paths], capture_output=True, text=True, check=True)
    return out.stdout.strip() == ''


def apply(edits):
    """Apply every edit; return {file: original bytes}. Refuses an anchor that
    does not match EXACTLY once — a mutant that silently applies nowhere would
    report a false SURVIVED (or worse, a false KILLED)."""
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


def run_killers(killers, env):
    """S63 FIX-3 (Greptile thread 5, codex 14, D6): a KILL is the named tests
    FAILING ON ASSERTION, never any nonzero exit. Jest writes its JSON report;
    KILLED requires it to parse, success false, numFailedTests > 0 and
    numRuntimeErrorTestSuites == 0. SURVIVED requires the same report with
    success true. Anything else (no JSON, a runtime-errored suite, zero tests)
    is BROKEN — never counted as killed. Returns (verdict, why, failed names)."""
    fd, out = tempfile.mkstemp(prefix='mutants-s60a-', suffix='.json')
    os.close(fd)
    os.unlink(out)
    try:
        subprocess.run(['npx', 'jest', *killers, '--silent', '--json', '--outputFile', out], env=env,
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
    if success is False and failed_n > 0:
        names = [a.get('fullName') or a.get('title') or '?'
                 for tr in rep.get('testResults', [])
                 for a in tr.get('assertionResults', [])
                 if a.get('status') == 'failed']
        return 'KILLED', '', names
    if success is True and failed_n == 0:
        return 'SURVIVED', '', []
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
    targets = sorted({e[0] for m in chosen for e in m[3]})
    if not git_clean(targets):
        raise SystemExit('refusing to run: the source files under mutation are dirty')

    env = {**os.environ, **ENV}
    rows = []
    for mid, target, what, edits, killers in chosen:
        originals = apply(edits)
        try:
            if args.dry_run:
                subprocess.run(['git', '--no-pager', 'diff', '--stat', '--', *originals])
                verdict = 'dry-run'
            else:
                verdict, why, failed = run_killers(killers, env)
                if verdict == 'BROKEN':
                    print(f'BROKEN {mid} {why}')
                for name in failed:
                    print(f'  {mid} killed by: {name}')
        finally:
            restore(originals)
        rows.append((mid, f'{target} — {what}', ' + '.join(os.path.basename(k) for k in killers), verdict))

    print('id · target · expected killer · killed?')
    for row in rows:
        print(' · '.join(row))
    whole = subprocess.run(['git', 'diff', '--quiet']).returncode == 0
    print(f'restored: git diff --quiet → {"clean" if whole else "DIRTY"}')
    if not whole or any(r[3] in ('SURVIVED', 'BROKEN') for r in rows):
        sys.exit(1)


if __name__ == '__main__':
    main()
