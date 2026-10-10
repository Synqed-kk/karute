'use client'

// P2 — the Business segment's boundary for a PAGE's throw (a layout's own throw is caught by the layout: a segment's
// error.tsx sits inside its layout). A prod boundary cannot read the message, so it shows the digest only: the bound's
// CoreUnanswered sets digest = its ref, which Next keeps; any other error shows Next's own hashed digest.
import { CoreUnansweredNotice } from './CoreUnansweredNotice'

export default function BusinessError({ error }: { error: Error & { digest?: string } }) {
  return <CoreUnansweredNotice reference={error.digest} />
}
