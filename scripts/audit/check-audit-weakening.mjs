#!/usr/bin/env node
// CP8 — audit-weakening gate (contract §8, round-2 amendment D). Compares
// HEAD's audit taxonomy (src/lib/audit.ts + src/lib/audit-policy.ts, read
// from DISK — catches uncommitted local edits too) against origin/main's
// committed version. A WEAKENING —
//   - a map/decision row: live→skip, live→pendingWave, deleted, or a quiet
//     RECATEGORIZATION (category changed while staying live);
//   - a non-live row's pendingWave VALUE changing (date pushed out, wave
//     letter changed) — not a hard-fail on a past date, just ledger-tracked;
//   - a live row's action or targetType swapped (still emits, wrong thing);
//   - an AUDIT_ACTIONS member removed;
//   - an AUDITED_CORES entry/symbol removed — including renames (rename
//     tolerance was removed, fix round 1 #8: symbol-set matching is unsound
//     with generic route symbol lists; a genuine rename takes a ledger line);
//   - ANY allowlist ADDITION (a newly-legalized silent write), including a
//     symbol added to an existing entry — exempt ONCE while the LEDGER
//     doesn't exist on main yet (this PR's own bootstrap; keyed on the
//     ledger, not audit-policy.ts, because the ledger is undeletable once
//     merged — append-only — so the window provably never reopens) —
// passes ONLY if docs/audit-weakening-ledger.md has an ADDED line (vs main)
// naming the affected key, AND the ledger's diff has NO removed lines
// (append-only — an edited/deleted old entry breaks the audit trail; each
// weakened key gets its own new line, never piggybacked onto an edited one).
// Strengthenings (skip/pendingWave→live, allowlist removal, new actions)
// pass free, no ledger entry needed.
//
// Supersedes the CP8-forerunner hardcoded pin (facade-audit-totality.test.ts,
// deleted by this PR) — that pin caught a live-row reclassification because
// the SNAPSHOT and the map moved in lockstep; this script instead diffs
// against main directly, so no snapshot can silently drift with the map.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseFacadeAuditMap,
  parseApiRouteDecisions,
  parseAuditActions,
  parseAuditedCores,
  parseAllowlist,
} from './parse-audit-source.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LEDGER_PATH = 'docs/audit-weakening-ledger.md'
const MIN_MAP_ROWS = 50
const MIN_DECISION_ROWS = 10

function fail(msg) {
  console.error(`[check-audit-weakening] ${msg}`)
  process.exit(2)
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}

function tryGit(args) {
  try {
    return git(args)
  } catch {
    return null
  }
}

function resolveMainRef() {
  if (tryGit(['rev-parse', '--verify', 'refs/remotes/origin/main']) !== null) {
    return 'refs/remotes/origin/main'
  }
  if (tryGit(['rev-parse', '--verify', 'FETCH_HEAD']) !== null) {
    return 'FETCH_HEAD'
  }
  fail(
    'could not resolve refs/remotes/origin/main or FETCH_HEAD — CI must `git fetch origin main` (or ' +
      'main:refs/remotes/origin/main) before running this script.',
  )
}

/** Content of `path` at `ref`, or null if the file doesn't exist there yet
 *  (tolerated ONLY for audit-policy.ts — this PR ADDS that file, so main
 *  never has it before this PR merges: the bootstrap case). */
function readAtRef(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, encoding: 'utf8' })
  } catch {
    return null
  }
}

function parseVersion(auditText, policyText, label) {
  const mapRows = auditText ? parseFacadeAuditMap(auditText) : {}
  const decisionRows = auditText ? parseApiRouteDecisions(auditText) : {}
  const actions = policyText ? parseAuditActions(policyText) : []
  const auditedCores = policyText ? parseAuditedCores(policyText) : []
  const sdkAllowlist = policyText ? parseAllowlist(policyText, 'SDK_WRITE_ALLOWLIST') : []
  const rawAllowlist = policyText ? parseAllowlist(policyText, 'RAW_SUPABASE_WRITE_ALLOWLIST') : []

  if (auditText && (mapRows === null || decisionRows === null)) {
    fail(`parse error — could not extract FACADE_AUDIT_MAP/API_ROUTE_DECISIONS from ${label}'s audit.ts`)
  }
  if (policyText && (actions === null || auditedCores === null || sdkAllowlist === null || rawAllowlist === null)) {
    fail(`parse error — could not extract AUDIT_ACTIONS/AUDITED_CORES/allowlists from ${label}'s audit-policy.ts`)
  }

  return {
    mapRows: mapRows ?? {},
    decisionRows: decisionRows ?? {},
    actions: actions ?? [],
    auditedCores: auditedCores ?? [],
    sdkAllowlist: sdkAllowlist ?? [],
    rawAllowlist: rawAllowlist ?? [],
  }
}

function isLive(row) {
  return row.kind !== 'skip' && !row.pendingWave
}

function findRowWeakenings(mainV, headV) {
  const weakenings = []
  const allRowSources = [
    ['map', mainV.mapRows, headV.mapRows],
    ['decision', mainV.decisionRows, headV.decisionRows],
  ]
  for (const [kind, mainRows, headRows] of allRowSources) {
    for (const [key, mainRow] of Object.entries(mainRows)) {
      const headRow = headRows[key]
      if (isLive(mainRow)) {
        if (!headRow) {
          weakenings.push({ key, note: `${kind} row '${key}' deleted (was live)` })
          continue
        }
        if (headRow.kind === 'skip' && mainRow.kind !== 'skip') {
          weakenings.push({ key, note: `${kind} row '${key}' live → skip` })
          continue
        }
        if (headRow.pendingWave && !mainRow.pendingWave) {
          weakenings.push({ key, note: `${kind} row '${key}' live → pendingWave` })
          continue
        }
        // Quiet recategorization: still live, category silently changed.
        if (headRow.category && mainRow.category && headRow.category !== mainRow.category) {
          weakenings.push({
            key,
            note: `${kind} row '${key}' recategorized ${mainRow.category} → ${headRow.category} (still live)`,
          })
        }
        // Fix round 1 #10: a live row's action or targetType swapping is
        // silent — same "still emits, but now the WRONG thing" class as a
        // recategorization, and it's exactly what the deleted
        // facade-audit-totality.test.ts hardcoded pin used to catch.
        if (headRow.action !== mainRow.action) {
          weakenings.push({
            key,
            note: `${kind} row '${key}' action changed '${mainRow.action}' → '${headRow.action}' (still live)`,
          })
        }
        if (headRow.targetType !== mainRow.targetType) {
          weakenings.push({
            key,
            note: `${kind} row '${key}' targetType changed '${mainRow.targetType}' → '${headRow.targetType}' (still live)`,
          })
        }
      } else if (headRow && mainRow.pendingWave && headRow.pendingWave && headRow.pendingWave !== mainRow.pendingWave) {
        // Non-live in both, but the pendingWave VALUE moved (date pushed out
        // / wave letter changed) — ledger-tracked, never a hard-fail on a
        // past date by itself.
        weakenings.push({
          key,
          note: `${kind} row '${key}' pendingWave changed '${mainRow.pendingWave}' → '${headRow.pendingWave}'`,
        })
      }
    }
  }
  return weakenings
}

function findActionWeakenings(mainV, headV) {
  const headActions = new Set(headV.actions)
  return mainV.actions
    .filter((a) => !headActions.has(a))
    .map((action) => ({ key: action, note: `AUDIT_ACTIONS member '${action}' removed` }))
}

export function findAuditedCoresWeakenings(mainV, headV) {
  // Fix round 1 #8: rename tolerance REMOVED entirely — symbol-set matching
  // is unsound with generic route symbol lists (['GET'] / ['POST'] appear on
  // multiple registry entries), so both a subset check and an equality check
  // are defeated by an added unrelated route claiming to be "the rename". A
  // genuine file rename now takes one ledger line, same as any other
  // deliberate weakening — simpler and sound, not simplified-but-leaky.
  const weakenings = []
  const headCoresByFile = new Map(headV.auditedCores.map((e) => [e.file, new Set(e.symbols)]))

  for (const entry of mainV.auditedCores) {
    const headSymbols = headCoresByFile.get(entry.file)
    if (!headSymbols) {
      weakenings.push({ key: entry.file, note: `AUDITED_CORES entry '${entry.file}' removed` })
      continue
    }
    for (const symbol of entry.symbols) {
      if (!headSymbols.has(symbol)) {
        weakenings.push({
          key: `${entry.file}#${symbol}`,
          note: `AUDITED_CORES symbol '${entry.file}#${symbol}' removed`,
        })
      }
    }
  }
  return weakenings
}

function findAllowlistWeakenings(mainV, headV, bootstrapping) {
  if (bootstrapping) {
    console.log(
      '[check-audit-weakening] BOOTSTRAP: docs/audit-weakening-ledger.md does not exist on main yet — allowlist ' +
        'additions are exempt for THIS PR only (the taxonomy + ledger are both new). Once merged the ledger exists ' +
        'and is append-only (undeletable), so this window can never reopen.',
    )
    return []
  }
  const weakenings = []
  const allowlistSources = [
    ['SDK_WRITE_ALLOWLIST', mainV.sdkAllowlist, headV.sdkAllowlist],
    ['RAW_SUPABASE_WRITE_ALLOWLIST', mainV.rawAllowlist, headV.rawAllowlist],
  ]
  for (const [listName, mainList, headList] of allowlistSources) {
    const mainById = new Map(mainList.map((e) => [`${e.file}::${e.call}`, e]))
    for (const entry of headList) {
      const id = `${entry.file}::${entry.call}`
      const mainEntry = mainById.get(id)
      if (!mainEntry) {
        weakenings.push({
          key: entry.call,
          note: `${listName} addition: ${entry.file} '${entry.call}' (new legal silent write)`,
        })
        continue
      }
      // Fix round 1 #7: a symbol ADDED to an existing (file, call) entry
      // grants amnesty to a NEW site the entry never covered before — the
      // same "newly-legalized silent write" class as a brand-new entry, just
      // scoped one level deeper.
      const mainSymbols = new Set(mainEntry.symbols ?? [])
      for (const symbol of entry.symbols ?? []) {
        if (!mainSymbols.has(symbol)) {
          weakenings.push({
            key: `${entry.call}#${symbol}`,
            note: `${listName} symbol addition: ${entry.file} '${entry.call}' gained symbol '${symbol}' (new legal silent write)`,
          })
        }
      }
    }
  }
  return weakenings
}

function ledgerDiffLines(mainRef) {
  if (!existsSync(join(ROOT, LEDGER_PATH))) return { added: [], removed: [] }
  const diff = tryGit(['diff', mainRef, '--', LEDGER_PATH])
  if (diff === null) return { added: [], removed: [] }
  const lines = diff.split('\n')
  return {
    added: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)),
    removed: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1)),
  }
}

function main() {
  const headAuditText = readFileSync(join(ROOT, 'src/lib/audit.ts'), 'utf8')
  const headPolicyPath = join(ROOT, 'src/lib/audit-policy.ts')
  const headPolicyText = existsSync(headPolicyPath) ? readFileSync(headPolicyPath, 'utf8') : null

  const headV = parseVersion(headAuditText, headPolicyText, 'HEAD')

  // Sanity floor: guards against a parser regression that reads everything
  // as empty and passes green.
  const headMapCount = Object.keys(headV.mapRows).length
  const headDecisionCount = Object.keys(headV.decisionRows).length
  if (headMapCount < MIN_MAP_ROWS || headDecisionCount < MIN_DECISION_ROWS) {
    fail(
      `sanity floor breached — HEAD parsed ${headMapCount} facade map rows (need >= ${MIN_MAP_ROWS}) and ` +
        `${headDecisionCount} decision rows (need >= ${MIN_DECISION_ROWS}). Treat as a parser bug, not a clean run.`,
    )
  }

  const mainRef = resolveMainRef()
  const headSha = tryGit(['rev-parse', 'HEAD'])?.trim()
  const mainSha = tryGit(['rev-parse', mainRef])?.trim()
  if (headSha && mainSha && headSha === mainSha) {
    console.log('[check-audit-weakening] HEAD === main (push-to-main run) — nothing to diff against itself. EXIT=0')
    process.exit(0)
  }

  const mainAuditText = readAtRef(mainRef, 'src/lib/audit.ts')
  if (mainAuditText === null) {
    fail(`could not read src/lib/audit.ts at ${mainRef} — audit.ts is a pre-existing file, this should never be null`)
  }
  const mainPolicyText = readAtRef(mainRef, 'src/lib/audit-policy.ts') // null tolerated: policy file is new too
  // Bootstrap is keyed on the LEDGER's absence from main, not the policy
  // file's (contract §8 v2 Deliverable 7) — the policy-file check is
  // re-triggerable by a future rename-away/recreate of audit-policy.ts,
  // which would silently reopen the exemption window. The ledger is
  // append-only once it exists, so keying on IT makes the bootstrap window
  // provably one-time.
  const mainLedgerText = readAtRef(mainRef, LEDGER_PATH)
  const bootstrapping = mainLedgerText === null

  const mainV = parseVersion(mainAuditText, mainPolicyText, mainRef)

  const weakenings = [
    ...findRowWeakenings(mainV, headV),
    ...findActionWeakenings(mainV, headV),
    ...findAuditedCoresWeakenings(mainV, headV),
    ...findAllowlistWeakenings(mainV, headV, bootstrapping),
  ]

  const { added: addedLines, removed: removedLines } = ledgerDiffLines(mainRef)

  // Append-only gate: ANY removed line (an edit or deletion of an existing
  // entry) breaks the audit trail outright, regardless of whether there are
  // also unrelated weakenings this run.
  if (removedLines.length > 0) {
    console.error(
      `[check-audit-weakening] ${LEDGER_PATH} is APPEND-ONLY — ${removedLines.length} removed/edited line(s) ` +
        `found vs ${mainRef}:`,
    )
    for (const l of removedLines) console.error(`  - ${l}`)
    console.error('\nEach weakened key needs its OWN new line — never edit or delete an existing ledger line.')
    process.exit(1)
  }

  if (weakenings.length === 0) {
    console.log('[check-audit-weakening] no weakenings vs main. EXIT=0')
    process.exit(0)
  }

  const unledgered = weakenings.filter((w) => !addedLines.some((line) => line.includes(w.key)))

  if (unledgered.length > 0) {
    console.error(`[check-audit-weakening] ${unledgered.length} unledgered weakening(s) vs main:`)
    for (const w of unledgered) console.error(`  - ${w.note}`)
    console.error(
      `\nEach one needs its own ADDED line in ${LEDGER_PATH} containing the key shown above, format:\n` +
        `  - YYYY-MM-DD · <key> · <why> · <who ruled>`,
    )
    process.exit(1)
  }

  console.log(`[check-audit-weakening] ${weakenings.length} weakening(s), all ledgered (1:1, append-only). EXIT=0`)
  process.exit(0)
}

// Only run when invoked as the entry point — the exported pure diff
// functions are imported by test harnesses, and an import must never
// execute the gate (it would exit the importing process).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
