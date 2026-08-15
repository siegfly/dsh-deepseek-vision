/**
 * End-to-end plugin tests over a real Cordis context: registration, catalog
 * and modality claims, the settings-backed live configuration surface, and a
 * full image→description→DeepSeek round trip through ctx.llm.
 */

import { createServer, type Server } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import * as plugin from '../src/index.js'
import { MemorySettings } from './support/memory-settings.js'

const REF = {
  attachmentId: 'img-e2e',
  mediaType: 'image/png',
  bytes: 4,
  width: 2,
  height: 2,
} as ImageAttachmentRef

interface Captured {
  body: unknown
  calls: number
}

async function withServer(
  reply: { status: number; payload: unknown },
  run: (captured: Captured, port: number) => Promise<void>,
): Promise<void> {
  const captured: Captured = { body: undefined, calls: 0 }
  const server: Server = createServer((req, res) => {
    captured.calls += 1
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      captured.body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
      res.writeHead(reply.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(reply.payload))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  try {
    await run(captured, address.port)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

async function drain(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

interface Harness {
  ctx: Context
  dispose: () => Promise<void>
}

async function makeHarness(deepseekPort: number, vlPort: number, config: plugin.Config = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const attachments = {
    readImage: async (r: ImageAttachmentRef) => ({ ref: r, data: new Uint8Array([1, 2, 3]) }),
    saveImage: async () => {
      throw new Error('not implemented')
    },
  } as unknown as AttachmentStore
  ctx.provide('attachments', attachments)
  const fiber = await ctx.plugin(Object.assign(
    (inner: Context) => plugin.apply(inner, config),
    { inject: plugin.inject },
  ))
  return {
    ctx,
    dispose: async () => {
      await fiber.dispose()
    },
  }
}

/**
 * A harness whose settings service is the real SettingsProvider subclass
 * (tests/support/memory-settings.ts), so live snapshots reach the plugin
 * through the REAL register/watch/update machinery.
 */
async function makeSettingsHarness(deepseekPort: number, vlPort: number): Promise<{
  ctx: Context
  settings: MemorySettings
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const attachments = {
    readImage: async (r: ImageAttachmentRef) => ({ ref: r, data: new Uint8Array([1]) }),
  } as unknown as AttachmentStore
  ctx.provide('attachments', attachments)
  // Mounted like upstream (settings.spec.ts:53-57): the provider registers
  // the 'settings' service itself, so it goes through ctx.plugin.
  await ctx.plugin(MemorySettings, { doc: {} })
  const settings = ctx.get('settings') as MemorySettings
  const fiber = await ctx.plugin(Object.assign(
    (inner: Context) => plugin.apply(inner, {
      deepseek: { baseURL: `http://127.0.0.1:${deepseekPort}` },
      vl: { baseURL: `http://127.0.0.1:${vlPort}` },
    }),
    { inject: plugin.inject },
  ))
  // The settings section registers inside apply()'s inject; let it settle so
  // pushExternal's publish reaches the installed watcher.
  await new Promise(resolve => setTimeout(resolve, 0))
  return { ctx, settings, dispose: () => fiber.dispose() }
}

beforeAll(() => {
  // The plugin resolves both keys from the launching environment when no
  // credentials seam is mounted — mirror that in the test environment.
  process.env.DEEPSEEK_API_KEY = 'test-deepseek-key'
  process.env.QWEN_VL_API_KEY = 'test-vl-key'
})

afterAll(() => {
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.QWEN_VL_API_KEY
})

afterEach(() => {
  // Each test owns its servers and context.
})

describe('llm-vl-gateway plugin', () => {
  it('registers the gateway route with image-claiming catalog and exact-model metadata', async () => {
    await withServer({ status: 500, payload: {} }, async (_deepseek, deepseekPort) => {
      await withServer({ status: 500, payload: {} }, async (_vl, vlPort) => {
        const harness = await makeHarness(deepseekPort, vlPort)
        try {
          const providers = harness.ctx.llm.listProviders()
          expect(providers).toEqual([{ id: 'deepseek-vision', name: 'DeepSeek + Vision' }])
          const models = await harness.ctx.llm.listModels('deepseek-vision')
          expect(models.map(model => model.id)).toContain('deepseek-v4-flash')
          for (const model of models) expect(model.inputModalities).toEqual(['text', 'image'])
          const info = await harness.ctx.llm.resolveModelInfo('deepseek-vision', 'deepseek-v4-pro')
          expect(info.inputModalities).toEqual(['text', 'image'])
          expect(info.context?.contextWindow).toBeGreaterThan(0)
        } finally {
          await harness.dispose()
        }
      })
    })
  })

  it('routes an image request through the VL model then the text-only DeepSeek wire', async () => {
    await withServer(
      { status: 500, payload: { error: { message: 'capture only' } } },
      async (deepseek, deepseekPort) => {
        await withServer(
          {
            status: 200,
            payload: { choices: [{ message: { content: 'an entity-relationship diagram' } }] },
          },
          async (vl, vlPort) => {
            const harness = await makeHarness(deepseekPort, vlPort, {
              deepseek: { baseURL: `http://127.0.0.1:${deepseekPort}` },
              vl: { baseURL: `http://127.0.0.1:${vlPort}` },
            })
            try {
              const chunks = await drain(harness.ctx.llm.stream({
                provider: 'deepseek-vision',
                model: 'deepseek-v4-flash',
                messages: [{
                  role: 'user',
                  content: [{ type: 'text', text: 'explain this' }, { type: 'image', attachment: REF }],
                  source: { kind: 'user' },
                }],
              }))
              expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER' } } })
              expect(vl.calls).toBe(1)
              const deepseekWire = JSON.stringify(deepseek.body)
              expect(deepseekWire).toContain('an entity-relationship diagram')
              expect(deepseekWire).not.toContain('image_url')
              expect(deepseekWire).not.toContain('data:image')
            } finally {
              await harness.dispose()
            }
          },
        )
      },
    )
  })

  it('describes one unique image once across repeated requests (cache)', async () => {
    await withServer(
      { status: 500, payload: { error: { message: 'capture only' } } },
      async (deepseek, deepseekPort) => {
        await withServer(
          { status: 200, payload: { choices: [{ message: { content: 'the same screenshot' } }] } },
          async (vl, vlPort) => {
            const harness = await makeHarness(deepseekPort, vlPort, {
              deepseek: { baseURL: `http://127.0.0.1:${deepseekPort}` },
              vl: { baseURL: `http://127.0.0.1:${vlPort}` },
            })
            const request = () => ({
              provider: 'deepseek-vision',
              model: 'deepseek-v4-flash',
              messages: [{
                role: 'user',
                content: [{ type: 'text', text: 'again' }, { type: 'image', attachment: REF }],
                source: { kind: 'user' },
              }],
            })
            try {
              await drain(harness.ctx.llm.stream(request()))
              await drain(harness.ctx.llm.stream(request()))
              expect(vl.calls).toBe(1)
              expect(deepseek.calls).toBe(2)
            } finally {
              await harness.dispose()
            }
          },
        )
      },
    )
  })

  it('fails closed with the VL failure code when the description leg fails', async () => {
    await withServer(
      { status: 500, payload: { error: { message: 'capture only' } } },
      async (deepseek, deepseekPort) => {
        await withServer(
          { status: 401, payload: { error: { message: 'bad vl key' } } },
          async (_vl, vlPort) => {
            const harness = await makeHarness(deepseekPort, vlPort, {
              deepseek: { baseURL: `http://127.0.0.1:${deepseekPort}` },
              vl: { baseURL: `http://127.0.0.1:${vlPort}` },
            })
            try {
              const chunks = await drain(harness.ctx.llm.stream({
                provider: 'deepseek-vision',
                model: 'deepseek-v4-flash',
                messages: [{
                  role: 'user',
                  content: [{ type: 'image', attachment: REF }],
                  source: { kind: 'user' },
                }],
              }))
              expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH' } } })
              // Fail-closed: the DeepSeek wire was never reached with an image.
              expect(deepseek.calls).toBe(0)
            } finally {
              await harness.dispose()
            }
          },
        )
      },
    )
  })

  it('rejects a duplicate provider route loudly at registration', async () => {
    await withServer({ status: 500, payload: {} }, async (_deepseek, deepseekPort) => {
      await withServer({ status: 500, payload: {} }, async (_vl, vlPort) => {
        const harness = await makeHarness(deepseekPort, vlPort)
        try {
          const intruder = new class extends LlmAdapter {
            async *stream(): AsyncIterable<StreamChunk> {
              yield { type: 'finish', reason: { kind: 'stop' } }
            }
          }()
          expect(() => harness.ctx.llm.registerAdapter(['deepseek-vision'], intruder))
            .toThrow(/already registered/)
        } finally {
          await harness.dispose()
        }
      })
    })
  })

  it('re-registers the route and directory when a live settings section renames the provider, and keeps the old set when a swap is refused', async () => {
    await withServer({ status: 500, payload: {} }, async (_deepseek, deepseekPort) => {
      await withServer({ status: 500, payload: {} }, async (_vl, vlPort) => {
        const watchers: (() => void)[] = []
        let section: Record<string, unknown> = {}
        const settings = {
          register: () => ({
            get: () => section,
            watch: (notify: () => void) => {
              watchers.push(notify)
              return () => {}
            },
          }),
        }
        const ctx = new Context()
        await ctx.plugin(LlmRuntime)
        const attachments = {
          readImage: async (r: ImageAttachmentRef) => ({ ref: r, data: new Uint8Array([1]) }),
        } as unknown as AttachmentStore
        ctx.provide('attachments', attachments)
        ctx.provide('settings', settings)
        const fiber = await ctx.plugin(Object.assign(
          (inner: Context) => plugin.apply(inner, {
            deepseek: { baseURL: `http://127.0.0.1:${deepseekPort}` },
            vl: { baseURL: `http://127.0.0.1:${vlPort}` },
          }),
          { inject: plugin.inject },
        ))
        try {
          expect(ctx.llm.listProviders()).toEqual([{ id: 'deepseek-vision', name: 'DeepSeek + Vision' }])

          // A live section rename re-registers both registries without a restart.
          section = { provider: 'renamed-route', displayName: 'Renamed' }
          for (const notify of watchers) notify()
          expect(ctx.llm.listProviders()).toEqual([{ id: 'renamed-route', name: 'Renamed' }])
          expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).toEqual(['renamed-route'])

          // A conflicting rename is refused and contained: the previous route
          // AND directory keep serving (the directory never advances past a
          // route the adapter could not take).
          const intruder = new class extends LlmAdapter {
            async *stream(): AsyncIterable<StreamChunk> {
              yield { type: 'finish', reason: { kind: 'stop' } }
            }
          }()
          ctx.llm.registerAdapter(['taken'], intruder)
          section = { provider: 'taken', displayName: 'Taken' }
          for (const notify of watchers) notify()
          expect(ctx.llm.listProviders().map(provider => provider.id).sort()).toEqual(['renamed-route', 'taken'])
          expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).toEqual(['renamed-route'])
        } finally {
          await fiber.dispose()
        }
      })
    })
  })

  it('keeps serving the last good DeepSeek configuration after an invalid live settings snapshot', async () => {
    await withServer({ status: 500, payload: {} }, async (deepseek, deepseekPort) => {
      await withServer({ status: 500, payload: {} }, async (_vl, vlPort) => {
        const harness = await makeSettingsHarness(deepseekPort, vlPort)
        try {
          const errors = vi.spyOn(harness.ctx.logger, 'error')
          // Schema-valid, resolver-invalid: thinking "disabled" forbids a
          // non-off reasoning effort, but both pass the settings schema —
          // only resolveAdapterOptions can catch it.
          harness.settings.pushExternal({
            'llm-vl-gateway': { deepseek: { thinking: 'disabled', reasoningEffort: 'high' } },
          })
          await drain(harness.ctx.llm.stream({
            provider: 'deepseek-vision',
            model: 'deepseek-v4-flash',
            messages: [{ role: 'user', content: [{ type: 'text', text: 'plain question' }], source: { kind: 'user' } }],
          }))
          // The rejected snapshot contributed nothing: the request still went
          // to the original mock endpoint (last good configuration), and the
          // refusal was diagnosed once.
          expect(deepseek.calls).toBe(1)
          expect(errors).toHaveBeenCalledWith(expect.stringContaining('keeping the last good DeepSeek configuration'))
        } finally {
          await harness.dispose()
        }
      })
    })
  })

  it('rolls the route back when a live rename collides with a foreign directory entry, and a later good rename re-applies', async () => {
    await withServer({ status: 500, payload: {} }, async (_deepseek, deepseekPort) => {
      await withServer({ status: 500, payload: {} }, async (_vl, vlPort) => {
        const harness = await makeSettingsHarness(deepseekPort, vlPort)
        try {
          const errors = vi.spyOn(harness.ctx.logger, 'error')
          // A foreign plugin owns the "taken" DIRECTORY entry (no adapter), so
          // the rename's adapter swap succeeds and only the directory swap
          // refuses — the plugin must roll the route back.
          harness.ctx.llm.registerConfigurableProviders([{
            provider: 'taken',
            displayName: 'Taken',
            settingsNs: settingsNamespace('foreign'),
            settingsPath: ['x'],
          }])
          harness.settings.pushExternal({ 'llm-vl-gateway': { provider: 'taken', displayName: 'Taken' } })
          // The watch notification delivers asynchronously; let the refused
          // swap (and its rollback) run before asserting.
          await new Promise(resolve => setTimeout(resolve, 0))
          expect(harness.ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek-vision'])
          expect(harness.ctx.llm.listConfigurableProviders().map(entry => entry.provider).sort())
            .toEqual(['deepseek-vision', 'taken'])
          expect(errors).toHaveBeenCalledWith(expect.stringContaining('keeping the previously registered route and directory'))

          // The facts only advanced after BOTH swaps succeeded, so a later
          // working rename re-applies cleanly.
          harness.settings.pushExternal({ 'llm-vl-gateway': { provider: 'renamed-route', displayName: 'Renamed' } })
          await new Promise(resolve => setTimeout(resolve, 0))
          expect(harness.ctx.llm.listProviders().map(provider => provider.id)).toEqual(['renamed-route'])
          expect(harness.ctx.llm.listConfigurableProviders().map(entry => entry.provider).sort())
            .toEqual(['renamed-route', 'taken'])
        } finally {
          await harness.dispose()
        }
      })
    })
  })
})
