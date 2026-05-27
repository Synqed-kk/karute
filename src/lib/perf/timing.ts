// Lightweight per-request phase timer for server pages. Writes a single line
// to stderr at the end of the request that shows where the time went. Picked
// up by Vercel function logs without needing OpenTelemetry/etc.
//
// Usage:
//   const t = startTiming('dashboard')
//   const staff = await t.phase('staffList', () => getStaffList())
//   const data = await t.phase('dashboardData', () => getDashboardData())
//   t.end()

export interface PageTiming {
  phase<T>(name: string, fn: () => Promise<T>): Promise<T>
  end(): void
}

export function startTiming(label: string): PageTiming {
  const start = performance.now()
  const phases: Array<{ name: string; ms: number }> = []

  return {
    async phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const t0 = performance.now()
      try {
        return await fn()
      } finally {
        phases.push({ name, ms: Math.round(performance.now() - t0) })
      }
    },
    end() {
      const total = Math.round(performance.now() - start)
      const parts = phases.map((p) => `${p.name}=${p.ms}ms`).join(' ')
      // Single-line format so Vercel log search stays usable.
      console.log(`[perf] ${label} total=${total}ms ${parts}`)
    },
  }
}
