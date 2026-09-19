import { appointments, menus, stores } from '@/business/lib/fixtures'
import { defaultKindOf, resourceKinds, resources } from '@/business/lib/fixtures-today'

describe('PKT-BUILD-N3-1 §3 / H2 — dormant kinds data', () => {
  it.each(stores)('§3 H2 exactly one kind per store: $id', (store) => {
    const kinds = resourceKinds.filter((kind) => kind.store_id === store.id)
    expect(kinds).toHaveLength(1)
    expect(defaultKindOf(store.id)).toBe(kinds[0])
    expect(kinds[0].words).toBeNull()
  })

  it.each(resources)('§3 H2 each resource has its store default: $id', (resource) => {
    const store = stores.find((row) => row.id === resource.store_id)!
    expect(store).toBeDefined()
    expect(resource.kind_id).toBe(store.default_kind_id)
  })

  it.each(menus)('§3 H2 store menus use the default and shared menus remain null: $id', (menu) => {
    if (menu.store_id === null) {
      expect(menu.requires_kind_id).toBeNull()
    } else {
      const store = stores.find((row) => row.id === menu.store_id)!
      expect(store).toBeDefined()
      expect(menu.requires_kind_id).toBe(store.default_kind_id)
    }
  })

  it('§3 H2 defaultKindOf throws for an unknown store', () => {
    expect(() => defaultKindOf('unknown-store')).toThrow('Missing default kind for store unknown-store')
  })

  it('§3 H2 no appointment carries kind_id', () => {
    const rows = appointments()
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row).not.toHaveProperty('kind_id')
  })

  it.each(stores)('§3 H2 the store default matches its own kind: $id', (store) => {
    expect(store.default_kind_id).toBe(defaultKindOf(store.id).id)
  })
})
