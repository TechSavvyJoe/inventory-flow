import * as repository from './database.mjs'
import { createInventoryServiceCore } from './service-core.mjs'

/** Keep the local SQLite API stable while the core accepts other storage adapters. */
export function createInventoryService(options) {
  return createInventoryServiceCore({ ...options, repository })
}

export { serviceInternals } from './service-core.mjs'
