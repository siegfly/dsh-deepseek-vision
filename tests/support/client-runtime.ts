/**
 * Whether a Node-runnable official client runtime exists for the test run.
 *
 * The npm-published client packages ship the client runtime ONLY as the
 * browser closure (`lib/client.js`, references `window.__ModuleLoader__` at
 * top level); their `lib/types/client` carries declarations without runnable
 * JS. A Node-runnable form exists when a dsh source checkout provides
 * `src/client/index.ts`, or when an installed fallback is a checkout-built
 * layout with `lib/types/client/index.js` (e.g. this machine's healed
 * junction). On a pure npm install there is none, and the client specs skip
 * themselves with this function as the gate.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { harnessRoot, resolvePackageDir } from '../../scripts/harness-paths.mjs'

export function nodeClientRuntimeAvailable(): boolean {
  const located = harnessRoot()
  if (located === undefined) return false
  const dir = resolvePackageDir('@deepseek-ai/dsh-client-runtime/client')
  if (dir === undefined) return false
  if (located.kind === 'checkout') {
    return existsSync(join(dir, 'src', 'client', 'index.ts'))
  }
  return existsSync(join(dir, 'lib', 'types', 'client', 'index.js'))
}
