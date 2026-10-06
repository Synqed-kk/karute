// The ONE UUID-shape pattern, shared by the facade handler (a non-UUID
// params.id never stamps an audit target) and the sync store resolver (a
// requested store id that is not UUID-shaped is refused before any lookup).
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
