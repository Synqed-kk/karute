// PR D1 amendment 1 F6 — CP1-style source pin: the recording thread's inner
// reads (walkAuditCategoryFrom / joinRecordingThread) must call
// synqed.audit.list / synqed.recordings.get DIRECTLY — never a nested
// listAuditLogWithClient, which would each mint their OWN
// privacy.audit_log.view row (contract §3.1). The whole read gets exactly
// ONE receipt, typed by targetType, from the existing audit() call at the
// top of listAuditLogWithClient — never one per inner list call.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('audit-log.ts — recording thread join source pin', () => {
  it('the thread helpers never call listAuditLogWithClient', () => {
    const src = readFileSync(join(process.cwd(), 'src/actions/audit-log.ts'), 'utf8')
    const start = src.indexOf('async function walkAuditCategoryFrom')
    const end = src.indexOf('type ListAuditLogResult =')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const threadSection = src.slice(start, end)

    expect(threadSection).not.toMatch(/listAuditLogWithClient\s*\(/)
    // Sanity: the section actually contains the direct-SDK calls it's
    // supposed to — a passing "never matches" assertion on an empty/wrong
    // slice would prove nothing.
    expect(threadSection).toMatch(/synqed\.audit\.list\(/)
    expect(threadSection).toMatch(/synqed\.recordings\.get\(/)
  })
})
