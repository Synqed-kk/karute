/**
 * @jest-environment jsdom
 *
 * Unit coverage for the coaching dev-preview role-override state layer added
 * in PR #95 (replay/21). Exercises the env gate (isDevPreviewEnabled), the
 * localStorage-backed override store, its mutations, and useEffectiveCoachingRole.
 */
import { renderHook, act } from '@testing-library/react'
import {
  isDevPreviewEnabled,
  useDevPreviewRoleOverride,
  useDevPreviewMutations,
  useEffectiveCoachingRole,
} from '@/lib/coaching-dev-preview/hooks'
import type { CoachingRole } from '@/lib/coaching-dev-preview/types'

const STORAGE_KEY = 'synqed-karute-coaching-dev-preview-role'

function setupStore() {
  return renderHook(() => ({
    override: useDevPreviewRoleOverride(),
    ...useDevPreviewMutations(),
  }))
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('isDevPreviewEnabled', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV
  const ORIGINAL_FLAG = process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW

  afterEach(() => {
    // Restore env after each tweak.
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: ORIGINAL_NODE_ENV,
      configurable: true,
    })
    process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW = ORIGINAL_FLAG
  })

  function setNodeEnv(value: string) {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value,
      configurable: true,
    })
  }

  it('is true in development', () => {
    setNodeEnv('development')
    process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW = undefined
    expect(isDevPreviewEnabled()).toBe(true)
  })

  it('is true when the opt-in env var is "true" even outside development', () => {
    setNodeEnv('production')
    process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW = 'true'
    expect(isDevPreviewEnabled()).toBe(true)
  })

  it('is false in production with no opt-in flag', () => {
    setNodeEnv('production')
    process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW = undefined
    expect(isDevPreviewEnabled()).toBe(false)
  })
})

describe('useDevPreviewRoleOverride', () => {
  it('defaults to null when nothing is stored', () => {
    const { result } = setupStore()
    expect(result.current.override).toBeNull()
  })

  it('reads a stored "owner" override', () => {
    window.localStorage.setItem(STORAGE_KEY, 'owner')
    const { result } = setupStore()
    expect(result.current.override).toBe('owner')
  })

  it('reads a stored "staff" override', () => {
    window.localStorage.setItem(STORAGE_KEY, 'staff')
    const { result } = setupStore()
    expect(result.current.override).toBe('staff')
  })

  it('falls back to null for an unrecognized stored value', () => {
    window.localStorage.setItem(STORAGE_KEY, 'superadmin')
    const { result } = setupStore()
    expect(result.current.override).toBeNull()
  })
})

describe('useDevPreviewMutations', () => {
  it('setOverride("owner") persists the raw role string (not JSON)', () => {
    const { result } = setupStore()
    act(() => result.current.setOverride('owner'))
    expect(result.current.override).toBe('owner')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('owner')
  })

  it('setOverride(null) removes the key', () => {
    window.localStorage.setItem(STORAGE_KEY, 'owner')
    const { result } = setupStore()
    expect(result.current.override).toBe('owner')
    act(() => result.current.setOverride(null))
    expect(result.current.override).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('clear() removes any stored override', () => {
    window.localStorage.setItem(STORAGE_KEY, 'staff')
    const { result } = setupStore()
    act(() => result.current.clear())
    expect(result.current.override).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('useEffectiveCoachingRole', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: ORIGINAL_NODE_ENV,
      configurable: true,
    })
  })

  function setNodeEnv(value: string) {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value,
      configurable: true,
    })
  }

  it('returns the real role when no override is set (dev enabled)', () => {
    setNodeEnv('development')
    const { result } = renderHook(() =>
      useEffectiveCoachingRole('staff' as CoachingRole),
    )
    expect(result.current).toBe('staff')
  })

  it('applies the override when dev preview is enabled', () => {
    setNodeEnv('development')
    window.localStorage.setItem(STORAGE_KEY, 'owner')
    const { result } = renderHook(() =>
      useEffectiveCoachingRole('staff' as CoachingRole),
    )
    expect(result.current).toBe('owner')
  })

  it('ignores the override in production (degrades to the real role)', () => {
    setNodeEnv('production')
    process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW = undefined
    window.localStorage.setItem(STORAGE_KEY, 'owner')
    const { result } = renderHook(() =>
      useEffectiveCoachingRole('staff' as CoachingRole),
    )
    expect(result.current).toBe('staff')
  })
})
