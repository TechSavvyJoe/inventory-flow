import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PlatformChangeDialog } from './PlatformChangeDialog'
import type { PlatformEdit } from './types'

// SYNTHETIC_FIXTURE_DO_NOT_USE_FOR_OPERATIONS
const draft:PlatformEdit={kind:'source',title:'Add data connection',path:'/groups/synthetic/connections',values:{dealershipId:'synthetic-dealer',name:'Synthetic feed',provider:'public_inventory',vendor:'Synthetic provider',oem:'not_applicable',method:'collector',endpoint:'',credentialRef:'',cadence:'manual',localTime:'05:30',timezone:'America/Detroit',enabled:false,expectedRevision:1},fields:[
 {key:'name',label:'Connection name'},{key:'dealershipId',label:'Dealership',options:[{value:'synthetic-dealer',label:'Synthetic dealership'}]},
 {key:'provider',label:'Data source',options:[{value:'public_inventory',label:'Public inventory'},{value:'oem',label:'OEM'},{value:'crm',label:'CRM'}]},
 {key:'vendor',label:'Provider or vendor name'},{key:'oem',label:'OEM connection',options:[{value:'not_applicable',label:'Not OEM-specific'},{value:'ford_lincoln',label:'Ford / Lincoln'}]},
 {key:'method',label:'Connection method',options:[{value:'collector',label:'Collector'},{value:'api',label:'API'}]},
 {key:'endpoint',label:'Public HTTPS feed URL',showWhen:{key:'method',values:['api']}},{key:'credentialRef',label:'Credential reference (CREDENTIAL_NAME)',optional:true},
 {key:'cadence',label:'Pull schedule',options:[{value:'manual',label:'On request'},{value:'daily',label:'Daily'}]},
 {key:'localTime',label:'Local start time',type:'time',showWhen:{key:'cadence',values:['daily']}},{key:'timezone',label:'IANA timezone',showWhen:{key:'cadence',values:['daily']}},{key:'enabled',label:'Enable scheduling preference',type:'checkbox'},
]}
afterEach(cleanup)
it('blocks invalid scope and credential references in the visible step and saves only after review',async()=>{
 const user=userEvent.setup(),save=vi.fn<(edit:PlatformEdit,values:Record<string,string|boolean|number>,key:string)=>Promise<void>>(async()=>{})
 render(<PlatformChangeDialog edit={draft} busy={false} error="" save={save} cancel={()=>{}}/>)
 await user.selectOptions(screen.getByRole('combobox',{name:'Data source'}),'oem')
 await user.click(screen.getByRole('button',{name:'Continue to connection'}))
 expect(screen.getByRole('alert')).toHaveTextContent('Choose an OEM family')
 expect(save).not.toHaveBeenCalled()
 await user.selectOptions(screen.getByRole('combobox',{name:'OEM connection'}),'ford_lincoln')
 await user.click(screen.getByRole('button',{name:'Continue to connection'}))
 expect(screen.getByRole('heading',{name:'Connection'})).toHaveFocus()
 await user.click(screen.getByRole('textbox',{name:'Credential reference (CREDENTIAL_NAME)'}))
 await user.paste('DEALER_FEED_KEY')
 await user.click(screen.getByRole('button',{name:'Continue to schedule & review'}))
 expect(screen.getByRole('alert')).toHaveTextContent('beginning CREDENTIAL_')
 await user.clear(screen.getByRole('textbox',{name:'Credential reference (CREDENTIAL_NAME)'}))
 await user.paste('CREDENTIAL_DEALER_FEED_KEY')
 await user.click(screen.getByRole('button',{name:'Continue to schedule & review'}))
 expect(save).not.toHaveBeenCalled()
 expect(screen.getByRole('checkbox',{name:'Enable scheduling preference'})).not.toBeChecked()
 await user.click(screen.getByRole('textbox',{name:'Reason for this change'}))
 await user.paste('Synthetic setup review')
 await user.click(screen.getByRole('button',{name:'Save change'}))
 expect(save).toHaveBeenCalledWith(draft,expect.objectContaining({credentialRef:'CREDENTIAL_DEALER_FEED_KEY',enabled:false,oem:'ford_lincoln'}),expect.any(String))
 const key=save.mock.calls[0][2]
 await user.click(screen.getByRole('button',{name:'Save change'}))
 expect(save.mock.calls[1][2]).toBe(key)
})
it('clears an API URL when switching to collector and repairs invalid hidden manual schedule values',async()=>{
 const save=vi.fn<(edit:PlatformEdit,values:Record<string,string|boolean|number>,key:string)=>Promise<void>>(async()=>{})
 render(<PlatformChangeDialog edit={draft} busy={false} error="" save={save} cancel={()=>{}}/>)
 const form=screen.getByRole('form',{name:draft.title})
 fireEvent.submit(form)
 fireEvent.change(screen.getByRole('combobox',{name:'Connection method'}),{target:{value:'api'}})
 fireEvent.change(screen.getByRole('textbox',{name:'Public HTTPS feed URL'}),{target:{value:'https://feed.example.invalid/data?token=synthetic'}})
 fireEvent.submit(form)
 expect(screen.getByRole('alert')).toHaveTextContent('without credentials, query parameters')
 fireEvent.change(screen.getByRole('combobox',{name:'Connection method'}),{target:{value:'collector'}})
 fireEvent.submit(form)
 fireEvent.change(screen.getByRole('combobox',{name:'Pull schedule'}),{target:{value:'daily'}})
 fireEvent.change(screen.getByLabelText('Local start time'),{target:{value:''}})
 fireEvent.change(screen.getByRole('textbox',{name:'IANA timezone'}),{target:{value:'Invalid/Timezone'}})
 fireEvent.change(screen.getByRole('combobox',{name:'Pull schedule'}),{target:{value:'manual'}})
 expect(within(form).queryByRole('textbox',{name:'IANA timezone'})).not.toBeInTheDocument()
 fireEvent.change(screen.getByRole('textbox',{name:'Reason for this change'}),{target:{value:'Synthetic manual setup'}})
 fireEvent.submit(form)
 expect(save).toHaveBeenCalledWith(draft,expect.objectContaining({endpoint:'',cadence:'manual',localTime:'05:30',timezone:'America/Detroit'}),expect.any(String))
})
it('removes the previous step validation on Back while retaining the server save error',async()=>{
 const user=userEvent.setup(),save=vi.fn(async()=>{})
 render(<PlatformChangeDialog edit={draft} busy={false} error="Synthetic server rejected this change." save={save} cancel={()=>{}}/>)
 await user.click(screen.getByRole('button',{name:'Continue to connection'}))
 await user.type(screen.getByRole('textbox',{name:'Credential reference (CREDENTIAL_NAME)'}),'INVALID_REFERENCE')
 await user.click(screen.getByRole('button',{name:'Continue to schedule & review'}))
 expect(screen.getAllByRole('alert')).toHaveLength(2)
 await user.click(screen.getByRole('button',{name:'Back'}))
 expect(screen.getByRole('heading',{name:'Source & scope'})).toHaveFocus()
 expect(screen.getByRole('alert')).toHaveTextContent('Synthetic server rejected this change.')
 expect(screen.queryByRole('textbox',{name:'Credential reference (CREDENTIAL_NAME)'})).not.toBeInTheDocument()
 expect(screen.queryByText(/Use a credential reference beginning/)).not.toBeInTheDocument()
 expect(save).not.toHaveBeenCalled()
})
it('clears local validation after a corrective source edit without clearing the server error',async()=>{
 const user=userEvent.setup(),save=vi.fn(async()=>{})
 render(<PlatformChangeDialog edit={draft} busy={false} error="Synthetic server rejected this change." save={save} cancel={()=>{}}/>)
 await user.selectOptions(screen.getByRole('combobox',{name:'Data source'}),'oem')
 await user.click(screen.getByRole('button',{name:'Continue to connection'}))
 expect(screen.getAllByRole('alert')).toHaveLength(2)
 await user.selectOptions(screen.getByRole('combobox',{name:'OEM connection'}),'ford_lincoln')
 expect(screen.getByRole('alert')).toHaveTextContent('Synthetic server rejected this change.')
 await user.click(screen.getByRole('button',{name:'Continue to connection'}))
 expect(screen.getByRole('heading',{name:'Connection'})).toHaveFocus()
 expect(save).not.toHaveBeenCalled()
})
it('clears local validation when a provider preset changes the source values',async()=>{
 const user=userEvent.setup(),save=vi.fn(async()=>{})
 render(<PlatformChangeDialog edit={draft} busy={false} error="" save={save} cancel={()=>{}}/>)
 await user.selectOptions(screen.getByRole('combobox',{name:'Data source'}),'oem')
 await user.click(screen.getByRole('button',{name:'Continue to connection'}))
 expect(screen.getByRole('alert')).toHaveTextContent('Choose an OEM family')
 await user.click(screen.getByText('Choose a researched provider'))
 await user.selectOptions(screen.getByRole('combobox',{name:'Provider catalog'}),'vinsolutions-crm')
 expect(screen.queryByRole('alert')).not.toBeInTheDocument()
 expect(screen.getByRole('combobox',{name:'Data source'})).toHaveValue('crm')
 await user.click(screen.getByRole('button',{name:'Continue to connection'}))
 expect(screen.getByRole('heading',{name:'Connection'})).toHaveFocus()
 expect(save).not.toHaveBeenCalled()
})
