/** Parsed audit lines captured from the console sink during `run`.
 *  Spies BOTH levels: info/notice emit on console.log, warning on console.warn.
 *  Shared by the facade-hook and web-action audit suites — the assertions pin
 *  the interim console-line shape the future core sink replaces. */
export async function auditLines(run: () => Promise<unknown>) {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await run()
    return [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((args) => {
        try {
          return JSON.parse(String(args[0]))
        } catch {
          return null
        }
      })
      .filter((j): j is Record<string, unknown> => !!j && j.evt === 'audit')
  } finally {
    logSpy.mockRestore()
    warnSpy.mockRestore()
  }
}
