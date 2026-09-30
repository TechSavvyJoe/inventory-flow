export function createTakeHomePdf(models: Array<{ vin: string; [key: string]: unknown }>, title: string, options?: { fetcher?: typeof fetch; now?: Date; base?: string }): Promise<Blob>
