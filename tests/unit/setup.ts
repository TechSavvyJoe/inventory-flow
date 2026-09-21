import '@testing-library/jest-dom/vitest'

import { afterEach } from 'vitest'
import { clearWorkspaceMemory } from '../../src/lib/workspace-memory'
afterEach(clearWorkspaceMemory)
