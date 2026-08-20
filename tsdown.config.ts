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

const ID = 'dsh-deepseek-vision'

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

/**
 * Build-time mirror of the official bundle purity gate
 * (`packages/client/tsdown.client.ts`): platform seed entries stay external,
 * inline-safe wire/type layers and vendored libraries inline, and every other
 * `@deepseek-ai/*` VALUE import is a build error — a cross-plugin value import
 * either inlines a duplicate runtime instance or requires a specifier the
 * frozen module table cannot answer. Type-only imports are erased by tsc
 * before this bundle is built and never reach the gate.
 */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|file-reference|session|llm|tools|brand)(\/|$)/
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

export default defineConfig({
  entry: { client: 'lib/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    // Platform modules resolve from the loader module table at runtime.
    neverBundle: EXTERNALS,
    // Anything not served by the module table must inline: a require() the
    // table cannot answer is a guaranteed runtime throw.
    alwaysBundle: (id: string) => !EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
    'import.meta.env.MODE': JSON.stringify(NODE_ENV),
    'import.meta.env': JSON.stringify({ MODE: NODE_ENV }),
  },
  plugins: [{
    // Bundle purity gate (build-time mirror of the module-edge rules):
    // platform seed entries stay external, inline-safe wire layers inline,
    // and every other @deepseek-ai value import is a build error.
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (EXTERNALS.includes(source)) return null // platform module: external wins
      if (VENDORED_LIBRARY.test(source)) return null // vendored library: inline, no shared identity
      if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // wire contribution: inline is the point
      throw new Error(
        `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS), an inline-safe wire layer, or a generated /remote contribution — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
      )
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
