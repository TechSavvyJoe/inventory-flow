import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlatformCollectors } from './PlatformCollectors'
import type { PlatformCollector, PlatformCollectorsData, PlatformConnection, PlatformGroup, PlatformRequest } from './types'

const group:PlatformGroup={id:'synthetic-group',name:'Synthetic group',status:'active',updatedAt:'',health:{status:'current',message:'Synthetic'},dealerships:Array.from({length:4},(_,i)=>({id:`dealer-${i}`,groupId:'synthetic-group',name:`Synthetic dealership ${i+1}`,storeKey:`store-${i}`,website:'',enabled:true}))}
const connections:PlatformConnection[]=group.dealerships.map((dealer,i)=>({id:`source-${i}`,groupId:group.id,dealershipId:dealer.id,name:`Permitted holds ${i+1}`,provider:'dealermail',method:'collector',endpoint:'',credentialRef:'',enabled:true,cadence:'manual',localTime:'05:30',timezone:'America/Detroit',updatedAt:'',verification:'not_verified'}))
const collector:PlatformCollector={id:'synthetic-host',groupId:group.id,name:'Synthetic capture computer',accessClientId:'synthetic-service',adapterId:'dealermail-hold-refresh',adapterVersion:'1',profileId:'synthetic-profile',profileSha256:'a'.repeat(64),enabled:false,generation:1,lastSeenAt:null,dealershipIds:group.dealerships.map(dealer=>dealer.id),connectionIds:connections.map(source=>source.id),scopeLabel:'Group-wide DealerMail refresh'}
const data:PlatformCollectorsData={groupId:group.id,revision:9,executionEnabled:false,collectors:[],attempts:[]}
afterEach(cleanup)
async function setup(next:PlatformCollectorsData=data,post?:()=>Promise<unknown>) {
  const request=vi.fn(async(_path:string,body?:unknown,_key?:string)=>body?post?post():{saved:true}:next)
  render(<PlatformCollectors group={group} connections={connections} request={request as PlatformRequest} revision={0} busy={false} onChanged={vi.fn()}/> )
  await screen.findByRole('button',{name:'Register host'})
  await waitFor(()=>expect(screen.getByRole('button',{name:'Register host'})).toBeEnabled())
  return request
}
function fillEnrollment(){
  fireEvent.change(screen.getByRole('textbox',{name:'Collector name'}),{target:{value:'Reviewed capture computer'}})
  fireEvent.change(screen.getByRole('textbox',{name:'Access service client ID'}),{target:{value:'synthetic-client'}})
  fireEvent.change(screen.getByRole('textbox',{name:'Installed profile ID'}),{target:{value:'synthetic-profile'}})
  fireEvent.change(screen.getByRole('textbox',{name:'Installed profile fingerprint'}),{target:{value:'a'.repeat(64)}})
  fireEvent.change(screen.getByRole('textbox',{name:'Reason for this change'}),{target:{value:'Synthetic authorized collector setup'}})
}
describe('Collector enrollment and independently verified outcomes',()=>{
  it('requires an explicit full group source review and registers a paused profile without source access',async()=>{
    const request=await setup()
    fireEvent.click(screen.getByRole('button',{name:'Register host'}));fillEnrollment()
    fireEvent.submit(screen.getByRole('form',{name:'Collector enrollment change'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('Review all four dealerships')
    expect(request.mock.calls.filter(call=>call[1])).toHaveLength(0)
    fireEvent.click(screen.getByRole('checkbox',{name:/I reviewed permission/}))
    fireEvent.submit(screen.getByRole('form',{name:'Collector enrollment change'}))
    await screen.findByRole('status')
    const post=request.mock.calls.find(call=>call[1])!
    expect(post[0]).toBe('/groups/synthetic-group/collectors')
    expect(post[1]).toMatchObject({operation:'enroll',adapterId:'dealermail-hold-refresh',adapterVersion:'1',dealershipIds:group.dealerships.map(dealer=>dealer.id),connectionIds:connections.map(source=>source.id),expectedRevision:9})
    expect(post[1]).not.toHaveProperty('enabled')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('distinguishes contact, reported capture, unknown publication and verified exact publication',async()=>{
    await setup({...data,collectors:[{...collector,enabled:true,lastSeenAt:'2026-10-09T12:00:00Z'}],attempts:[{id:'reported',requestId:'p1',collectorId:collector.id,stage:'captured',createdAt:'2026-10-09T12:00:00Z',capturedAt:'2026-10-09T12:01:00Z'},{id:'unknown',requestId:'p2',collectorId:collector.id,stage:'reconciliation_required',createdAt:'2026-10-09T12:02:00Z'},{id:'verified',requestId:'p3',collectorId:collector.id,stage:'completed',createdAt:'2026-10-09T12:03:00Z',publication:{status:'published_and_verified',bundleSha256:'b'.repeat(64)}}]})
    expect(screen.getByText('Execution disabled')).toBeInTheDocument()
    expect(screen.getByText('Reported complete')).toBeInTheDocument()
    expect(screen.getByText('Not verified')).toBeInTheDocument()
    expect(screen.getByText('Unknown; reconcile exact candidate')).toBeInTheDocument()
    expect(screen.getByText('Verified exact release')).toBeInTheDocument()
  })
  it('reviews revocation without promising to undo an admitted publication and attributes its reason',async()=>{
    const request=await setup({...data,collectors:[collector]})
    fireEvent.click(screen.getByRole('button',{name:'Revoke host'}))
    const dialog=screen.getByRole('dialog',{name:'Revoke dealership collector'})
    expect(dialog).toHaveTextContent('publication may already be in flight')
    fireEvent.change(within(dialog).getByRole('textbox',{name:'Reason for this change'}),{target:{value:'Synthetic host retired'}})
    fireEvent.submit(within(dialog).getByRole('form'))
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(request.mock.calls.find(call=>call[1])?.[1]).toEqual({operation:'revoke',id:collector.id,reason:'Synthetic host retired',expectedRevision:9})
  })
  it('retries an uncertain enrollment response with the same idempotency key and retains reviewed form data',async()=>{
    let count=0
    const request=await setup(data,async()=>{if(count++===0)throw new Error('Synthetic response interrupted');return {saved:true}})
    fireEvent.click(screen.getByRole('button',{name:'Register host'}));fillEnrollment()
    fireEvent.click(screen.getByRole('checkbox',{name:/I reviewed permission/}))
    await act(async()=>fireEvent.submit(screen.getByRole('form',{name:'Collector enrollment change'})))
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic response interrupted')
    expect(screen.getByRole('textbox',{name:'Collector name'})).toHaveValue('Reviewed capture computer')
    await act(async()=>fireEvent.submit(screen.getByRole('form',{name:'Collector enrollment change'})))
    const writes=request.mock.calls.filter(call=>call[1])
    expect(writes).toHaveLength(2);expect(writes[0][2]).toBe(writes[1][2])
  })
  it('keeps revoked hosts visible for review and does not offer to re-enable them',async()=>{
    await setup({...data,collectors:[{...collector,revokedAt:'2026-10-09T12:00:00Z'}]})
    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Enable host'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Revoke host'})).not.toBeInTheDocument()
  })
  it('checks an unknown saved publication without dispatching another pull or asserting success',async()=>{
    const request=await setup({...data,collectors:[collector],attempts:[{id:'unknown',requestId:'p2',collectorId:collector.id,stage:'reconciliation_required',createdAt:'2026-10-09T12:02:00Z'}]},async()=>({status:'reconciliation_required'}))
    fireEvent.click(screen.getByRole('button',{name:'Check saved publication'}))
    await screen.findByText('Publication is still unconfirmed. The retained candidate remains blocked for reconciliation.')
    expect(request.mock.calls.find(call=>call[1])?.slice(0,2)).toEqual(['/groups/synthetic-group/collector-reconcile',{attemptId:'unknown'}])
    expect(screen.queryByText('Verified exact release')).not.toBeInTheDocument()
  })
})
