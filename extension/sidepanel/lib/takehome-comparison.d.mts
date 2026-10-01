export interface ComparisonCell { lines:string[]; link?:string }
export interface ComparisonRow { kind:string; label:string; top:number; height:number; size:number; lineHeight:number; bold:boolean; fontWeight:number; labelLines:string[]; labelSize:number; labelHeight:number; cells:ComparisonCell[] }
export interface ComparisonVehicle { vin:string; name:string; stockNumber:string; storeName:string; storeSite:string; logo:{src:string;alt?:string;wide?:boolean}|null; photoSrc:string|null; listingUrl:string|null }
export interface ComparisonPage { index:number; continued:boolean; headerTitle:string; headerStore:string; headerSite:string; footerDisclaimer:string; footerPage:string; vehicles:ComparisonVehicle[]; columns:Array<{x:number;width:number}>; rows:ComparisonRow[] }
export interface ComparisonPlan { title:string; width:number; height:number; margin:number; pages:ComparisonPage[] }
export const COMPARISON_SPECS:ReadonlyArray<readonly [string,string]>
export function comparisonGroups(count:number):number[]
export function comparisonFacts(model:any):Array<{kind:string;label:string;value:string}>
export function createComparisonPlan(models:any[], options:{wrap:(value:string,width:number,size:number,bold:boolean)=>string[];safeLink?:(value:unknown)=>string|null;photoSources?:Map<string,string>;logoSources?:Map<string,ComparisonVehicle['logo']>}):ComparisonPlan
