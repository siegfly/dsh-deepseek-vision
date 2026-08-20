/**
 * Credentials-seam tests: the plugin resolves both legs' API keys through
 * the REAL credentials service when one is mounted (the web Models page
 * writes there), through the launch environment otherwise — and fails with
 * stable codes when neither can produce a usable key.
 */

import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import * as plugin from '../src/index.js'

const REF = {
  attachmentId: 'img-seam',
  mediaType: 'image/png',
  bytes: 4,
  width: 2,
  height: 2,
} as ImageAttachmentRef

interface Captured {
  authorization?: string
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
    captured.authorization = req.headers.authorization
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

function imageRequest(): GenerateOptions {
  return {
    provider: 'deepseek-vision',
    model: 'deepseek-v4-flash',
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'explain this' }, { type: 'image', attachment: REF }],
      source: { kind: 'user' },
    }],
  }
}

async function makeHarness(
  deepseekPort: number,
  vlPort: number,
  credentials?: { path: string },
): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
  if (credentials !== undefined) {
    await ctx.plugin(LocalCredentialProvider, { path: credentials.path, watch: false })
  }
  await ctx.plugin(LlmRuntime)
  const attachments = {
    readImage: async (r: ImageAttachmentRef) => ({ ref: r, data: new Uint8Array([1, 2, 3]) }),
  } as unknown as AttachmentStore
  ctx.provide('attachments', attachments)
  const fiber = await ctx.plugin(Object.assign(
    (inner: Context) => plugin.apply(inner, {
      deepseek: { baseURL: `http://127.0.0.1:${deepseekPort}` },
      vl: { baseURL: `http://127.0.0.1:${vlPort}` },
    }),
    { inject: plugin.inject },
  ))
  return { ctx, dispose: () => fiber.dispose() }
}

const originalEnvironment = {
  deepseek: process.env.DEEPSEEK_API_KEY,
  vl: process.env.QWEN_VL_API_KEY,
}

// No ambient keys: every case below provisions its own key source.
beforeAll(() => {
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.QWEN_VL_API_KEY
})

afterAll(() => {
  if (originalEnvironment.deepseek === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = originalEnvironment.deepseek
  if (originalEnvironment.vl === undefined) delete process.env.QWEN_VL_API_KEY
  else process.env.QWEN_VL_API_KEY = originalEnvironment.vl
})

describe('credentials seam', () => {
  it('resolves both legs from the credentials service when one is mounted', async () => {
    await withServer(
      { status: 500, payload: { error: { message: 'capture only' } } },
      async (deepseek, deepseekPort) => {
        await withServer(
          {
            status: 200,
            payload: { choices: [{ message: { content: 'a class diagram' } }] },
          },
          async (vl, vlPort) => {
            const home = mkdtempSync(join(tmpdir(), 'dsh-creds-'))
            try {
              const harness = await makeHarness(deepseekPort, vlPort, { path: join(home, '.credentials.yaml') })
              try {
                await harness.ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'sk-ds-seam')
                await harness.ctx.credentials.set(credentialRef('QWEN_VL_API_KEY'), 'sk-vl-seam')
                await drain(harness.ctx.llm.stream(imageRequest()))
                // Both keys came from the credential store, not the environment.
                expect(vl.authorization).toBe('Bearer sk-vl-seam')
                expect(deepseek.authorization).toBe('Bearer sk-ds-seam')
                expect(vl.calls).toBe(1)
              } finally {
                await harness.dispose()
              }
            } finally {
              rmSync(home, { recursive: true, force: true })
            }
          },
        )
      },
    )
  })

  it('does not bypass a mounted credentials service when it resolves no key', async () => {
    const mountedButEmptyCredentials = {
      resolve: async () => undefined,
    } as Pick<Context['credentials'], 'resolve'>
    process.env.DEEPSEEK_API_KEY = 'sk-ds-launch-must-not-leak'
    process.env.QWEN_VL_API_KEY = 'sk-vl-env-fallback'
    try {
      await withServer(
        { status: 500, payload: { error: { message: 'capture only' } } },
        async (deepseek, deepseekPort) => {
          await withServer(
            { status: 200, payload: { choices: [{ message: { content: 'described via env fallback' } }] } },
            async (vl, vlPort) => {
              const harness = await makeHarness(deepseekPort, vlPort)
              try {
                harness.ctx.provide('credentials', mountedButEmptyCredentials as Context['credentials'])
                const chunks = await drain(harness.ctx.llm.stream(imageRequest()))
                expect(chunks.at(-1)).toMatchObject({
                  type: 'finish',
                  reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } },
                })
                expect(vl.calls).toBe(0)
                expect(deepseek.calls).toBe(0)
              } finally {
                await harness.dispose()
              }
            },
          )
        },
      )
    } finally {
      delete process.env.DEEPSEEK_API_KEY
      delete process.env.QWEN_VL_API_KEY
    }
  })

  it('does not bypass a mounted credentials service when only the DeepSeek key is missing', async () => {
    const credentialsWithOnlyVlKey = {
      resolve: async (ref: string) => ref === 'QWEN_VL_API_KEY'
        ? { value: 'sk-vl-provider', source: 'test' }
        : undefined,
    } as Pick<Context['credentials'], 'resolve'>
    process.env.DEEPSEEK_API_KEY = 'sk-ds-launch-must-not-leak'
    try {
      await withServer(
        { status: 500, payload: { error: { message: 'capture only' } } },
        async (deepseek, deepseekPort) => {
          await withServer(
            { status: 200, payload: { choices: [{ message: { content: 'described via provider key' } }] } },
            async (vl, vlPort) => {
              const harness = await makeHarness(deepseekPort, vlPort)
              try {
                harness.ctx.provide('credentials', credentialsWithOnlyVlKey as Context['credentials'])
                const chunks = await drain(harness.ctx.llm.stream(imageRequest()))
                expect(chunks.at(-1)).toMatchObject({
                  type: 'finish',
                  reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } },
                })
                expect(vl.authorization).toBe('Bearer sk-vl-provider')
                expect(vl.calls).toBe(1)
                expect(deepseek.calls).toBe(0)
              } finally {
                await harness.dispose()
              }
            },
          )
        },
      )
    } finally {
      delete process.env.DEEPSEEK_API_KEY
    }
  })

  it('credentials-local gives a process key priority over a pre-existing GUI file key', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-ds-process-wins'
    process.env.QWEN_VL_API_KEY = 'sk-vl-process-wins'
    try {
      await withServer(
        { status: 500, payload: { error: { message: 'capture only' } } },
        async (deepseek, deepseekPort) => {
          await withServer(
            { status: 200, payload: { choices: [{ message: { content: 'described with process key' } }] } },
            async (vl, vlPort) => {
              const home = mkdtempSync(join(tmpdir(), 'dsh-creds-'))
              const path = join(home, '.credentials.yaml')
              writeFileSync(path, 'DEEPSEEK_API_KEY: sk-ds-gui-file\nQWEN_VL_API_KEY: sk-vl-gui-file\n')
              try {
                const harness = await makeHarness(deepseekPort, vlPort, { path })
                try {
                  await expect(harness.ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY')))
                    .resolves.toMatchObject({ value: 'sk-ds-process-wins', source: 'env' })
                  await expect(harness.ctx.credentials.resolve(credentialRef('QWEN_VL_API_KEY')))
                    .resolves.toMatchObject({ value: 'sk-vl-process-wins', source: 'env' })
                  await expect(harness.ctx.credentials.describe(credentialRef('DEEPSEEK_API_KEY')))
                    .resolves.toMatchObject({ configured: true, source: 'env', writable: false })
                  await expect(harness.ctx.credentials.describe(credentialRef('QWEN_VL_API_KEY')))
                    .resolves.toMatchObject({ configured: true, source: 'env', writable: false })
                  await drain(harness.ctx.llm.stream(imageRequest()))
                  expect(vl.authorization).toBe('Bearer sk-vl-process-wins')
                  expect(deepseek.authorization).toBe('Bearer sk-ds-process-wins')
                } finally {
                  await harness.dispose()
                }
              } finally {
                rmSync(home, { recursive: true, force: true })
              }
            },
          )
        },
      )
    } finally {
      delete process.env.DEEPSEEK_API_KEY
      delete process.env.QWEN_VL_API_KEY
    }
  })

  it('fails with MISSING_CREDENTIAL when no seam and no environment carry a VL key', async () => {
    await withServer(
      { status: 500, payload: { error: { message: 'capture only' } } },
      async (_deepseek, deepseekPort) => {
        await withServer(
          { status: 500, payload: { error: { message: 'capture only' } } },
          async (_vl, vlPort) => {
            const harness = await makeHarness(deepseekPort, vlPort)
            try {
              const chunks = await drain(harness.ctx.llm.stream(imageRequest()))
              expect(chunks.at(-1)).toMatchObject({
                type: 'finish',
                reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } },
              })
            } finally {
              await harness.dispose()
            }
          },
        )
      },
    )
  })

  it('fails with MISSING_CREDENTIAL when the VL key exists but the DeepSeek key does not', async () => {
    process.env.QWEN_VL_API_KEY = 'sk-vl-env'
    try {
      await withServer(
        { status: 500, payload: { error: { message: 'capture only' } } },
        async (deepseek, deepseekPort) => {
          await withServer(
            { status: 200, payload: { choices: [{ message: { content: 'described fine' } }] } },
            async (vl, vlPort) => {
              const harness = await makeHarness(deepseekPort, vlPort)
              try {
                const chunks = await drain(harness.ctx.llm.stream(imageRequest()))
                // The VL leg succeeded; the DeepSeek leg's key resolution is
                // the one that failed — the description was never wasted on a
                // wire call.
                expect(chunks.at(-1)).toMatchObject({
                  type: 'finish',
                  reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } },
                })
                expect(vl.calls).toBe(1)
                expect(deepseek.calls).toBe(0)
              } finally {
                await harness.dispose()
              }
            },
          )
        },
      )
    } finally {
      delete process.env.QWEN_VL_API_KEY
    }
  })

  it('rejects a non-ASCII key as INVALID_CREDENTIAL before any wire call', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-ds-env'
    process.env.QWEN_VL_API_KEY = 'sk-bad-密钥'
    try {
      await withServer(
        { status: 500, payload: { error: { message: 'capture only' } } },
        async (deepseek, deepseekPort) => {
          await withServer(
            { status: 500, payload: { error: { message: 'capture only' } } },
            async (vl, vlPort) => {
              const harness = await makeHarness(deepseekPort, vlPort)
              try {
                const chunks = await drain(harness.ctx.llm.stream(imageRequest()))
                expect(chunks.at(-1)).toMatchObject({
                  type: 'finish',
                  reason: { kind: 'error', failure: { code: 'INVALID_CREDENTIAL' } },
                })
                expect(vl.calls).toBe(0)
                expect(deepseek.calls).toBe(0)
              } finally {
                await harness.dispose()
              }
            },
          )
        },
      )
    } finally {
      delete process.env.DEEPSEEK_API_KEY
      delete process.env.QWEN_VL_API_KEY
    }
  })
})
