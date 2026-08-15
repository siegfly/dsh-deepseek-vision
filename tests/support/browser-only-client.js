/**
 * Import-safe stand-in for `@deepseek-ai/*&#47;client` specifiers on npm-only
 * machines, where the official packages publish the client runtime ONLY as
 * the browser closure (`lib/client.js`, references `window.__ModuleLoader__`
 * at top level) and their `lib/types/client` carries declarations without any
 * runnable JS. The client specs detect that situation and skip themselves
 * (tests/support/client-runtime.ts); this module exists so their top-level
 * imports still collect instead of crashing the suite at load time.
 *
 * Only value imports reach this module (type-only imports are erased), and
 * the plugin's client half has exactly one: createSnapshotStore from
 * @deepseek-ai/dsh-client-runtime/client. The throwing body is never reached
 * because the specs that call it are skipped on npm-only machines; the throw
 * documents the contract loudly if that ever stops being true.
 */

export const createSnapshotStore = () => {
  throw new Error(
    'createSnapshotStore: the official client runtime ships browser-only on npm '
    + '(no Node-runnable client JS). These specs run on machines with a dsh '
    + 'source checkout, and skip themselves otherwise.',
  )
}

export default {}
