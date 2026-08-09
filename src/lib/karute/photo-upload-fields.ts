// Shared FormData parsing for the photo-upload session-linkage fields
// (packet 2026-08-09 PR 9a/9b) — single source of truth for the web action
// (actions/customers.ts) and the facade route
// (api/app/v1/customers/[id]/photos/route.ts), which were parsing this
// verbatim block twice. captured_by_staff_id is deliberately NOT parsed here:
// attribution is server-resolved from the caller's identity (resolveSelfStaffId
// / getCurrentUserStaffId at each call site), never trusted from client input.
export function parsePhotoUploadFields(form: FormData): {
  recording_session_id?: string
  taken_with_consent?: boolean
} {
  const rawSessionId = form.get('recording_session_id')
  // '' is not a session — an empty string is functionally "absent" here too.
  const recording_session_id =
    typeof rawSessionId === 'string' && rawSessionId !== '' ? rawSessionId : undefined

  const rawConsent = form.get('taken_with_consent')
  // Never default to true — absent means "unknown", not "consented".
  const taken_with_consent =
    typeof rawConsent === 'string' ? rawConsent === 'true' : undefined

  return { recording_session_id, taken_with_consent }
}
