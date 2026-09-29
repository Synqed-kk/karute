/** Storage's "this key is already taken". The signed-upload endpoint has
 *  answered HTTP 400 with the real code demoted into the body
 *  (`{"statusCode":"409","error":"Duplicate"}`) — read as a plain 400 it looks
 *  retryable, which is how storage-put.ts#putSaysAlreadyThere came to exist.
 *  Same three spellings here, on the service-role client's own error object.
 *  ONE home (REV 2.3 A12): the assembler, the transcript memo and the take
 *  mark all ask the same question of the same client — one predicate, never a
 *  twin, and no import imports the assembler just to reach it. */
export function isDuplicateRefusal(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown }
  if (e.status === 409 || e.statusCode === '409' || e.statusCode === 409) return true
  return typeof e.message === 'string' && /already exists|duplicate/i.test(e.message)
}
