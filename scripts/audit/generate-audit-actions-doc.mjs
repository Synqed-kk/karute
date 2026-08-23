#!/usr/bin/env node
// Regenerates docs/AUDIT_ACTIONS.md from src/lib/audit-policy.ts's
// AUDIT_ACTIONS + src/lib/audit.ts's FACADE_AUDIT_MAP/API_ROUTE_DECISIONS
// (contract §8 CP4). CI runs this then checks `git status --porcelain
// --ignored -- docs/AUDIT_ACTIONS.md` is empty (a plain diff misses a
// deleted-then-regenerated or gitignored doc) — a taxonomy edit that
// forgets to regenerate the doc fails the gate instead of drifting silently.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseFacadeAuditMap, parseApiRouteDecisions, parseAuditActions } from './parse-audit-source.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Category for the literal-only actions (never a FACADE_AUDIT_MAP/
// API_ROUTE_DECISIONS row — found only via a direct audit()/auditWeb() call
// in src). Hand-verified against source (contract §8 CP4 — see the
// proof-suite build report for the file:line of each emit site).
const LITERAL_ONLY_CATEGORY = {
  'audit.unmapped_endpoint': 'privacy',
  'auth.pin_lockout': 'auth',
  'booking.cancel': 'booking',
  'booking.create': 'booking',
  'booking.delete': 'booking',
  'booking.no_show': 'booking',
  'booking.restore': 'booking',
  'booking.update': 'booking',
  'karute.save': 'karute',
  'karute.entry_edit': 'karute',
  // Choke emit: src/actions/karute.ts#updateKaruteDetailSummaryWithClient
  // (facade key karute.summary.update is a skip row — same doctrine as
  // karute.entry_edit above).
  'karute.summary_edit': 'karute',
  'customer.create': 'customer',
  'privacy.customer_delete_canceled': 'privacy',
  'privacy.customer_delete_scheduled': 'privacy',
  'settings.permissions_change': 'settings',
  'staff.pin_set': 'staff',
  'staff.pin_removed': 'staff',
  'privacy.voice_enroll': 'privacy',
  'privacy.voice_revoke': 'privacy',
  'settings.store_create': 'settings',
  'settings.store_update': 'settings',
  'settings.staff_stores_change': 'settings',
  'staff.add': 'staff',
  'staff.update': 'staff',
  'staff.remove': 'staff',
  'staff.avatar_update': 'staff',
  'staff.invite_create': 'staff',
  'staff.invite_revoke': 'staff',
  'staff.link_failed': 'staff',
  'staff.invite_mark_failed': 'staff',
  'privacy.audit_log.view': 'privacy',
  'privacy.customer_export': 'privacy',
  'settings.sync_config_update': 'settings',
  'settings.menu_create': 'settings',
  'settings.menu_update': 'settings',
  'settings.menu_retire': 'settings',
  'settings.menu_reactivate': 'settings',
  // Choke emit: src/lib/recording/discard.ts#discardRecordingWithClient
  // (facade key recordings.discard is a skip row — same doctrine as
  // karute.save/karute.entry_edit above). Recording-integrity PR A1.
  'recording.discard': 'recording',
  // Choke emit: src/lib/recording/session-cleanup.ts#deleteRecordingSessionWithClient
  // (facade key recordings.session.delete is a skip row — same doctrine).
  // INTERIM: goes away with P5's kept-discard build, and this line with it.
  'recording.session_cleanup': 'recording',
  // Choke emit: src/lib/settings/recording-autostart.ts#setRecordingAutostartWithClient
  // (facade key orgSettings.recordingAutostart is a skip row — same doctrine).
  // The ONE audited settings-blob key, spec §8.1 fix C1. Recording-integrity PR A4.
  'settings.recording_autostart_toggle': 'settings',
  // AI再エンゲージメント (§13, F9): success-only audit doctrine — the
  // FACADE_AUDIT_MAP row for this surface (customer.ai.reengagement) is a
  // `view` row carrying a DIFFERENT action (customer.reengagement_view);
  // this 生成 action is emitted only by the two private auditLockout-pattern
  // helpers in src/lib/karute/ai-reengagement.ts, never through a mapped
  // endpoint — literal-only, same as ai.suggested_message's shape used to
  // be before ai.suggestions picked it up.
  'ai.reengagement_draft': 'ai',
}

function fail(msg) {
  console.error(`[generate-audit-actions-doc] ${msg}`)
  process.exit(2)
}

function main() {
  const auditSrc = readFileSync(join(ROOT, 'src/lib/audit.ts'), 'utf8')
  const policySrc = readFileSync(join(ROOT, 'src/lib/audit-policy.ts'), 'utf8')

  const mapRows = parseFacadeAuditMap(auditSrc)
  const decisionRows = parseApiRouteDecisions(auditSrc)
  const actions = parseAuditActions(policySrc)
  if (!mapRows || !decisionRows || !actions) {
    fail('parse error — could not extract FACADE_AUDIT_MAP / API_ROUTE_DECISIONS / AUDIT_ACTIONS from source')
  }

  /** @type {Map<string, { category?: string, live: boolean }>} */
  const byAction = new Map()

  for (const row of Object.values(mapRows)) {
    if (!row.action) continue
    const cur = byAction.get(row.action) ?? { live: false }
    if (row.category) cur.category = row.category
    if (!row.pendingWave) cur.live = true
    byAction.set(row.action, cur)
  }
  for (const row of Object.values(decisionRows)) {
    if (!row.action) continue
    const cur = byAction.get(row.action) ?? { live: false }
    if (!row.pendingWave) cur.live = true
    byAction.set(row.action, cur)
  }
  // Any AUDIT_ACTIONS member not seen in map/decision rows is literal-only —
  // by construction (it was hand-curated FROM a real audit()/auditWeb() call
  // site), always live.
  for (const action of actions) {
    if (!byAction.has(action)) {
      byAction.set(action, { category: LITERAL_ONLY_CATEGORY[action], live: true })
    }
  }

  const lines = [
    '<!-- GENERATED by scripts/audit/generate-audit-actions-doc.mjs — do not hand-edit. -->',
    '<!-- Source of truth: src/lib/audit-policy.ts AUDIT_ACTIONS + src/lib/audit.ts. -->',
    '',
    '# Audit action taxonomy',
    '',
    'App-emitted actions only — core-written rows may carry actions outside this ' +
      'list (viewer renders them regardless; see audit-log-dto.ts).',
    '',
    '| action | category | status | label key |',
    '| --- | --- | --- | --- |',
  ]
  for (const action of actions) {
    const info = byAction.get(action) ?? { live: false }
    const status = info.live ? 'live' : 'pending'
    const category = info.category ?? '?'
    lines.push(`| \`${action}\` | ${category} | ${status} | \`settings.auditLog.actions.${action}\` |`)
  }
  lines.push('')

  writeFileSync(join(ROOT, 'docs/AUDIT_ACTIONS.md'), lines.join('\n'))
  console.log(`[generate-audit-actions-doc] wrote docs/AUDIT_ACTIONS.md (${actions.length} actions)`)
}

main()
