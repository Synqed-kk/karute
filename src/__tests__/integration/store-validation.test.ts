import { storeSchema } from '@/lib/validations/store'

describe('store validation', () => {
  it('accepts a valid store', () => {
    expect(
      storeSchema.safeParse({ name: 'La Estro 代官山', address: '東京都渋谷区', phone: '03-1234-5678' })
        .success,
    ).toBe(true)
  })

  it('requires a name', () => {
    expect(storeSchema.safeParse({ name: '', address: '', phone: '' }).success).toBe(false)
  })

  it('allows empty / omitted address + phone', () => {
    expect(storeSchema.safeParse({ name: 'Main store' }).success).toBe(true)
    expect(storeSchema.safeParse({ name: 'Main store', address: '', phone: '' }).success).toBe(true)
  })

  it('trims the name', () => {
    const r = storeSchema.safeParse({ name: '  渋谷店  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.name).toBe('渋谷店')
  })
})
