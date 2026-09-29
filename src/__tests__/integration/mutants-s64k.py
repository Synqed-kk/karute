#!/usr/bin/env python3
"""PR-K mutation proof (PACKET-S64-PRK commit 3; RULING A8 adds M-K7..M-K9,
drops M-K5 as never-had; S67 fix round 1 adds M-K10/M-K11 = the attacker's
X2/X3 on the staged reader, and M-K12 = the unreadable branch's partial mark). Each mutant breaks ONE rule of 「a mark names an
object the server named」 or of the refused mark's partial flag; a NAMED test
file must go red for it (KILLED). Run from the repo root on a COMMITTED tree:

    python3 src/__tests__/integration/mutants-s64k.py            # the whole list
    python3 src/__tests__/integration/mutants-s64k.py --only M-K4
    python3 src/__tests__/integration/mutants-s64k.py --dry-run M-K1

Same contract as mutants-s60a.py (the S63 kill rule): every anchor must match
EXACTLY once; the file's original bytes are written back after each run and
`git diff --quiet` proves it; KILLED = the named tests FAILED ON ASSERTION in
Jest's JSON report (numFailedTests > 0, no runtime-errored suite); a crash or
zero tests = BROKEN; all green = SURVIVED. Neither is ever counted as killed.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

IT = 'src/__tests__/integration'
GRAMMAR = 'src/lib/recording/key-grammar.ts'
MARK = 'src/lib/recording/take-mark.ts'
MINT = 'src/lib/recording/mint-take-url.ts'
FINALIZE = 'src/lib/recording/finalize-take.ts'

# The dummy values from ci.yml (not secrets) — the Node lines' ENV.
ENV = {
    'NEXT_PUBLIC_SUPABASE_URL': 'https://test-dummy.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY': 'dummy-not-a-key',
}

K1_TESTS = f'{IT}/s64-k1-mark-keyed-from-row.test.ts'
SITES = f'{IT}/s64-k1-takeid-sites.test.ts'
K2_TESTS = f'{IT}/s64-k2-refused-partial.test.ts'
LAYER = f'{IT}/s64-k3-layer-off.test.ts'
A5 = f'{IT}/s60-a5-diag-partial.test.ts'
# S67 fix round 1 (Greptile #1099 thread 2, attack SF2): the attacker's X2 / X3.
STAGED_READER = f'{IT}/s67-k-staged-reader.test.ts'

STAGED_TARGET = "    slot === 'staged' ? { door: 'staged', key: composed.key } : null,\n"

# id, target, what breaks, [(file, old, new)], killer test files
MUTANTS = [
    ('M-K1', MINT, 'the staged mark key recomposed from the request MIME (a take key again)',
     [(MINT, STAGED_TARGET,
       "    slot === 'staged' ? { door: 'take', key: composeTakeKey(businessId, composed.uuid, (input as { mimeType?: string }).mimeType ?? DEFAULT_MIME)!.key } : null, // M-K1\n")],
     [K1_TESTS, A5]),
    ('M-K2', MINT, 'the hint uuid used in place of the row pointer\'s take',
     [(MINT, '      rowTake ?? input.stagedTake,\n    )\n', '      input.stagedTake, // M-K2\n    )\n')],
     [K1_TESTS, A5]),
    ('M-K3', MINT, 'a foreign-hint mark written under mrk/app_ (the hint\'s take key)',
     [(MINT, STAGED_TARGET,
       "    slot === 'staged' ? { door: 'take', key: `app_${businessId}_${composed.uuid}.${composed.key.split('.').pop()}` } : null, // M-K3\n")],
     [K1_TESTS]),
    ('M-K4', FINALIZE, 'the refused body drops `partial`',
     [(FINALIZE, '          partial: input.partial === true,\n', '          partial: false, // M-K4\n')],
     [K2_TESTS]),
    ('M-K6', MINT, 'the staged-key mark written when the switch is OFF',
     [(MINT, "  if (!RECORDING_SWITCHES.finalizeProbe) return 'switch_off'\n",
       "  if (!RECORDING_SWITCHES.finalizeProbe && target?.door !== 'staged') return 'switch_off' // M-K6\n")],
     [LAYER, K1_TESTS]),
    ('M-K7', MARK, 'readMarkBody always returns partial:null',
     [(MARK, '    partial: m.partial === true ? true : null,\n', '    partial: null, // M-K7\n')],
     [K2_TESTS]),
    ('M-K8', GRAMMAR, 'the staged mark parse exposes the hint uuid as a top-level takeId',
     [(GRAMMAR, '        mark: mark as MarkKind,\n      }\n    }\n    return null\n',
       '        mark: mark as MarkKind,\n        takeId: uuid, // M-K8\n      } as never\n    }\n    return null\n')],
     [K1_TESTS, SITES]),
    ('M-K9', MARK, 'markTake accepts a staged key (the finalize path can write a staged mark)',
     [(MARK, "    if (parseRecordingKey(takeKey, businessId)?.kind !== 'take') return 'error'\n", '    // M-K9: take-key guard removed\n')],
     [K1_TESTS]),
    ('M-K10', MARK, 'the staged listing page size 100 -> 1 (the attacker\'s X2)',
     [(MARK, 'const STAGED_MARK_PAGE_SIZE = 100\n', 'const STAGED_MARK_PAGE_SIZE = 1 // M-K10\n')],
     [STAGED_READER]),
    ('M-K11', MARK, 'readStagedMarks unsorted, reversed (the attacker\'s X3)',
     [(MARK, '    .filter((m): m is StagedMark => m !== null)\n    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))\n',
       '    .filter((m): m is StagedMark => m !== null)\n    .reverse() // M-K11\n')],
     [STAGED_READER]),
    ('M-K12', FINALIZE, 'the extra partial write in the unreadable branch removed (Greptile thread 3)',
     [(FINALIZE, "        if (input.partial === true && (marked === 'created' || marked === 'exists')) {\n",
       "        if (false) { // M-K12\n")],
     [K2_TESTS]),
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
    fd, out = tempfile.mkstemp(prefix='mutants-s64k-', suffix='.json')
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
