export function writeAtomicFile(
  filePath: string,
  contents: string | NodeJS.ArrayBufferView,
  options?: { mode?: number },
): void

export function writeJsonAtomic(filePath: string, value: unknown): void
