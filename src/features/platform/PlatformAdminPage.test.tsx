import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlatformAdminPage from './PlatformAdminPage'
import type { PlatformOverview } from './types'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
const overview:PlatformOverview={owner:{id:'synthetic-owner',email:'owner@example.invalid',name:'Demo owner',enabled:true},revision:0,generatedAt:'2026-10-05T14:00:00Z',groups:[{id:'synthetic-north',name:'Northside Motors',status:'active',updatedAt:'2026-10-05T12:00:00Z',dealerships:[{id:'synthetic-store',groupId:'synthetic-north',name:'Northside Ford',storeKey:'northside',website:'https://northside.example.invalid',enabled:true}],health:{status:'current',connected:true,activeEmployees:1,employees:1,groupManagers:1,message:'Synthetic current publication'}}],owners:[{id:'synthetic-owner',name:'Demo owner',email:'owner@example.invalid',enabled:true}],audit:[]}
const members={groupId:'synthetic-north',revision:0,members:[{id:'synthetic-manager',name:'Synthetic manager',email:'manager@example.invalid',role:'group_manager',homeStore:'northside',enabled:true}],audit:[]}
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const ok=(body:unknown)=>Response.json(body)
const selectGroup=async()=>{fireEvent.click(await screen.findByRole('button',{name:/Northside Motors/}));await screen.findByRole('heading',{name:'Northside Motors'})}

describe('Software administration',()=>{
  it('loads independently of employee bootstrap, opens a group and saves attributed employee settings',async()=>{
    const fetcher=vi.fn(async(url:string,options?:RequestInit)=>options?.method==='POST'?ok({saved:true}):ok(url.endsWith('/members')?members:overview))
    vi.stubGlobal('fetch',fetcher)
    render(<PlatformAdminPage/>)
    await selectGroup()
    expect(within(screen.getByRole('region',{name:'Northside Motors account'})).getByText('Northside Ford')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'People & access'}))
    await screen.findByText('Synthetic manager')
    fireEvent.click(screen.getByRole('button',{name:'Edit'}))
    const form=screen.getByRole('form',{name:'Edit employee'})
    expect(within(form).queryByRole('option',{name:'Software owner'})).not.toBeInTheDocument()
    fireEvent.change(within(form).getByRole('textbox',{name:'Employee name'}),{target:{value:'Synthetic updated manager'}})
    fireEvent.change(within(form).getByRole('textbox',{name:'Reason for this change'}),{target:{value:'Synthetic employee update'}})
    fireEvent.submit(form)
    await screen.findByText('Change saved and recorded in the audit history.')
    const calls=fetcher.mock.calls as [string,RequestInit?][]
    expect(calls.every(([url])=>url.startsWith('/api/platform'))).toBe(true)
    const post=calls.find(([,options])=>options?.method==='POST')!
    expect(post[0]).toBe('/api/platform/groups/synthetic-north/members')
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({id:'synthetic-manager',name:'Synthetic updated manager',expectedRevision:0})
    expect(post[1]?.headers).not.toHaveProperty('x-inventory-authenticated-role')
  })
  it('clears protected records and edits after revocation, and discards an older pending response',async()=>{
    let revoke=false, resolveMembers:(value:Response)=>void=()=>{}
    const fetcher=vi.fn((url:string)=>url.endsWith('/members')?new Promise<Response>(resolve=>{resolveMembers=resolve}):Promise.resolve(revoke?Response.json({error:'Software-owner access is required.'},{status:403}):ok(overview)))
    vi.stubGlobal('fetch',fetcher)
    render(<PlatformAdminPage/>)
    await selectGroup()
    fireEvent.click(screen.getByRole('button',{name:'People & access'}))
    await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/platform/groups/synthetic-north/members',expect.anything()))
    revoke=true
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}))
    await screen.findByRole('heading',{name:'Software-owner access required'})
    resolveMembers(ok(members))
    await waitFor(()=>expect(screen.queryByText('Synthetic manager')).not.toBeInTheDocument())
    expect(screen.queryByText('Northside Ford')).not.toBeInTheDocument()
    expect(screen.queryByText('Demo owner')).not.toBeInTheDocument()
  })
  it.each([
    ['an HTML access refusal',()=>new Response('<html>Access denied</html>',{status:403,headers:{'Content-Type':'text/html'}})],
    ['an HTML sign-in page',()=>new Response('<html>Sign in</html>',{headers:{'Content-Type':'text/html'}})],
    ['a sign-in redirect',()=>{const response=ok(overview);Object.defineProperty(response,'redirected',{value:true});return response}],
  ] as const)('clears protected records and open edits on %s',async(_name,response)=>{
    let signInRequired=false
    vi.stubGlobal('fetch',vi.fn(async()=>signInRequired?response():ok(overview)))
    render(<PlatformAdminPage/>)
    await selectGroup()
    fireEvent.click(screen.getByRole('button',{name:'Add group'}))
    expect(screen.getByRole('form',{name:'Add dealership group'})).toBeInTheDocument()
    signInRequired=true
    fireEvent(window,new Event('focus'))
    await screen.findByRole('heading',{name:'Software-owner access required'})
    expect(screen.queryByText('Northside Ford')).not.toBeInTheDocument()
    expect(screen.queryByText('Demo owner')).not.toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })
  it('clears protected records when an owner refresh cannot verify access, then recovers on retry',async()=>{
    let disconnected=false
    vi.stubGlobal('fetch',vi.fn(async()=>{if(disconnected)throw new TypeError('Synthetic network unavailable');return ok(overview)}))
    render(<PlatformAdminPage/>)
    await selectGroup()
    fireEvent.click(screen.getByRole('button',{name:'Add group'}))
    disconnected=true
    fireEvent(window,new Event('focus'))
    await screen.findByRole('heading',{name:'Administration unavailable'})
    expect(screen.queryByText('Northside Ford')).not.toBeInTheDocument()
    expect(screen.queryByText('Demo owner')).not.toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    disconnected=false
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}))
    await within(await screen.findByRole('region',{name:'Northside Motors account'})).findByText('Northside Ford')
    expect(screen.queryByRole('heading',{name:'Administration unavailable'})).not.toBeInTheDocument()
  })
  it('does not let an older failed refresh erase a newer verified owner view',async()=>{
    let reads=0, rejectOlder:(error:Error)=>void=()=>{}
    vi.stubGlobal('fetch',vi.fn(async()=>{
      reads++
      if(reads===2)return new Promise<Response>((_resolve,reject)=>{rejectOlder=reject})
      return ok(reads>2?{...overview,owner:{...overview.owner,name:'Refreshed owner'}}:overview)
    }))
    render(<PlatformAdminPage/>)
    await selectGroup()
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}))
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}))
    await screen.findByText('Refreshed owner')
    await act(async()=>rejectOlder(new TypeError('Synthetic older request failed')))
    expect(screen.getByText('Refreshed owner')).toBeInTheDocument()
    expect(within(screen.getByRole('region',{name:'Northside Motors account'})).getByText('Northside Ford')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('keeps an idempotency key when retrying an uncertain network failure',async()=>{
    let writes=0
    const fetcher=vi.fn(async(_url:string,options?:RequestInit)=>{
      if(options?.method==='POST') {writes++;if(writes===1)throw new Error('Synthetic connection interrupted');return ok({saved:true})}
      return ok(overview)
    })
    vi.stubGlobal('fetch',fetcher)
    render(<PlatformAdminPage/>)
    fireEvent.click(await screen.findByRole('button',{name:'Add group'}))
    fireEvent.change(screen.getByRole('textbox',{name:'Group name'}),{target:{value:'Synthetic new group'}})
    fireEvent.change(screen.getByRole('textbox',{name:'Reason for this change'}),{target:{value:'Synthetic onboarding'}})
    fireEvent.submit(screen.getByRole('form',{name:'Add dealership group'}))
    await screen.findByRole('alert')
    fireEvent.submit(screen.getByRole('form',{name:'Add dealership group'}))
    await screen.findByText('Change saved and recorded in the audit history.')
    const posts=(fetcher.mock.calls as [string,RequestInit?][]).filter(([,options])=>options?.method==='POST')
    expect(posts).toHaveLength(2)
    expect(posts[0][1]?.body).toBe(posts[1][1]?.body)
    expect(posts[0][1]?.headers).toEqual(posts[1][1]?.headers)
  })
  it('filters account selection without leaving an excluded group’s records visible',async()=>{
    const lakeside={...overview.groups[0],id:'synthetic-lake',name:'Lakeside Group',status:'setup' as const,dealerships:[],health:{status:'not_connected',message:'Not connected'}}
    vi.stubGlobal('fetch',vi.fn(async()=>ok({...overview,groups:[...overview.groups,lakeside]})))
    render(<PlatformAdminPage/>)
    await selectGroup()
    fireEvent.change(screen.getByRole('textbox',{name:'Find a group or dealership'}),{target:{value:'Lakeside'}})
    await screen.findByRole('region',{name:'Lakeside Group account'})
    expect(screen.queryByRole('region',{name:'Northside Motors account'})).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox',{name:'Account state filter'}),{target:{value:'active'}})
    await screen.findByRole('heading',{name:'No matching account'})
    expect(screen.queryByRole('region',{name:'Lakeside Group account'})).not.toBeInTheDocument()
  })
  it('keeps the source action mounted during revalidation so a dialog restores focus',async()=>{
    const connection={id:'synthetic-source',groupId:'synthetic-north',dealershipId:'synthetic-store',name:'Synthetic source',provider:'public_inventory',method:'api',endpoint:'https://feed.example.invalid/inventory',credentialRef:'',enabled:true,cadence:'daily',localTime:'05:30',timezone:'America/Detroit',updatedAt:'2026-10-05T12:00:00Z',verification:'not_verified'}
    const sourceData={groupId:'synthetic-north',revision:0,connections:[connection],requests:[],execution:{connected:false,message:'No executor is connected.'}}
    let sourceReads=0,finish!:(response:Response)=>void
    const pending=new Promise<Response>(resolve=>{finish=resolve})
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/connections')?(++sourceReads===1?ok(sourceData):pending):ok(overview)))
    render(<PlatformAdminPage/>)
    fireEvent.click(await screen.findByRole('button',{name:'Data connections'}))
    const trigger=await screen.findByRole('button',{name:'Configure'})
    fireEvent.click(trigger)
    await act(async()=>{fireEvent(window,new Event('focus'))})
    expect(sourceReads).toBe(2)
    expect(trigger.isConnected).toBe(true)
    fireEvent.keyDown(document,{key:'Escape'})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(()=>expect(trigger).toHaveFocus())
    await act(async()=>{finish(ok(sourceData));await pending})
    expect(screen.getByRole('button',{name:'Configure'})).toBe(trigger)
  })
  it('queues a dealership-scoped pull without representing it as completed or connected',async()=>{
    const connection={id:'synthetic-source',groupId:'synthetic-north',dealershipId:'synthetic-store',name:'Synthetic inventory feed',provider:'public_inventory',method:'api',endpoint:'https://feed.example.invalid/inventory',credentialRef:'',enabled:true,cadence:'daily',localTime:'05:30',timezone:'America/Detroit',updatedAt:'2026-10-05T12:00:00Z',verification:'not_verified'}
    let saved=false
    const fetcher=vi.fn(async(url:string,options?:RequestInit)=>{
      if(options?.method==='POST'){saved=true;return ok({saved:true})}
      return ok(url.endsWith('/connections')?{groupId:'synthetic-north',revision:saved?1:0,connections:[connection],requests:saved?[{id:'synthetic-pull',connectionId:connection.id,state:'queued',requestedBy:'Demo owner',createdAt:'2026-10-05T14:00:00Z',updatedAt:'2026-10-05T14:00:00Z'}]:[],execution:{connected:false,message:'No executor is connected.'}}:overview)
    })
    vi.stubGlobal('fetch',fetcher)
    render(<PlatformAdminPage/>)
    fireEvent.click(await screen.findByRole('button',{name:'Data connections'}))
    await screen.findByRole('heading',{name:connection.name})
    expect(screen.getByText('Executor not connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Request pull'}))
    fireEvent.change(screen.getByRole('textbox',{name:'Reason for this change'}),{target:{value:'Synthetic dealership request'}})
    await act(async()=>{fireEvent.submit(screen.getByRole('form',{name:'Request data pull'}))})
    await screen.findByText(/Pull queued · awaiting executor/)
    expect(screen.getByRole('button',{name:'Cancel request'})).toBeEnabled()
    expect(screen.getByText('Change saved and recorded in the audit history.')).toBeInTheDocument()
    const posts=(fetcher.mock.calls as [string,RequestInit?][]).filter(([,options])=>options?.method==='POST')
    expect(posts[0][0]).toBe('/api/platform/groups/synthetic-north/pulls')
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({connectionId:'synthetic-source',operation:'request',expectedRevision:0})
    expect(screen.getByRole('button',{name:'Request pull'})).toBeDisabled()
    expect(screen.getByRole('button',{name:'Cancel request'})).toBeEnabled()
  })
  it('discards pending audit details and closes the dialog when owner access is revoked',async()=>{
    let revoked=false,resolveAudit:(response:Response)=>void=()=>{}
    const event={id:'synthetic-audit',actor:'Demo owner',entity:'groups',targetId:'synthetic-north',action:'created',reason:'Synthetic audit reason',occurredAt:'2026-10-05T14:00:00Z'}
    vi.stubGlobal('fetch',vi.fn((url:string)=>url.includes('/audit/')?new Promise<Response>(resolve=>{resolveAudit=resolve}):Promise.resolve(revoked?Response.json({error:'Revoked'},{status:403}):ok({...overview,audit:[event]}))))
    render(<PlatformAdminPage/>)
    fireEvent.click(await screen.findByRole('button',{name:'Review change: Synthetic audit reason'}))
    await screen.findByRole('dialog',{name:'Review administrative change'})
    revoked=true;fireEvent(window,new Event('focus'))
    await screen.findByRole('heading',{name:'Software-owner access required'})
    await act(async()=>resolveAudit(ok({...event,changes:[{field:'name',before:null,after:'PRIVATE_LATE_AUDIT_CANARY'}]})))
    expect(screen.queryByText('PRIVATE_LATE_AUDIT_CANARY')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

})
