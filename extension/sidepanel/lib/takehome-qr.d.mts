export interface ListingQr { size:number; modules:boolean[][]; dataUrl:string }
export function getListingQr(value:unknown):ListingQr | null
