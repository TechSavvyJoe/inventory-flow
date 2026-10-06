import type { PlatformEdit, PlatformGroup } from './types'
export const ROLES = {sales:'Salesperson',manager:'Store manager',group_manager:'Group manager',coordinator:'Coordinator',porter:'Porter',driver:'Driver'}
export const HEALTH_LABEL:Record<string,string>={current:'Current publication',stale:'Publication overdue',not_connected:'Not connected',no_release:'No publication',needs_review:'Review publication',unavailable:'Connection unavailable'}
export const PROVIDERS:Record<string,string>={public_inventory:'Public inventory',dealermail:'DealerMail',vauto:'vAuto',autocheck:'AutoCheck',carfax:'CARFAX',crm:'Other CRM',equipment:'Other equipment provider',oem:'OEM portal / evidence',dms:'DMS',other:'Other authorized source'}
export const METHODS={collector:'Dealership collector',api:'Direct API',file:'File feed'}
export function groupEdit(revision:number,item?:PlatformGroup):PlatformEdit {
 return {title:item?'Edit group':'Add dealership group',path:'/groups',values:{...(item?{id:item.id}:{}),name:item?.name??'',status:item?.status??'setup',expectedRevision:revision},fields:[{key:'name',label:'Group name'},{key:'status',label:'Account state',options:(item?['setup','active','suspended']:['setup']).map(value=>({value,label:{setup:'Setup',active:'Active',suspended:'Suspended'}[value]!}))}],help:'Suspension blocks employee access and publishing on deployments connected to the tenant gate. It does not stop source collectors or Windows tasks.'}
}
export function readiness(group:PlatformGroup) {return [{label:'Isolated database verified',ready:!!group.health.connected},{label:'Dealership registered',ready:group.dealerships.some(item=>item.enabled)},{label:'Group manager enabled',ready:(group.health.groupManagers??0)>0},{label:'Account active',ready:group.status==='active'}]}

export const OEMS:Record<string,string>={not_applicable:'Not OEM-specific',ford_lincoln:'Ford / Lincoln',gm:'General Motors',stellantis:'Stellantis',toyota_lexus:'Toyota / Lexus',honda_acura:'Honda / Acura',hyundai_kia:'Hyundai / Kia',volkswagen_audi:'Volkswagen / Audi',bmw:'BMW',mercedes_benz:'Mercedes-Benz',other:'Other OEM'}
