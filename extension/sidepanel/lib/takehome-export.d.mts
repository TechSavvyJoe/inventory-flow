export function downloadTakeHomePdf(pdf: Blob, title: string): string
export function shareTakeHomePdf(options: { pdf: Blob; title: string }): Promise<'shared' | 'cancelled' | 'saved'>
