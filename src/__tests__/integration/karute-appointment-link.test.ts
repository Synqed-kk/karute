/**
 * readAppointmentForSave — the ONE place both karute save doors split a booking
 * read into ok / not found (core's 404, no retry) / unreadable (anything else,
 * after ONE retry). A wrong split either keeps a dangling link (404 read as a
 * blip) or drops a real one (a blip read as a 404).
 */
import { readAppointmentForSave } from '@/lib/karute/appointment-link'

const booking = { id: 'ap-1', store_id: 'store-A' }
const withStatus = (status: unknown) => Object.assign(new Error('x'), { status })
const client = (get: jest.Mock) => ({ get }) as unknown as Parameters<typeof readAppointmentForSave>[0]

describe('readAppointmentForSave', () => {
  it('a good read is ok after one call', async () => {
    const get = jest.fn().mockResolvedValue(booking)
    expect(await readAppointmentForSave(client(get), 'ap-1')).toEqual({ appointment: booking, state: 'ok' })
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('ap-1')
  })

  it('a 404 is not found after ONE call — no retry', async () => {
    const get = jest.fn().mockRejectedValue(withStatus(404))
    expect(await readAppointmentForSave(client(get), 'ap-1')).toEqual({ appointment: null, state: 'not_found' })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('a non-404 failure then a good read is ok after two calls', async () => {
    const get = jest.fn().mockRejectedValueOnce(withStatus(503)).mockResolvedValueOnce(booking)
    expect(await readAppointmentForSave(client(get), 'ap-1')).toEqual({ appointment: booking, state: 'ok' })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('two non-404 failures are unreadable after two calls', async () => {
    const get = jest.fn().mockRejectedValue(withStatus(500))
    expect(await readAppointmentForSave(client(get), 'ap-1')).toEqual({ appointment: null, state: 'unreadable' })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('a non-404 failure then a 404 is not found', async () => {
    const get = jest.fn().mockRejectedValueOnce(withStatus(502)).mockRejectedValueOnce(withStatus(404))
    expect(await readAppointmentForSave(client(get), 'ap-1')).toEqual({ appointment: null, state: 'not_found' })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('an error with no status at all (a network TypeError) twice is unreadable', async () => {
    const get = jest.fn().mockRejectedValue(new TypeError('fetch failed'))
    expect(await readAppointmentForSave(client(get), 'ap-1')).toEqual({ appointment: null, state: 'unreadable' })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('a 403 twice is unreadable after two calls — only a literal 404 means not found', async () => {
    const get = jest.fn().mockRejectedValue(withStatus(403))
    expect(await readAppointmentForSave(client(get), 'ap-1')).toEqual({ appointment: null, state: 'unreadable' })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('a 400 then a good read is ok after two calls — a non-404 4xx retries like any blip', async () => {
    const get = jest.fn().mockRejectedValueOnce(withStatus(400)).mockResolvedValueOnce(booking)
    expect(await readAppointmentForSave(client(get), 'ap-1')).toEqual({ appointment: booking, state: 'ok' })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("a 404 carried as the STRING '404' is not treated as not found (unreadable after the retry)", async () => {
    const get = jest.fn().mockRejectedValue(withStatus('404'))
    expect(await readAppointmentForSave(client(get), 'ap-1')).toEqual({ appointment: null, state: 'unreadable' })
    expect(get).toHaveBeenCalledTimes(2)
  })
})
