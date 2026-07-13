// Pure URL rewrite for the Vite DataPort — factored out so it is testable in
// jest WITHOUT `import.meta.env` (which jest cannot parse). The `.vite.ts`
// wrapper reads the facade base from env and delegates here.

/**
 * Prefix an app-relative `/api/*` path with the facade base URL.
 *
 *   facadeApiUrl('https://karute-omega.vercel.app', '/api/ai/chat')
 *     -> 'https://karute-omega.vercel.app/api/ai/chat'
 *
 * Absolute URLs (already have a scheme) pass through untouched — a caller that
 * signed its own absolute URL is not ours to rewrite. A trailing slash on the
 * base is normalized so we never emit `//api`.
 */
export function facadeApiUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const b = base.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}
