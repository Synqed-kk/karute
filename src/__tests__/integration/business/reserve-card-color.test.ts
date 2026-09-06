/** @jest-environment node */
import { GET, PUT } from '@/app/api/business/reserve-card-color/route'
import { requireBusinessAdmission } from '@/business/lib/admission'
import { can } from '@/lib/auth/require-permission'
import { getBusinessId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { normalizeCardColor, cardForeground } from '@/business/lib/reserve-card-color'
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
jest.mock('@/lib/auth/require-permission', () => ({ can: jest.fn() }))
jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn() }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))
const get = jest.fn(), upsert = jest.fn()
const request = (body: unknown, origin = 'https://example.test') => new Request('https://example.test/api/business/reserve-card-color', { method:'PUT', headers:{ origin, 'X-Expected-Business':'a', 'Content-Type':'application/json' }, body:JSON.stringify(body) })
beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(requireBusinessAdmission).mockResolvedValue({businessId:'a',userId:'u',email:null})
  jest.mocked(can).mockResolvedValue(true)
  jest.mocked(getBusinessId).mockResolvedValue('a')
  jest.mocked(getSynqedClient).mockResolvedValue({orgSettings:{get,upsert}} as never)
  get.mockResolvedValue({name:'Business',settings:{reserve_card_color:'#285643',private_secret:'never expose'}})
  upsert.mockResolvedValue({})
})
it('returns only the public colour and company identity/name', async () => {
  expect(await (await GET()).json()).toEqual({businessId:'a',name:'Business',color:'#285643'})
})
it.each([['admission'],['capability'],['tenant']])('fails closed at %s', async kind => {
  if(kind==='admission') jest.mocked(requireBusinessAdmission).mockRejectedValue(new Error('denied'))
  if(kind==='capability') jest.mocked(can).mockResolvedValue(false)
  if(kind==='tenant') jest.mocked(getBusinessId).mockResolvedValue('other')
  expect((await GET()).status).toBe(403)
  expect((await PUT(request({color:'#123456'}))).status).toBe(403)
  expect(get).not.toHaveBeenCalled(); expect(upsert).not.toHaveBeenCalled()
})
it('rejects cross-origin writes before authorization/core', async () => {
  expect((await PUT(request({color:'#123456'},'https://evil.test'))).status).toBe(403)
  expect(requireBusinessAdmission).not.toHaveBeenCalled()
})
it.each([{color:'red'},{color:'#fff'},{color:'#123456',businessId:'other'},{settings:{reserve_card_color:'#123456'}},{},null])('rejects invalid or excessive payload %j', async body => {
  expect((await PUT(request(body))).status).toBe(400);expect(upsert).not.toHaveBeenCalled()
})
it.each(['#aAbBcC',null])('merges only the authorized key, including clear %s',async color => {
  expect((await PUT(request({color}))).status).toBe(200)
  expect(upsert).toHaveBeenCalledWith({settings:{reserve_card_color:color?.toUpperCase() ?? null}})
})
it('reports core failures honestly',async () => {
  upsert.mockRejectedValue(new Error('offline'));get.mockRejectedValue(new Error('offline'))
  expect((await PUT(request({color:'#123456'}))).status).toBe(503)
  expect((await GET()).status).toBe(503)
})
it('chooses readable extremes and normalizes strict hex',()=>{
  expect(cardForeground('#FFFFFF')).toBe('#101C18');expect(cardForeground('#000000')).toBe('#FFFFFF')
  expect(normalizeCardColor('#aabbcc')).toBe('#AABBCC');expect(normalizeCardColor('url(x)')).toBeUndefined()
})

it('rejects stale company scope before write', async () => {
  const req = request({color:'#123456'}); req.headers.set('X-Expected-Business','old-business')
  expect((await PUT(req)).status).toBe(409);expect(upsert).not.toHaveBeenCalled()
  req.headers.delete('X-Expected-Business');expect((await PUT(req)).status).toBe(409)
})
