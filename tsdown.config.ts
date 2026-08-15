/**
 * Client-face build for the out-of-tree plugin. Replicates the behavior of the
 * official `packages/client/tsdown.client.ts` preset (which is not published):
 *
 * - CJS closure-factory artifact calling `window.__ModuleLoader__.load({ id,
 *   factory })` — the exact handoff the dsh client module table expects;
 * - externals = the client platform module list (react, slots, runtime/client,
 *   …), resolved at runtime from the loader module table — never bundled;
 * - everything else inlines (self-contained bundle, no node_modules at load);
 * - the entry is the tsc-emitted `lib/client/index.js` (types ship from
 *   lib/client/*.d.ts via the same tsc pass).
 */

import { defineConfig } from 'tsdown'

const ID = 'dsh-vl-gateway'

/** Client platform modules (mirror of the official PLATFORM_MODULES + store exemption). */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

const NODE_ENV = process.env.NODE_ENV ?? 'production'

export default defineConfig({
  entry: { client: 'lib/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: EXTERNALS,
  define: {
    'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
    'import.meta.env.MODE': JSON.stringify(NODE_ENV),
    'import.meta.env': JSON.stringify({ MODE: NODE_ENV }),
  },
  // Anything not served by the module table must inline: a require() the
  // table cannot answer is a guaranteed runtime throw.
  noExternal: (id: string) => (EXTERNALS.includes(id) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
