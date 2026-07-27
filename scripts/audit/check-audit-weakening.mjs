#!/usr/bin/env node
// CP8 — audit-weakening gate (contract §8, round-2 amendment D). Compares
// HEAD's audit taxonomy (src/lib/audit.ts + src/lib/audit-policy.ts, read
// from DISK — catches uncommitted local edits on a BRANCH checkout; on main
// itself the HEAD==main early exit below skips the diff, so a dirty tree on
// main is out of scope by design) against origin/main's committed version. A WEAKENING —
//   - a map/decision row: live→skip, live→pendingWave, deleted, or a quiet
//     RECATEGORIZATION (category changed while staying live);
//   - a non-live row's pendingWave VALUE changing (date pushed out, wave
//     letter changed) — not a hard-fail on a past date, just ledger-tracked;
//   - a pendingWave row DELETED, or left as a skip carrying no pendingWave (a
//     dropped commitment — fresh-eyes fix, 2026-07-28; plain skip rows that
//     never carried a commitment may come and go freely — UNLESS the row
//     carries a coveredBy citation, see the coveredBy clause below);
//   - a live row's action or targetType swapped (still emits, wrong thing);
//   - a live row's kind swapped (view↔mutation — changes WHEN the hook
//     emits), or a parked row's action/category/targetType/kind swapped
//     (a pendingWave row pins the FUTURE truth);
//   - a row's coveredBy citation repointed or dropped vs main (blind-round
//     find, 2026-07-28: CP2 only proves the NEW citation names a real
//     emitter — it never notices the citation moved, and a repointed
//     choke-point claim is a truth swap; checked for every row present on
//     both sides), and a CITED skip row DELETED outright (verify-round
//     find: a flat→method-keyed restructure changes the row's key, so a
//     repoint could otherwise ride through as delete+add — only UNCITED
//     plain-skip rows come and go freely);
//   - an AUDIT_ACTIONS member removed;
//   - an AUDITED_CORES entry/symbol removed — including renames (rename
//     tolerance was removed, fix round 1 #8: symbol-set matching is unsound
//     with generic route symbol lists; a genuine rename takes a ledger line);
//   - ANY allowlist ADDITION (a newly-legalized silent write), including a
//     symbol added to an existing entry — exempt ONCE while the LEDGER
//     doesn't exist on main yet (this PR's own bootstrap; keyed on the
//     ledger, not audit-policy.ts, because the ledger is undeletable once
//     merged — append-only — so the window never reopens via any PR path;
//     a DIRECT push to main deleting the ledger could still reopen it, and
//     only branch protection closes that door — same caveat as every gate
//     here) —
// passes ONLY if docs/audit-weakening-ledger.md has an ADDED line (vs main)
// naming the affected key, AND the ledger's diff has NO removed lines
// (append-only — an edited/deleted old entry breaks the audit trail; each
// weakened key gets its own new line, never piggybacked onto an edited one).
// Strengthenings (skip/pendingWave→live, allowlist removal, new actions)
// pass free, no ledger entry needed.
//
// Supersedes the CP8-forerunner hardcoded pin (facade-audit-totality.test.ts's
// 'CP8 forerunner' describe block, deleted by this PR — the file itself
// survives and still hosts the route walker) — that pin caught a live-row reclassification because
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

/** Content of `path` at `ref`; null ONLY when the file genuinely doesn't
 *  exist at that ref (tolerated for the files this PR itself introduces —
 *  audit-policy.ts and the ledger: the bootstrap case). Any OTHER git
 *  failure throws loud (blind-round find, 2026-07-28): absence is what
 *  keys the bootstrap exemption, so conflating a transient git error with
 *  absence could reopen the one-time window on a partial/odd clone.
 *  ls-tree distinguishes the two: bad ref / repo error → throws; valid ref
 *  with the path absent → exit 0, empty output (and no stderr 'fatal:'
 *  noise on the expected-absent bootstrap probes, unlike `git show`). */
function readAtRef(ref, path) {
  const entry = git(['ls-tree', ref, '--', path])
  if (entry.trim() === '') return null
  return git(['show', `${ref}:${path}`])
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

export function findRowWeakenings(mainV, headV) {
  const weakenings = []
  const allRowSources = [
    ['map', mainV.mapRows, headV.mapRows],
    ['decision', mainV.decisionRows, headV.decisionRows],
  ]
  for (const [kind, mainRows, headRows] of allRowSources) {
    for (const [rawKey, mainRow] of Object.entries(mainRows)) {
      const headRow = headRows[rawKey]
      // Ledger keys are NAMESPACED by source (blind-round find, 2026-07-28):
      // the flat namespace collided — 'export' is both a map AND a decision
      // key today, and an action name can equal an allowlist call string —
      // so one human-reviewed ledger line could silently amnesty a second,
      // unrelated weakening. Notes below quote the namespaced key verbatim;
      // authors copy it from the gate's own output, never construct it.
      const key = `${kind}:${rawKey}`
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
        // `mainRow.<field> !== undefined` guard (fix round 2): a field ADDED
        // where main had none is enrichment — only a swap or a drop of a
        // prior value is a weakening. This covers parked rows gaining their
        // structured action (5 on the proof-suite PR itself) AND the 3 LIVE
        // decision rows (sync/quickreserve, sync/quickreserve/config.POST,
        // export), where a decision row's `action` is CP4 doc metadata, not
        // an emitter input — an addition there is runtime-inert and shows up
        // in the regenerated AUDIT_ACTIONS.md diff regardless.
        if (mainRow.action !== undefined && headRow.action !== mainRow.action) {
          weakenings.push({
            key,
            note: `${kind} row '${key}' action changed '${mainRow.action}' → '${headRow.action}' (still live)`,
          })
        }
        if (mainRow.targetType !== undefined && headRow.targetType !== mainRow.targetType) {
          weakenings.push({
            key,
            note: `${kind} row '${key}' targetType changed '${mainRow.targetType}' → '${headRow.targetType}' (still live)`,
          })
        }
        // Fix round 2 (verifier find): view↔mutation (or log↔mutation on a
        // decision row) changes WHEN the hook emits — same silent class as
        // the action/targetType swaps above. 'skip' already returned above.
        if (headRow.kind !== mainRow.kind) {
          weakenings.push({
            key,
            note: `${kind} row '${key}' kind changed '${mainRow.kind}' → '${headRow.kind}' (still live)`,
          })
        }
        if (mainRow.coveredBy !== undefined && headRow.coveredBy !== mainRow.coveredBy) {
          weakenings.push({
            key,
            note: `${kind} row '${key}' coveredBy changed '${mainRow.coveredBy}' → '${headRow.coveredBy}' (still live)`,
          })
        }
      } else if (mainRow.pendingWave) {
        // Non-live main row still carrying a COMMITMENT (fresh-eyes fix,
        // 2026-07-28): the contract's "deleted" clause is unqualified —
        // dropping a promised row (deleted outright, or demoted to skip) is
        // the same dropped-commitment class as a pendingWave value change.
        // Only a plain skip row may come and go freely (map-row deletion is
        // tsc-enforced via FacadeEndpointKey totality; decision skip rows
        // are guarded by facade-audit-totality's route walker). The
        // CP4-orphan → action-member-removal interlock catches SOME of these
        // transitively, but only when no other source emits the action.
        if (!headRow) {
          weakenings.push({ key, note: `${kind} row '${key}' deleted (was pendingWave '${mainRow.pendingWave}')` })
        } else if (headRow.kind === 'skip' && !headRow.pendingWave) {
          // Keyed on the HEAD row having no commitment left, not on main's
          // kind changing (Fable direct audit, 2026-07-28): the old
          // `mainRow.kind !== 'skip'` form could never fire for a row parked
          // AS skip (`{ kind: 'skip', pendingWave: '...' }` — both fields are
          // legal on both row types), so dropping that row's pendingWave
          // while it stayed skip silently retired the promise. A head row
          // that is skip AND carries no pendingWave has dropped the
          // commitment however it got there; a still-parked skip row falls
          // through to the content checks below.
          weakenings.push({
            key,
            note: `${kind} row '${key}' pendingWave '${mainRow.pendingWave}' → skip (promised writer dropped)`,
          })
        } else {
          // Content swap while parked (fix round 2, verifier find): a
          // pendingWave row pins the FUTURE truth — its action/category/
          // targetType/kind changing while non-live (or in the same PR that
          // promotes it) would launder a wrong row into a free promotion,
          // since the live-branch checks above only fire when the MAIN row
          // is live. A clean promotion (content identical, pendingWave
          // removed) stays a free strengthening, and a field ADDED where
          // main had none is enrichment (same guard as the live branch —
          // the proof-suite PR itself adds structured actions to parked
          // decision rows).
          if (mainRow.action !== undefined && headRow.action !== mainRow.action) {
            weakenings.push({
              key,
              note: `${kind} row '${key}' action changed '${mainRow.action}' → '${headRow.action}' (pendingWave row)`,
            })
          }
          if (headRow.category && mainRow.category && headRow.category !== mainRow.category) {
            weakenings.push({
              key,
              note: `${kind} row '${key}' recategorized ${mainRow.category} → ${headRow.category} (pendingWave row)`,
            })
          }
          if (mainRow.targetType !== undefined && headRow.targetType !== mainRow.targetType) {
            weakenings.push({
              key,
              note: `${kind} row '${key}' targetType changed '${mainRow.targetType}' → '${headRow.targetType}' (pendingWave row)`,
            })
          }
          if (headRow.kind !== mainRow.kind) {
            weakenings.push({
              key,
              note: `${kind} row '${key}' kind changed '${mainRow.kind}' → '${headRow.kind}' (pendingWave row)`,
            })
          }
          if (headRow.pendingWave && headRow.pendingWave !== mainRow.pendingWave) {
            // pendingWave VALUE moved (date pushed out / wave letter
            // changed) — ledger-tracked, never a hard-fail on a past date
            // by itself.
            weakenings.push({
              key,
              note: `${kind} row '${key}' pendingWave changed '${mainRow.pendingWave}' → '${headRow.pendingWave}'`,
            })
          }
          if (mainRow.coveredBy !== undefined && headRow.coveredBy !== mainRow.coveredBy) {
            weakenings.push({
              key,
              note: `${kind} row '${key}' coveredBy changed '${mainRow.coveredBy}' → '${headRow.coveredBy}' (pendingWave row)`,
            })
          }
        }
      } else if (headRow && mainRow.coveredBy !== undefined && headRow.coveredBy !== mainRow.coveredBy) {
        // Plain-skip main row (no commitment): its EXISTENCE is free to
        // change — tsc totality and the route walker own that — but a
        // coveredBy repoint/drop on a row present on BOTH sides is a truth
        // swap (blind-round find, 2026-07-28): CP2 proves the new citation
        // names a real emitter, never that it is the SAME choke point main
        // reviewed. Gaining a first coveredBy stays free (enrichment).
        weakenings.push({
          key,
          note: `${kind} row '${key}' coveredBy changed '${mainRow.coveredBy}' → '${headRow.coveredBy}' (skip row)`,
        })
      } else if (!headRow && mainRow.coveredBy !== undefined) {
        // A skip row CARRYING a citation may not vanish silently (verify
        // round, 2026-07-28): a flat→method-keyed restructure of a decision
        // row changes its KEY, so a repoint could otherwise ride through as
        // delete+add — and deleting a covered surface outright is worth one
        // ledger line anyway. Uncited plain-skip rows still come and go free.
        weakenings.push({
          key,
          note: `${kind} row '${key}' deleted (skip row carrying coveredBy '${mainRow.coveredBy}')`,
        })
      }
    }
  }
  return weakenings
}

export function findActionWeakenings(mainV, headV) {
  const headActions = new Set(headV.actions)
  return mainV.actions
    .filter((a) => !headActions.has(a))
    .map((action) => ({ key: `action:${action}`, note: `AUDIT_ACTIONS member removed — ledger key 'action:${action}'` }))
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
      weakenings.push({ key: `cores:${entry.file}`, note: `AUDITED_CORES entry removed — ledger key 'cores:${entry.file}'` })
      continue
    }
    for (const symbol of entry.symbols) {
      if (!headSymbols.has(symbol)) {
        weakenings.push({
          key: `cores:${entry.file}#${symbol}`,
          note: `AUDITED_CORES symbol removed — ledger key 'cores:${entry.file}#${symbol}'`,
        })
      }
    }
  }
  return weakenings
}

export function findAllowlistWeakenings(mainV, headV, bootstrapping) {
  if (bootstrapping) {
    console.log(
      '[check-audit-weakening] BOOTSTRAP: docs/audit-weakening-ledger.md does not exist on main yet — allowlist ' +
        'additions are exempt for THIS PR only (the taxonomy + ledger are both new). Once merged the ledger exists ' +
        'and is append-only (undeletable), so no PR path can reopen this window (direct main pushes are ' +
        'branch-protection territory).',
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
        // Key carries the LIST and the FILE too (blind-round find,
        // 2026-07-28): a bare call string collided with action names, and
        // omitting the file let one line cover the same call added to any
        // number of files.
        weakenings.push({
          key: `${listName}:${id}`,
          note: `${listName} addition (new legal silent write) — ledger key '${listName}:${id}'`,
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
            key: `${listName}:${id}#${symbol}`,
            note: `${listName} symbol addition (new legal silent write) — ledger key '${listName}:${id}#${symbol}'`,
          })
        }
      }
    }
  }
  return weakenings
}

// ── Second-reviewer enforcement (contract §8; Greptile #635 P1) ──────────
// A ledger line proves a weakening was DECLARED, not that anyone else
// approved it — the ledger would otherwise self-authorize while branch
// protection is off. Whenever ledgered weakenings exist in a PR CI run,
// the gate itself requires an APPROVED review from the code owner on the
// PR's EXACT head commit. Local runs and push-to-main runs skip it (same
// documented local-caveat class as the FETCH_HEAD fallback — CI on the PR
// is the enforcement point). Fail-closed: an API failure fails the gate.
// Branch protection, once Anthony flips it, makes this redundant belt.
const CODE_OWNER_LOGIN = 'alee046' // keep in sync with .github/CODEOWNERS

/** Pure verdict (selftest-covered without the network): the owner's LATEST
 *  non-comment review must be APPROVED and pinned to the exact head SHA —
 *  an approval of an older commit must never authorize commits pushed
 *  after it. */
export function ownerApprovalVerdict(reviews, headSha, ownerLogin = CODE_OWNER_LOGIN) {
  const ownerReviews = (reviews ?? []).filter(
    (r) => r?.user?.login === ownerLogin && r?.state !== 'COMMENTED',
  )
  const last = ownerReviews[ownerReviews.length - 1]
  if (!last) return { ok: false, why: `no review from @${ownerLogin}` }
  if (last.state !== 'APPROVED') return { ok: false, why: `latest review from @${ownerLogin} is ${last.state}` }
  if (last.commit_id !== headSha) {
    return {
      ok: false,
      why:
        `@${ownerLogin}'s approval is for ${String(last.commit_id).slice(0, 7)}, not the current head ` +
        `${String(headSha).slice(0, 7)} — the exact head commit must be re-approved`,
    }
  }
  return { ok: true, why: 'approved at head' }
}

/** Fetch EVERY page of reviews (Greptile #635 r2: a single per_page=100 call
 *  could hide the owner's LATER withdrawal on page 2 behind a stale page-1
 *  approval — "latest" is only meaningful over the full list). fetchImpl is
 *  injectable so the selftest covers pagination without the network.
 *  Fail-closed throughout: an error status or an absurd page count throws. */
export async function fetchAllReviews(fetchImpl, baseUrl, headers) {
  const all = []
  for (let page = 1; ; page += 1) {
    if (page > 30) throw new Error('more than 3000 reviews — refusing to trust a truncated list')
    const res = await fetchImpl(`${baseUrl}?per_page=100&page=${page}`, { headers })
    if (!res.ok) throw new Error(`could not list PR reviews (HTTP ${res.status})`)
    const batch = await res.json()
    all.push(...batch)
    if (batch.length < 100) return all
  }
}

async function enforceOwnerApproval(weakeningCount) {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!process.env.GITHUB_ACTIONS || !eventPath) {
    console.log(
      '[check-audit-weakening] owner-approval check skipped (not a CI run) — the PR CI run is the enforcement point.',
    )
    return
  }
  const event = JSON.parse(readFileSync(eventPath, 'utf8'))
  const pr = event.pull_request
  if (!pr) {
    console.log('[check-audit-weakening] owner-approval check skipped (not a pull_request event).')
    return
  }
  const token = process.env.GITHUB_TOKEN
  if (!token) fail('GITHUB_TOKEN missing — cannot verify code-owner approval for ledgered weakenings.')
  const api = process.env.GITHUB_API_URL ?? 'https://api.github.com'
  let reviews
  try {
    reviews = await fetchAllReviews(fetch, `${api}/repos/${event.repository.full_name}/pulls/${pr.number}/reviews`, {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
    })
  } catch (err) {
    fail(`${err?.message ?? err} — failing closed; ledgered weakenings need verified owner approval.`)
  }
  const verdict = ownerApprovalVerdict(reviews, pr.head.sha)
  if (!verdict.ok) {
    fail(
      `${weakeningCount} ledgered weakening(s) need a SECOND REVIEWER (contract §8): ${verdict.why}. ` +
        `@${CODE_OWNER_LOGIN} must APPROVE the exact head commit, then re-run this job.`,
    )
  }
  console.log(`[check-audit-weakening] owner approval verified (@${CODE_OWNER_LOGIN}, ${verdict.why}).`)
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

async function main() {
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
        `${headDecisionCount} decision rows (need >= ${MIN_DECISION_ROWS}). Treat as a parser bug FIRST; if a ` +
        `legitimate route purge really shrank the tables, lower the floor constant in a code-owner-reviewed edit.`,
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

  // Fresh-eyes fix (2026-07-28): a deleted working-tree ledger used to
  // short-circuit ledgerDiffLines to empty — a PR deleting the ledger while
  // making no other weakening exited 0, and once merged, main would lack the
  // ledger and the one-time bootstrap window would REOPEN (defeating the
  // "keyed on the ledger because it's undeletable" reasoning above).
  // Deletion/rename of an existing ledger is a hard fail outright.
  if (!bootstrapping && !existsSync(join(ROOT, LEDGER_PATH))) {
    fail(
      `${LEDGER_PATH} exists at ${mainRef} but is missing from the working tree — the ledger is append-only and must never be deleted or renamed.`,
    )
  }

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

  // Fix round 2 (verifier find): substring matching let one added line
  // ledger unlimited keys, and a key that is a substring of another
  // ('karute.entry_edit' ⊂ 'karute.entry_edits_view') was ledgered by the
  // OTHER key's legitimate line. An added line ledgers EXACTLY the key in
  // its own key field — `- YYYY-MM-DD · <key> · <why> · <who ruled>` — which
  // also machine-enforces the entry format and the 1:1 rule the header
  // mandates (one entry line carries one key field). Keys are namespaced by
  // source (map:/decision:/action:/cores:/<ALLOWLIST_NAME>:) — copy them
  // exactly as the gate prints them.
  const LEDGER_ENTRY_RE = /^- \d{4}-\d{2}-\d{2} · (.+?) · /
  const ledgeredKeys = new Set(
    addedLines.map((line) => LEDGER_ENTRY_RE.exec(line)?.[1]).filter((k) => k !== undefined),
  )
  const unledgered = weakenings.filter((w) => !ledgeredKeys.has(w.key))

  if (unledgered.length > 0) {
    console.error(`[check-audit-weakening] ${unledgered.length} unledgered weakening(s) vs main:`)
    for (const w of unledgered) console.error(`  - ${w.note}`)
    console.error(
      `\nEach one needs its own ADDED entry line in ${LEDGER_PATH} whose key field is EXACTLY the key shown above:\n` +
        `  - YYYY-MM-DD · <key> · <why> · <who ruled>`,
    )
    process.exit(1)
  }

  await enforceOwnerApproval(weakenings.length)

  console.log(`[check-audit-weakening] ${weakenings.length} weakening(s), all ledgered (1:1, append-only). EXIT=0`)
  process.exit(0)
}

// Only run when invoked as the entry point — the exported pure diff
// functions are imported by test harnesses, and an import must never
// execute the gate (it would exit the importing process).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[check-audit-weakening] unexpected failure: ${err?.stack ?? err}`)
    process.exit(2)
  })
}
