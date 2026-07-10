import type { NapClient } from '../../internal/client/src'
import { TEST_USER_ID as _TEST_USER_ID, createClient } from './helpers'

// CP lifecycle and DB seeding happen in ./global-setup.ts (vitest globalSetup).
// This module only exposes shared state imported by individual test files.

export const client: NapClient = createClient()
export const TEST_USER_ID = _TEST_USER_ID
