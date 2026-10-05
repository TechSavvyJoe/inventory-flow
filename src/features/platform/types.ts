export interface PlatformOwner {id:string;email:string;name:string;enabled:boolean}
export interface PlatformDealership {id:string;groupId:string;name:string;storeKey:string;website:string;enabled:boolean}
export interface PlatformHealth {status:string;message:string;connected?:boolean;reportDate?:string|null;publishedAt?:string|null;releaseStatus?:string|null;employees?:number;activeEmployees?:number;groupManagers?:number}
export interface PlatformGroup {id:string;name:string;status:'setup'|'active'|'suspended';updatedAt:string;dealerships:PlatformDealership[];health:PlatformHealth}
export interface PlatformAudit {id:string;actor:string;entity:string;targetId:string;action:string;reason:string;occurredAt:string}
export interface PlatformOverview {demo?:boolean;owner:PlatformOwner;revision:number;generatedAt:string;groups:PlatformGroup[];owners:PlatformOwner[];audit:PlatformAudit[]}
export interface PlatformMember {id:string;email:string;name:string;role:string;homeStore:string;enabled:boolean}
export interface PlatformMembers {groupId:string;revision:number;members:PlatformMember[];audit:{id:string;actor:string;action:string;reason:string;targetName:string;occurredAt:string}[]}
