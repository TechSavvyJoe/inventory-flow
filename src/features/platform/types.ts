export interface PlatformOwner {id:string;email:string;name:string;enabled:boolean}
export interface PlatformDealership {id:string;groupId:string;name:string;storeKey:string;website:string;enabled:boolean}
export interface PlatformStoredCoverage {
 basis:'stored_publication'; reportDate:string|null; publishedAt:string|null;
 counts:Partial<Record<'vehicleCount'|'publicRowCount'|'dealerMailRowCount'|'dealerMailVinReconciledCount'|'dealerMailVinReviewCount'|'activeInventoryCount'|'resourceRecordCount'|'fordInvoiceRecordCount'|'fordOasisRecordCount'|'warrantyCheckRecordCount'|'warningCount',number>>;
 stores:{storeKey:string;publicCount?:number;crmCount?:number;activeInventoryCount?:number}[];
}
export interface PlatformHealth {status:string;message:string;connected?:boolean;reportDate?:string|null;publishedAt?:string|null;releaseStatus?:string|null;employees?:number;activeEmployees?:number;groupManagers?:number;coverage?:PlatformStoredCoverage}
export interface PlatformGroup {id:string;name:string;status:'setup'|'active'|'suspended';updatedAt:string;dealerships:PlatformDealership[];health:PlatformHealth;appUrl?:string}
export interface PlatformAudit {id:string;actor:string;entity:string;targetId:string;action:string;reason:string;occurredAt:string}
export interface PlatformOverview {demo?:boolean;owner:PlatformOwner;revision:number;generatedAt:string;groups:PlatformGroup[];owners:PlatformOwner[];audit:PlatformAudit[]}
export interface PlatformMember {id:string;email:string;name:string;role:string;homeStore:string;enabled:boolean}
export interface PlatformMembers {groupId:string;revision:number;members:PlatformMember[];audit:{id:string;actor:string;action:string;reason:string;targetName:string;occurredAt:string}[]}
export interface PlatformField {key:string;label:string;section?:string;type?:'email'|'checkbox'|'time';options?:{value:string;label:string}[];readOnly?:boolean;optional?:boolean;showWhen?:{key:string;values:string[]}}
export interface PlatformEdit {title:string;path:string;values:Record<string,string|boolean|number>;fields:PlatformField[];help?:string;kind?:'source';afterSave?:(id:string)=>void}
export type PlatformPayload = Record<string,string|boolean|number|string[]>
export type PlatformRequest = <T>(path:string,body?:PlatformPayload,key?:string)=>Promise<T>
export interface PlatformConnection {id:string;groupId:string;dealershipId:string;name:string;provider:string;vendor?:string;oem?:string;method:'collector'|'api'|'file';endpoint:string;credentialRef:string;enabled:boolean;cadence:'manual'|'daily'|'hourly';localTime:string;timezone:string;updatedAt:string;verification:'not_verified';schedule?:{nextLocal?:string;due?:boolean;invalid?:boolean;checkedAt:string|null;outcome:string|null}}
export interface PlatformPull {id:string;connectionId:string;state:'queued'|'running'|'completed'|'failed'|'cancelled'|'reconciliation_required';kind?:'manual'|'scheduled';scheduledSlot?:string|null;requestedBy:string;createdAt:string;updatedAt:string}
export interface PlatformCollector {id:string;groupId:string;name:string;accessClientId:string;adapterId:string;adapterVersion:string;profileId:string;profileSha256:string;enabled:boolean;connected:boolean;generation:number;lastSeenAt:string|null;revokedAt?:string|null;status?:string;dealershipIds:string[];connectionIds:string[];scopeLabel:string}
export interface PlatformCollectorAttempt {id:string;requestId:string;collectorId:string;stage:string;createdAt:string;leaseUntil?:string;capturedAt?:string|null;completedAt?:string|null;failureCode?:string|null;bundleSha256?:string|null;reportDate?:string|null;publication?:{status:string;verifiedAt?:string;bundleSha256?:string;vehicleCount?:number}}
export interface PlatformCollectorsData {groupId:string;revision:number;executionEnabled:boolean;collectors:PlatformCollector[];attempts:PlatformCollectorAttempt[]}
export interface PlatformConnections {groupId:string;revision:number;connections:PlatformConnection[];requests:PlatformPull[];scheduler?:{enabled:boolean;lastTick:string|null;checked:number;queued:number;waiting:number;failed:number};execution:{connected:boolean;message:string}}
export interface PlatformAuditDetail extends PlatformAudit {changes:{field:string;before:string|boolean|null;after:string|boolean|null}[]}
