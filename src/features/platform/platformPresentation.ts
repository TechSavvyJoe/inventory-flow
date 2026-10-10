import type { PlatformEdit, PlatformGroup } from './types'
import { verifiedApplicationUrl } from '../../lib/verified-application-url'
export const ROLES = {sales:'Salesperson',manager:'Store manager',group_manager:'Group manager',coordinator:'Coordinator',porter:'Porter',driver:'Driver'}
export const HEALTH_LABEL:Record<string,string>={current:'Current publication',stale:'Publication overdue',not_connected:'Not connected',no_release:'No publication',needs_review:'Review publication',unavailable:'Connection unavailable'}
export const PROVIDERS:Record<string,string>={public_inventory:'Public inventory',dealermail:'DealerMail',vauto:'vAuto',autocheck:'AutoCheck',carfax:'CARFAX',crm:'CRM',equipment:'Factory equipment & enrichment',oem:'OEM portal / evidence',dms:'DMS',other:'Inventory & other authorized sources'}
export const METHODS={collector:'Dealership collector',api:'Direct API',file:'File feed'}
export function groupEdit(revision:number,item?:PlatformGroup):PlatformEdit {
 return {title:item?'Edit group':'Add dealership group',path:'/groups',values:{...(item?{id:item.id}:{}),name:item?.name??'',status:item?.status??'setup',expectedRevision:revision},fields:[{key:'name',label:'Group name'},{key:'status',label:'Account state',options:(item?['setup','active','suspended']:['setup']).map(value=>({value,label:{setup:'Setup',active:'Active',suspended:'Suspended'}[value]!}))}],help:'Suspension blocks employee access and publishing on deployments connected to the tenant gate. It does not stop source collectors or Windows tasks.'}
}
export function readiness(group:PlatformGroup) {return [
 {key:'database',label:'Isolated database identity',ready:group.health.connected===true,detail:group.health.connected===true?'Verified for this dealership group.':'Provision the isolated deployment and database binding outside this workspace.'},
 {key:'dealerships',label:'Dealership registered',ready:group.dealerships.some(item=>item.enabled),detail:group.dealerships.some(item=>item.enabled)?`${group.dealerships.filter(item=>item.enabled).length} dealerships accept employee assignments.`:'Register an enabled dealership before assigning employees or configuring its data.'},
 {key:'manager',label:'Group manager enabled',ready:(group.health.groupManagers??0)>0,detail:group.health.groupManagers===undefined?'Employee access has not been reported.':`${group.health.groupManagers} enabled group managers.`},
 {key:'account',label:'Account active',ready:group.status==='active',detail:group.status==='active'?'Account access is enabled; data activation is assessed separately.':group.status==='suspended'?'Employee access and publishing are suspended on connected deployments.':'Account is in setup; review its requirements before activation.'},
]}
export function nextAccountAction(group:PlatformGroup) {
 const missing=readiness(group).find(item=>!item.ready)
 return missing?{label:missing.key==='account'?(group.status==='suspended'?'Account suspended':'Account in setup'):`Required: ${missing.label}`,detail:missing.key==='database'?'External provisioning':missing.key==='dealerships'?'Register dealership':missing.key==='manager'?'Review employee access':'Review account state'}:{label:'Account setup complete',detail:group.health.status==='current'?'Review data activation':'Review publication'}
}
export function groupAppHref(group:PlatformGroup) {
 return group.status==='active'&&group.health.connected===true?verifiedApplicationUrl(group.appUrl,'/inventory'):undefined
}

export const OEMS:Record<string,string>={not_applicable:'Not OEM-specific',ford_lincoln:'Ford / Lincoln',gm:'General Motors',stellantis:'Stellantis',toyota_lexus:'Toyota / Lexus',honda_acura:'Honda / Acura',hyundai_kia:'Hyundai / Kia',volkswagen_audi:'Volkswagen / Audi',bmw:'BMW',mercedes_benz:'Mercedes-Benz',other:'Other OEM'}
