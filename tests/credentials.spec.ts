/**
 * Credentials-seam tests: the plugin resolves both legs' API keys through
 * the REAL credentials service when one is mounted (the web Models page
 * writes there), through the launch environment otherwise — and fails with
 * stable codes when neither can produce a usable key.
 */

import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
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

// No ambient keys: every case below provisions its own key source.
beforeAll(() => {
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.QWEN_VL_API_KEY
})

afterAll(() => {})

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
