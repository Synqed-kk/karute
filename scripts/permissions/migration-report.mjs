#!/usr/bin/env node
// Packet 2 §3 — migration-report runner. Thin operator tool: reads the live
// roster (Supabase profiles + synqed-core staff/staff_stores), feeds Packet
// 2's PURE mapping functions, writes a human-reviewable JSON + Markdown
// report OUTSIDE the repo. NEVER imported by anything, NEVER run in CI.
//
// Usage:
//   node scripts/permissions/migration-report.mjs --business-id=<id> --out=/absolute/path/report.json
//
// Required env (read from process.env, never printed):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (profiles read)
//   SYNQED_CORE_URL, SYNQED_CORE_API_KEY                  (staff/staff_stores read)
//
// PII posture (contract §3): the report names staff, which is what makes it
// reviewable — so it must never land inside the repo. --out is REQUIRED and
// any path that resolves (post-realpath, symlink-safe) inside this repo's
// worktree is refused.
//
// ── HOW THIS SCRIPT REACHES THE REAL PURE LOGIC (read before touching) ─────
// This file must stay plain .mjs (a 6th "core" .ts file isn't allowed per
// contract §3/§7), but it must ALSO run the SAME pure functions the test
// suite exercises — mapLegacyRights / compareDecisions /
// assembleMigrationReport / effectiveCapabilities / synqedRoleToPreset —
// rather than a second, drift-prone reimplementation. Plain Node can't
// import a .ts file with no build step, and this repo's TS uses the `@/`
// tsconfig path alias, which plain Node's resolver doesn't know either.
//
// Fix: Node >=22.6 strips TypeScript types NATIVELY (no CLI flag needed on
// this project's actual runtime — brew node@24, verified locally).
// `registerSourceLoader()` below installs a ~15-line ESM loader hook
// (node:module `register()`, stable since Node 20.6) that does exactly two
// things, both pure stdlib, no new dependency:
//   1. rewrites a `@/...` specifier to the matching file:// URL under src/
//   2. if a bare/relative specifier doesn't resolve, retries with `.ts`
//      appended (mirrors how this codebase's own relative TS imports omit
//      the extension, e.g. `from './permissions-v2'`)
// Everything downstream of the loader is the REAL src/lib/workspaces/*.ts +
// src/lib/auth/permissions.ts source, imported as-is — zero duplicated
// business logic, zero drift risk between this runner and the tested code.
//
// This was chosen over the contract's documented fallback (duplicating the
// mapping/report logic in plain JS) because it is small, deterministic, and
// dependency-free. If a future Node regresses default type-stripping, the
// escape hatch is vendoring `tsx` as a real devDependency and switching the
// invocation to `npx tsx scripts/permissions/migration-report.mjs` — this
// codebase already does that for other operator scripts (see
// scripts/sweep-ghost-accounts.ts's usage comment).
import { register } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function fail(msg) {
  console.error(`[migration-report] ${msg}`)
  process.exit(1)
}

// Type-stripping is DEFAULT-ON only from Node 23.6 (22.6–23.5 hide it behind
// --experimental-strip-types) — gate on the default so the .ts imports below
// can never fail half-way through a run on an in-between Node.
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 23 || (nodeMajor === 23 && nodeMinor < 6)) {
  fail(`Node ${process.versions.node} lacks default TypeScript stripping (need >=23.6). Use brew node@24.`)
}

/** Registers the `@/` + extensionless-`.ts` resolver described above. Must
 *  run before any dynamic import() of a src/**\/*.ts module. */
function registerSourceLoader() {
  const srcUrl = pathToFileURL(join(ROOT, 'src') + '/').href
  const loaderSrc = `
    export async function resolve(specifier, context, nextResolve) {
      let spec = specifier
      if (spec.startsWith('@/')) {
        spec = new URL(spec.slice(2), ${JSON.stringify(srcUrl)}).href
      }
      try {
        return await nextResolve(spec, context)
      } catch (err) {
        if (err && err.code === 'ERR_MODULE_NOT_FOUND' && !/\\.[a-zA-Z0-9]+$/.test(spec)) {
          return await nextResolve(spec + '.ts', context)
        }
        throw err
      }
    }
  `
  register(`data:text/javascript,${encodeURIComponent(loaderSrc)}`, import.meta.url)
}
registerSourceLoader()

// ── CLI args ────────────────────────────────────────────────────────────
function argValue(flag) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`))
  return arg ? arg.slice(flag.length + 3) : null
}

const outArg = argValue('out')
const businessId = argValue('business-id')
if (!outArg) fail('--out=<path> is required (PII-bearing report; must be OUTSIDE the repo — see file header).')
if (!businessId) fail('--business-id=<id> is required.')

// ── Required env (never printed) ────────────────────────────────────────
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SYNQED_CORE_URL', 'SYNQED_CORE_API_KEY']) {
  if (!process.env[key]) fail(`Missing required env var: ${key}`)
}

// ── --out must be outside the repo worktree (PII posture, contract §3) ────
// Two-stage check so a refused invocation leaves ZERO side effects in the
// worktree: (1) refuse on the string-resolved path BEFORE creating anything
// (mkdir must never plant directories inside the repo), then (2) after mkdir,
// realpath the now-existing target directory and re-check — the symlink-safe
// belt, run against the actual final directory the report would land in.
const outAbs = resolvePath(process.cwd(), outArg)
const repoRootPre = realpathSync(ROOT)
if (outAbs === repoRootPre || outAbs.startsWith(repoRootPre + '/')) {
  fail(`--out must be OUTSIDE the repository worktree (${repoRootPre}). Refusing to write a PII-bearing report under: ${outAbs}`)
}
mkdirSync(dirname(outAbs), { recursive: true })
const outDirReal = realpathSync(dirname(outAbs))
const repoRootReal = realpathSync(ROOT)
if (outDirReal === repoRootReal || outDirReal.startsWith(repoRootReal + '/')) {
  fail(`--out must be OUTSIDE the repository worktree (${repoRootReal}). Refusing to write a PII-bearing report under: ${outDirReal}`)
}
const outReal = join(outDirReal, basename(outAbs))

// ── The real pure logic + the real chokepoint role-resolution glue ────────
// Same import specifiers the test file uses — same modules, same behavior.
const { effectiveCapabilities, synqedRoleToPreset } = await import(
  pathToFileURL(join(ROOT, 'src/lib/auth/permissions.ts')).href
)
const { assembleMigrationReport } = await import(
  pathToFileURL(join(ROOT, 'src/lib/workspaces/shadow-compare.ts')).href
)

// ── Read the live roster ───────────────────────────────────────────────
const { createClient } = await import('@supabase/supabase-js')
const { SynqedClient } = await import('@synqed-kk/client')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const synqed = new SynqedClient({
  baseUrl: process.env.SYNQED_CORE_URL,
  apiKey: process.env.SYNQED_CORE_API_KEY,
  businessId,
})

const { data: profiles, error: profilesError } = await supabase
  .from('profiles')
  .select('id, email, full_name, display_role, permission_role, permissions')
  .eq('customer_id', businessId)
if (profilesError) fail(`Reading profiles failed: ${profilesError.message}`)

// staff.list / staffStores.get in the exact style of
// src/lib/auth/store-scope.ts:102-123 (one fetch, bounded by the ≤200
// roster — no bulk staff-store read exists yet, see the Anthony ask).
const { staff } = await synqed.staff.list({ page_size: 200 })
const assignments = await Promise.all(
  staff.map(async (s) => ({
    id: s.id,
    user_id: s.user_id ?? null,
    email: s.email ? s.email.toLowerCase() : null,
    store_ids: (await synqed.staffStores.get(s.id)).store_ids,
  })),
)
const bySynqedId = new Map(assignments.map((a) => [a.id, a]))
const byUserId = new Map(assignments.filter((a) => a.user_id).map((a) => [a.user_id, a]))
const byEmail = new Map(assignments.filter((a) => a.email).map((a) => [a.email, a]))

// Same two-tier match as src/lib/auth/store-scope.ts's filterStaffIdsToStore:
// synqed id, then profile user_id, then email. Unlinkable = empty assignment
// (floating), same fail-open convention as everywhere else in this codebase.
function assignmentFor(profile) {
  return (
    bySynqedId.get(profile.id) ??
    byUserId.get(profile.id) ??
    (profile.email ? byEmail.get(profile.email.toLowerCase()) : undefined)
  )
}

const rows = (profiles ?? []).map((profile) => {
  // Mirrors src/lib/auth/require-permission.ts's capabilitiesForUser exactly
  // (the app's real role-resolution glue, require-permission.ts:42-75):
  // permission_role wins when set; else derive the preset from display_role.
  const rawRole = profile.permission_role ?? profile.display_role ?? ''
  const resolvedRole = profile.permission_role
    ? profile.permission_role
    : synqedRoleToPreset(profile.display_role)
  const override = profile.permissions ?? null
  const effective = effectiveCapabilities(resolvedRole, override)
  const assignment = assignmentFor(profile)

  const input = {
    subjectId: profile.id,
    role: rawRole,
    storedOverride: override,
    effectiveLegacy: [...effective],
    assignedStoreIds: assignment?.store_ids ?? [],
    hasStoresViewAll: effective.has('stores.viewAll'),
  }
  const identity = {
    subjectId: profile.id,
    displayName: profile.full_name ?? profile.email ?? profile.id,
    email: profile.email ?? '',
  }
  return { input, identity }
})

const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const report = assembleMigrationReport(sourceSha, rows)

// ── Write JSON + a small Markdown table ────────────────────────────────
writeFileSync(outReal, JSON.stringify(report, null, 2) + '\n', 'utf8')

const mdPath = /\.json$/i.test(outReal) ? outReal.replace(/\.json$/i, '.md') : `${outReal}.md`
const mdLines = [
  '# Permission v2 migration report',
  '',
  `- sourceSha: \`${report.sourceSha}\``,
  `- generatedAtIso: ${report.generatedAtIso}`,
  `- presetHash: \`${report.presetHash}\``,
  `- shadow: ${report.shadow.total - report.shadow.drift}/${report.shadow.total} match (${report.shadow.drift} drift)`,
  `- emptyAssignmentAudit: ${report.emptyAssignmentAudit.length} floating staff (today's fail-open convention — Liam+Anthony ruling owed)`,
  '',
  '| subjectId | displayName | role | provenance | storeAccessMode | assignedStoreIds | capabilitiesV2 | ambiguities |',
  '|---|---|---|---|---|---|---|---|',
  ...report.rows.map(
    (r) =>
      `| ${r.identity.subjectId} | ${r.identity.displayName} | ${r.role} | ${r.provenance} | ${r.proposed.storeAccessMode} | ${r.proposed.assignedStoreIds.join(', ')} | ${r.proposed.capabilitiesV2.join(', ')} | ${r.ambiguities.map((a) => a.kind).join(', ')} |`,
  ),
]
writeFileSync(mdPath, mdLines.join('\n') + '\n', 'utf8')

console.log(`[migration-report] wrote ${outReal}`)
console.log(`[migration-report] wrote ${mdPath}`)
console.log(
  `[migration-report] rows=${report.rows.length} emptyAssignmentAudit=${report.emptyAssignmentAudit.length} shadowDrift=${report.shadow.drift}/${report.shadow.total}`,
)
