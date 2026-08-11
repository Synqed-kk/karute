/**
 * @jest-environment jsdom
 *
 * thin/locale.ts — the boot-frozen locale singleton (2026-08-11 packet).
 * getThinLocale() reads localStorage's `thin.locale` key ONCE, at module
 * load — every seam that used to hardcode locale="ja" now reads this
 * instead. setThinLocale persists + reloads rather than mutating the
 * in-memory value: a real reload always gets a fresh module instance, so
 * this suite proves that boot-frozen contract directly (module reset +
 * re-import per case, same idiom as staff-current-user.test.ts).
 */

async function loadLocaleModule() {
  let mod!: typeof import('../../../thin/locale')
  await jest.isolateModulesAsync(async () => {
    mod = await import('../../../thin/locale')
  })
  return mod
}

function mockReload() {
  const original = window.location
  const reloadSpy = jest.fn()
  Object.defineProperty(window, 'location', {
    value: { ...original, reload: reloadSpy },
    configurable: true,
  })
  return {
    reloadSpy,
    restore: () => {
      Object.defineProperty(window, 'location', { value: original, configurable: true })
    },
  }
}

beforeEach(() => {
  jest.resetModules()
  window.localStorage.clear()
})

describe('getThinLocale — read once at module load', () => {
  it('defaults to ja when localStorage has no thin.locale key', async () => {
    const { getThinLocale } = await loadLocaleModule()
    expect(getThinLocale()).toBe('ja')
  })

  it('falls back to ja for an invalid stored value', async () => {
    window.localStorage.setItem('thin.locale', 'fr')
    const { getThinLocale } = await loadLocaleModule()
    expect(getThinLocale()).toBe('ja')
  })

  it('reads a persisted en value at module load', async () => {
    window.localStorage.setItem('thin.locale', 'en')
    const { getThinLocale } = await loadLocaleModule()
    expect(getThinLocale()).toBe('en')
  })
})

describe('setThinLocale — persist + reload, boot-frozen', () => {
  it('writes the storage key and reloads exactly once', async () => {
    const { setThinLocale } = await loadLocaleModule()
    const { reloadSpy, restore } = mockReload()
    try {
      setThinLocale('en')
      expect(window.localStorage.getItem('thin.locale')).toBe('en')
      expect(reloadSpy).toHaveBeenCalledTimes(1)
    } finally {
      restore()
    }
  })

  it('does NOT change getThinLocale() within the same module instance — boot-frozen, not reactive', async () => {
    const { getThinLocale, setThinLocale } = await loadLocaleModule()
    const { restore } = mockReload()
    try {
      expect(getThinLocale()).toBe('ja')
      setThinLocale('en')
      // jsdom's reload is a no-op (spied above) — a REAL reload would swap
      // in a fresh module instance that reads the just-written 'en'. This
      // same instance must still report the frozen boot-time value.
      expect(getThinLocale()).toBe('ja')
    } finally {
      restore()
    }
  })
})
