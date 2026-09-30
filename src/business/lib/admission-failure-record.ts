// ⚖ 9/30 black box lane — the ONE admission-failure writer. It records a READ
// FAILURE (an auth error, a read that failed, a throw), never a verdict: the
// caller's answer (the bare 404, or the admission another leg grants) is its
// own. ⚖ S6: two parallel read failures = two records; an admitted person whose
// management read failed still gets one. Never user text. `ref` is a short
// random id so one incident can be found in the logs; it is never shown to anyone.
// NO imports: every swallow point in territory (admission.ts, grants.ts) can call
// it without widening its graph.
//
// recordBusinessAdmissionFailure() NEVER throws: a value String() cannot print (a
// null-prototype object, a throwing toString) records '<unprintable>', and
// anything else that fails is dropped — the answer stays the 404, never a 500.

function printable(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.message
  try {
    return String(v)
  } catch {
    return '<unprintable>'
  }
}

export function recordBusinessAdmissionFailure(
  reason: 'auth-error' | 'threw' | 'read-error',
  facts: { where?: string; status?: unknown; message?: unknown },
): void {
  try {
    const ref = Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
    const { where, status, message } = facts
    console.error('[business-admission]', { reason, ref, where, status, message: printable(message) })
  } catch {
    // a record must never change the answer
  }
}
