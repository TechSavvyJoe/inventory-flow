/**
 * Resolve which queue entry a `/transfers?id=` or `/transfers?vin=` link points
 * at. An id or VIN link with no visible match selects nothing: the transfer is
 * withheld from this role or store, filtered out of this queue view, or gone,
 * and selecting the first queue entry would present another vehicle's move as
 * if it were the requested one.
 */
export function selectRequestedTransfer<T extends { record: { id: string; vin: string } }>(
  entries: readonly T[],
  requestedId: string | null | undefined,
  requestedVin: string | null | undefined,
): T | null {
  if (requestedId) {
    const byId = entries.find(({ record }) => record.id === requestedId)
    if (byId) return byId
  }
  if (requestedVin) {
    return entries.find(({ record }) => record.vin === requestedVin) ?? null
  }
  return requestedId ? null : entries[0] ?? null
}
