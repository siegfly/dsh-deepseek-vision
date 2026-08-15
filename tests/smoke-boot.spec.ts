/**
 * Real-boot smoke: boots the OFFICIAL dsh launcher (npm-published fallback or
 * the checkout's built bin) against a temp DSH_HOME where this plugin is
 * installed in a profile, then exercises the two surfaces:
 *
 * - headless: one task turn through the gateway provider route against two
 *   local mock endpoints — installation, bundle mounting, settings.yaml
 *   resolution, credential env layer, and the DeepSeek wire, end to end.
 * - web: the browser-UI server boots with the plugin bundle mounted and the
 *   client scan picking up the dsh.client declaration, then serves HTTP.
 *
 * This closes the gap between "install-profile succeeded" and "the running
 * dsh actually registered the provider and served". Text-only on purpose:
 * image input needs the agent tool loop plus a real image file, a later
 * second stage.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { harnessRoot } from '../scripts/harness-paths.mjs'
import { PLUGIN_PACKAGE_NAME } from '../scripts/profile-layer.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const MARKER = 'gateway-smoke-ok'
const MOCK_DS_API_KEY = 'sk-mock-ds'
const MOCK_VL_API_KEY = 'sk-mock-vl'

interface ChatServer {
  url: string
  close: () => Promise<void>
  requests: Array<{ path?: string; authorization?: string; body?: unknown }>
}

/** One OpenAI-compatible /chat/completions stub per leg. */
async function startChatServer(kind: 'deepseek' | 'vl'): Promise<ChatServer> {
  const requests: ChatServer['requests'] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        path: req.url,
        authorization: req.headers.authorization,
        body: chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined,
      })
      if (kind === 'vl') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: 'a smoke description' } }] }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: {"choices":[{"delta":{"role":"assistant","content":"${MARKER}"},"finish_reason":"stop"}]}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
    requests,
  }
}

/** The launcher invocation for the resolved harness source. */
function launcherInvocation() {
  const located = harnessRoot()
  if (located === undefined) {
    throw new Error('dsh-deepseek-vision smoke: no harness source resolved (see scripts/harness-paths.mjs)')
  }
  if (located.kind === 'installed') {
    return { args: [join(located.root, '@deepseek-ai', 'dsh', 'lib', 'bin.js')], cwd: undefined }
  }
  const built = join(located.root, 'apps', 'cli', 'lib', 'bin.js')
  if (existsSync(built)) return { args: [built], cwd: undefined }
  // Built bin absent (unbuilt checkout): run the source through the checkout's
  // own tsx, the same way the harness package scripts do.
  return { args: ['--import', 'tsx/esm', join(located.root, 'apps', 'cli', 'src', 'bin.ts')], cwd: located.root }
}

/** A clean launcher environment: temp home, no ambient keys, no telemetry. */
function launcherEnv(dshHome: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of ['DEEPSEEK_API_KEY', 'QWEN_VL_API_KEY', 'DEEPSEEK_BASE_URL']) delete env[key]
  env.DSH_HOME = dshHome
  env.DSH_TELEMETRY_DISABLED = '1'
  env.MOCK_DS_API_KEY = MOCK_DS_API_KEY
  env.MOCK_VL_API_KEY = MOCK_VL_API_KEY
  return env
}

interface Launched {
  child: ChildProcess
  stdout: () => string
  stderr: () => string
  closed: Promise<number | null>
}

/** Spawn the launcher; stdout/stderr accumulate until read. */
function launch(dshHome: string, launcherArgs: string[], cwd: string | undefined, appArgs: string[]): Launched {
  const child = spawn(process.execPath, [...launcherArgs, ...appArgs], {
    cwd,
    env: launcherEnv(dshHome),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const closed = new Promise<number | null>((resolve) => {
    child.on('close', code => resolve(code))
  })
  return { child, stdout: () => stdout, stderr: () => stderr, closed }
}

/** Stage one profile: official manifest/patch/workspace shape + the plugin bundle. */
function stageProfile(home: string, name: string, bundles: string[]): void {
  const profileDir = join(home, 'profiles', name)
  const pluginDir = join(profileDir, 'node_modules', PLUGIN_PACKAGE_NAME)
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  cpSync(join(repoRoot, 'package.json'), join(pluginDir, 'package.json'))
  cpSync(join(repoRoot, 'cordis.patch.yml'), join(pluginDir, 'cordis.patch.yml'))
  cpSync(join(repoRoot, 'lib'), join(pluginDir, 'lib'), { recursive: true })
}

/** Wait until the accumulated stdout carries the `dsh web:` URL line. */
function waitForWebUrl(stdout: () => string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const match = /dsh web: (http:\/\/\S+)/.exec(stdout())
      if (match !== null) {
        clearInterval(timer)
        resolve(match[1]!)
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`dsh web never printed its URL; stdout so far: ${JSON.stringify(stdout())}`))
      }
    }, 250)
  })
}

describe('real dsh boot smoke', () => {
  const headlessHome = mkdtempSync(join(tmpdir(), 'dsh-smoke-'))
  const servers: ChatServer[] = []

  afterAll(async () => {
    rmSync(headlessHome, { recursive: true, force: true })
    for (const server of servers) await server.close()
  })

  it('boots the official launcher, registers the gateway route, and completes one task turn through the mock DeepSeek wire', async () => {
    const [deepseek, vl] = await Promise.all([startChatServer('deepseek'), startChatServer('vl')])
    servers.push(deepseek, vl)

    // Headless profile layout, hand-placed exactly like the upstream built-bin
    // e2e: manifest + empty patch layer + pnpm settings + the plugin bundle.
    stageProfile(headlessHome, 'headless', [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', PLUGIN_PACKAGE_NAME,
    ])

    // Select the gateway route as the headless default model and point both
    // legs at the local mocks; keys come from the launch environment.
    writeFileSync(join(headlessHome, 'settings.yaml'), [
      'agent-default-model:',
      '  provider: deepseek-vision',
      '  model: deepseek-v4-flash',
      'llm-vl-gateway:',
      '  deepseek:',
      `    baseURL: ${deepseek.url}`,
      '    apiKeyEnv: MOCK_DS_API_KEY',
      '  vl:',
      `    baseURL: ${vl.url}`,
      '    apiKeyEnv: MOCK_VL_API_KEY',
      '',
    ].join('\n'))

    const { args, cwd } = launcherInvocation()
    const launched = launch(headlessHome, args, cwd, ['--profile', 'headless', 'reply with the gateway marker'])
    const killTimer = setTimeout(() => launched.child.kill('SIGKILL'), 90_000)
    const code = await launched.closed
    clearTimeout(killTimer)

    // The run must have completed cleanly and printed exactly the mock's
    // answer: the gateway route was registered, selected, and served.
    expect(launched.stderr()).toBe('')
    expect(code).toBe(0)
    expect(launched.stdout()).toBe(`${MARKER}\n`)

    // The task turn went through the gateway route with the mock key; the
    // official composition may add one more gateway call (session title
    // generation), which must also carry the mock key. The VL leg never
    // fired (text-only run).
    const taskRequest = deepseek.requests.find(request =>
      JSON.stringify(request.body).includes('reply with the gateway marker'))
    expect(taskRequest).toBeDefined()
    expect(taskRequest!.authorization).toBe(`Bearer ${MOCK_DS_API_KEY}`)
    expect(deepseek.requests.every(request => request.authorization === `Bearer ${MOCK_DS_API_KEY}`)).toBe(true)
    expect(vl.requests).toHaveLength(0)
  }, 120_000)

  it('boots the web profile with the plugin bundle mounted and serves the browser UI', async () => {
    const webHome = mkdtempSync(join(tmpdir(), 'dsh-smoke-web-'))
    // Stage BEFORE launching: a missing manifest would make the launcher
    // auto-init the official template profile (without this plugin), which
    // would boot fine and prove nothing.
    stageProfile(webHome, 'web', [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PLUGIN_PACKAGE_NAME,
    ])
    const { args, cwd } = launcherInvocation()
    const launched = launch(webHome, args, cwd, ['--profile', 'web', '--port', '0'])
    const killTimer = setTimeout(() => launched.child.kill('SIGKILL'), 90_000)
    try {
      // The web bundle parses the profile layers (including this plugin's
      // bundle patch) before it binds; a broken layer crashes instead of
      // printing the URL.
      const url = await waitForWebUrl(launched.stdout, 60_000)
      const response = await fetch(url)
      expect(response.status).toBe(200)
    } finally {
      clearTimeout(killTimer)
      launched.child.kill('SIGKILL')
      await launched.closed
      rmSync(webHome, { recursive: true, force: true })
    }
  }, 120_000)
})
