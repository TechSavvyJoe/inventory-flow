import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlatformOemCoverage } from './PlatformOemCoverage'
import type { PlatformConnections, PlatformGroup, PlatformStoredCoverage } from './types'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
const group:PlatformGroup={id:'synthetic',name:'Synthetic Motors',status:'active',updatedAt:'2026-10-05',dealerships:[{id:'north',groupId:'synthetic',name:'Synthetic North',storeKey:'north',website:'',enabled:true}],health:{status:'current',message:'Stored publication'}}
const data:PlatformConnections={groupId:'synthetic',revision:1,connections:[{id:'oem',groupId:'synthetic',dealershipId:'north',name:'Synthetic OEM',provider:'oem',oem:'ford_lincoln',method:'collector',endpoint:'',credentialRef:'',enabled:false,cadence:'manual',localTime:'05:30',timezone:'America/Detroit',updatedAt:'2026-10-05',verification:'not_verified'},{id:'other-crm',groupId:'synthetic',dealershipId:'north',name:'Independent CRM',provider:'crm',oem:'not_applicable',vendor:'Independent CRM',method:'collector',endpoint:'',credentialRef:'',enabled:true,cadence:'manual',localTime:'05:30',timezone:'America/Detroit',updatedAt:'2026-10-05',verification:'not_verified'}],requests:[],execution:{connected:false,message:'Not connected'}}
const stored:PlatformStoredCoverage={basis:'stored_publication',reportDate:'2026-10-05',publishedAt:'2026-10-05T12:00:00Z',counts:{publicRowCount:7,dealerMailRowCount:6,dealerMailVinReconciledCount:5,dealerMailVinReviewCount:1,fordOasisRecordCount:0},stores:[{storeKey:'north',publicCount:7,crmCount:6}]}
const start=(coverage?:PlatformStoredCoverage)=>{const onInspect=vi.fn(),onAdd=vi.fn();render(<PlatformOemCoverage group={{...group,health:{...group.health,coverage}}} data={data} busy={false} onInspect={onInspect} onAdd={onAdd}/>);return {onInspect,onAdd}}
afterEach(cleanup)
const metric=(name:string)=>within(screen.getByRole('region',{name:'Stored publication coverage'})).getByText(name).closest('div')!
describe('Stored evidence and manufacturer planning',()=>{
 it('shows stored group counters separately from saved source preferences and missing values',()=>{
  start(stored)
  expect(metric('Public inventory rows')).toHaveTextContent('7')
  expect(metric('Ford OASIS records')).toHaveTextContent('0')
  expect(metric('Ford invoice records')).toHaveTextContent('Not reported')
  expect(screen.getByText('Group publication · 2026-10-05')).toBeInTheDocument()
  expect(metric('DealerMail source rows')).toHaveTextContent('6')
  expect(metric('DealerMail rows reconciled to VINs')).toHaveTextContent('5')
  expect(metric('DealerMail rows needing VIN review')).toHaveTextContent('1')
  expect(screen.queryByText('CRM source rows')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Ford / Lincoln source totals')).toHaveTextContent('1 configured · 0 enabled preferences · 1 paused')
  const dealer=screen.getByRole('group',{name:'Stored coverage at Synthetic North'})
  expect(within(dealer).getByText('Public rows').closest('div')).toHaveTextContent('7')
  expect(within(dealer).getByText('DealerMail rows').closest('div')).toHaveTextContent('6')
  expect(within(dealer).getByText('Active inventory').closest('div')).toHaveTextContent('Not reported')
 })
 it('shows unknown coverage when absent rather than inventing zero captures',()=>{
  start()
  expect(metric('Public inventory rows')).toHaveTextContent('Not reported')
  expect(metric('Ford OASIS records')).toHaveTextContent('Not reported')
  expect(screen.getByText(/Stored coverage totals are not available/)).toBeInTheDocument()
 })
 it('rejects invalid numeric display values and does not fuzzy match foreign store totals',()=>{
  start({...stored,counts:{publicRowCount:-1,dealerMailRowCount:1.5,fordOasisRecordCount:Infinity},stores:[{storeKey:'Synthetic North',publicCount:999},{storeKey:'foreign',crmCount:888}]})
  expect(metric('Public inventory rows')).toHaveTextContent('Not reported')
  expect(metric('DealerMail source rows')).toHaveTextContent('Not reported')
  expect(metric('Ford OASIS records')).toHaveTextContent('Not reported')
  expect(screen.getByRole('group',{name:'Stored coverage at Synthetic North'})).not.toHaveTextContent('999')
  expect(screen.getByRole('group',{name:'Stored coverage at Synthetic North'})).not.toHaveTextContent('888')
 })
 it('keeps manufacturer planning and scoped inspect/add actions available',()=>{
  const {onInspect,onAdd}=start(stored)
  fireEvent.click(screen.getByRole('button',{name:'View Synthetic OEM'}));expect(onInspect).toHaveBeenCalledWith('oem')
  fireEvent.change(screen.getByRole('combobox',{name:'OEM family'}),{target:{value:'toyota_lexus'}})
  fireEvent.click(screen.getByRole('button',{name:'Add Toyota / Lexus source for Synthetic North'}));expect(onAdd).toHaveBeenCalledWith('toyota_lexus','north')
  expect(screen.getByRole('heading',{name:'Potential fields · Toyota / Lexus'})).toBeInTheDocument()
  expect(screen.getByText(/Saving a connection does not install an adapter/)).toBeInTheDocument()
 })
})
