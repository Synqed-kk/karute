/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReserveCardColorSection } from '@/app/[locale]/(business)/business/settings/ReserveCardColorSection'
const initial = {businessId:'a',name:'Our Business',color:'#285643'}
const response = (data:unknown,ok=true) => ({ok,json:async()=>data})
beforeEach(()=>{global.fetch=jest.fn().mockResolvedValue(response(initial))})
it('loads saved company colour and saves only explicit changes',async()=>{
  render(<ReserveCardColorSection />)
  await screen.findByText('Our Business')
  expect(screen.getByRole('button',{name:'保存'})).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'ネイビー'}))
  expect(screen.getByRole('status')).toHaveTextContent('未保存')
  jest.mocked(fetch).mockResolvedValueOnce(response({...initial,color:'#304A6D'}) as Response)
  fireEvent.click(screen.getByRole('button',{name:'保存'}))
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('保存しました'))
  expect(fetch).toHaveBeenLastCalledWith('/api/business/reserve-card-color',expect.objectContaining({method:'PUT',headers:{'Content-Type':'application/json','X-Expected-Business':'a'},body:'{"color":"#304A6D"}'}))
})
it('blocks invalid custom colour and restores saved value',async()=>{
  render(<ReserveCardColorSection />);await screen.findByText('Our Business')
  fireEvent.change(screen.getByLabelText('カラーコード'),{target:{value:'#oops'}})
  expect(screen.getByRole('alert')).toBeInTheDocument();expect(screen.getByRole('button',{name:'保存'})).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'変更を戻す'}))
  expect(screen.getByLabelText('カラーコード')).toHaveValue('#285643')
})
it('does not claim success on failed save or read',async()=>{
  const view=render(<ReserveCardColorSection />);await screen.findByText('Our Business')
  fireEvent.click(screen.getByRole('button',{name:'プラム'}))
  jest.mocked(fetch).mockResolvedValueOnce(response({},false) as Response)
  fireEvent.click(screen.getByRole('button',{name:'保存'}))
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('保存できません'))
  view.unmount();jest.mocked(fetch).mockResolvedValueOnce(response({},false) as Response)
  render(<ReserveCardColorSection />)
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('読み込めません'))
  expect(screen.getByRole('button',{name:'ネイビー'})).toBeDisabled()
})
it('ignores stale read after unmount and fetches the company value again',async()=>{
  let resolve!: (data:unknown)=>void
  jest.mocked(fetch).mockImplementationOnce(()=>new Promise(r=>{resolve=r}) as Promise<Response>)
  const view=render(<ReserveCardColorSection />);view.unmount()
  render(<ReserveCardColorSection />);await screen.findByText('Our Business')
  resolve(response({...initial,name:'Old Business'}))
  await waitFor(()=>expect(screen.queryByText('Old Business')).not.toBeInTheDocument())
})
