import { cache } from 'react'

/**
 * When the server built THIS render pass — the freshness signal <QuietRefresh>
 * compares against to decide whether the copy the router just served is stale.
 *
 * React cache() pins one value per request, which is what the SWR check
 * actually wants (every screen in one render pass agrees on "now") and what
 * keeps the clock read out of component bodies — a component calling Date.now()
 * during render is impure and re-reads on every re-render (react-hooks/purity).
 */
export const renderStamp = cache(() => Date.now())
