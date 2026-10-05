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
    expect(screen.getByText('Northside Ford')).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}))
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
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}))
    await screen.findByRole('heading',{name:'Administration unavailable'})
    expect(screen.queryByText('Northside Ford')).not.toBeInTheDocument()
    expect(screen.queryByText('Demo owner')).not.toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    disconnected=false
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}))
    await screen.findByText('Northside Ford')
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
    expect(screen.getByText('Northside Ford')).toBeInTheDocument()
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
})
