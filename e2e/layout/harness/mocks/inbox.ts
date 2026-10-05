// Stand-in for the recordings inbox: ?badge=N.
const q = new URLSearchParams(location.search)
export function useRecordingsInbox() {
  return { needsAttention: Number(q.get('badge') ?? 0) }
}
