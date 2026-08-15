/**
 * Wire-level tests for the OpenAI-compatible VL client against a local
 * HTTP stub: request shape, response parsing, error mapping, timeout, abort.
 */

import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { describeImage } from '../src/vl.js'
import type { VlConnectionFacts } from '../src/vl.js'

const REF = {
  attachmentId: 'img-1',
  mediaType: 'image/png',
  bytes: 4,
  width: 2,
  height: 2,
} as ImageAttachmentRef

const FACTS: VlConnectionFacts = {
  apiKey: 'vl-key',
  baseURL: 'http://127.0.0.1:0',
  model: 'qwen-vl-max',
  describePrompt: 'describe please',
  timeoutMs: 5_000,
}

interface Captured {
  url?: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
  calls: number
}

async function withServer(
  respond: (captured: Captured, res: import('node:http').ServerResponse) => void | Promise<void>,
  run: (captured: Captured, port: number) => Promise<void>,
): Promise<void> {
  const captured: Captured = { headers: {}, body: undefined, calls: 0 }
  const server: Server = createServer((req, res) => {
    captured.url = req.url
    captured.headers = req.headers
    captured.calls += 1
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      captured.body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
      void Promise.resolve(respond(captured, res))
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

function factsAt(port: number, overrides: Partial<VlConnectionFacts> = {}): VlConnectionFacts {
  return { ...FACTS, baseURL: `http://127.0.0.1:${port}`, ...overrides }
}

afterEach(() => {
  // Nothing to clean: each test owns its server.
})

describe('describeImage', () => {
  it('sends the image as a data URL beside the prompt, with attribution', async () => {
    await withServer(
      (captured, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: '  a diagram  ' } }] }))
      },
      async (captured, port) => {
        const text = await describeImage({ ref: REF, data: new Uint8Array([1, 2, 3]), facts: factsAt(port) })
        expect(text).toBe('a diagram')
        expect(captured.url).toBe('/chat/completions')
        expect(captured.headers.authorization).toBe('Bearer vl-key')
        expect(captured.headers['user-agent']).toContain('deepseek-harness')
        const body = captured.body as {
          model: string
          stream: boolean
          messages: { role: string; content: { type: string; image_url?: { url: string }; text?: string }[] }[]
        }
        expect(body.model).toBe('qwen-vl-max')
        expect(body.stream).toBe(false)
        const parts = body.messages[0]!.content
        expect(parts[0]).toMatchObject({ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } })
        expect(parts[1]).toEqual({ type: 'text', text: 'describe please' })
      },
    )
  })

  it('joins array-form content parts into one description', async () => {
    await withServer(
      (captured, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ message: { content: [{ type: 'text', text: 'part one ' }, { type: 'text', text: 'part two' }] } }],
        }))
      },
      async (_captured, port) => {
        const text = await describeImage({ ref: REF, data: new Uint8Array(), facts: factsAt(port) })
        expect(text).toBe('part one part two')
      },
    )
  })

  it('surfaces the provider error message and maps 401 to AUTH', async () => {
    await withServer(
      (captured, res) => {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'bad key' } }))
      },
      async (_captured, port) => {
        await expect(describeImage({ ref: REF, data: new Uint8Array(), facts: factsAt(port) }))
          .rejects.toMatchObject({ name: 'LlmError', failure: { code: 'AUTH' } })
      },
    )
  })

  it('classifies an exhausted-quota provider body as QUOTA (mirrors llm-deepseek)', async () => {
    await withServer(
      (captured, res) => {
        res.writeHead(402, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { code: 'insufficient_quota', message: 'account quota exhausted' } }))
      },
      async (_captured, port) => {
        await expect(describeImage({ ref: REF, data: new Uint8Array(), facts: factsAt(port) }))
          .rejects.toMatchObject({ failure: { code: 'QUOTA' } })
      },
    )
  })

  it('carries a retry-after delay on rate limits for the harness retry machinery', async () => {
    await withServer(
      (captured, res) => {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' })
        res.end(JSON.stringify({ error: { message: 'slow down' } }))
      },
      async (_captured, port) => {
        await expect(describeImage({ ref: REF, data: new Uint8Array(), facts: factsAt(port) }))
          .rejects.toMatchObject({
            failure: { code: 'RATE_LIMIT', providerRetryAfterMs: 7_000 },
          })
      },
    )
  })

  it('maps an empty content body to EMPTY_RESPONSE', async () => {
    await withServer(
      (captured, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: '' } }] }))
      },
      async (_captured, port) => {
        await expect(describeImage({ ref: REF, data: new Uint8Array(), facts: factsAt(port) }))
          .rejects.toMatchObject({ failure: { code: 'EMPTY_RESPONSE' } })
      },
    )
  })

  it('times out a hanging endpoint with the TIMEOUT code', async () => {
    await withServer(
      () => {
        // Never respond; the client's timeout owns termination.
      },
      async (_captured, port) => {
        await expect(describeImage({
          ref: REF,
          data: new Uint8Array(),
          facts: factsAt(port, { timeoutMs: 100 }),
        })).rejects.toMatchObject({ failure: { code: 'TIMEOUT' } })
      },
    )
  })

  it('reports caller aborts as ABORTED', async () => {
    await withServer(
      () => {
        // Never respond; the aborted signal owns termination.
      },
      async (_captured, port) => {
        const controller = new AbortController()
        controller.abort(new Error('stopped'))
        await expect(describeImage({
          ref: REF,
          data: new Uint8Array(),
          facts: factsAt(port),
          signal: controller.signal,
        })).rejects.toMatchObject({ failure: { code: 'ABORTED' } })
      },
    )
  })

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    await withServer(
      (_captured, res) => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end('gateway exploded in prose')
      },
      async (_captured, port) => {
        await expect(describeImage({ ref: REF, data: new Uint8Array(), facts: factsAt(port) }))
          .rejects.toMatchObject({ failure: { code: 'SERVER', status: 500 } })
      },
    )
  })

  it('maps an unreadable success body to EMPTY_RESPONSE', async () => {
    await withServer(
      (_captured, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('not json at all')
      },
      async (_captured, port) => {
        await expect(describeImage({ ref: REF, data: new Uint8Array(), facts: factsAt(port) }))
          .rejects.toMatchObject({ failure: { code: 'EMPTY_RESPONSE' } })
      },
    )
  })

  it('times out while the response body is still streaming', async () => {
    await withServer(
      (_captured, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.write('{"choices":[{"message":')
        // Never finish the body: the timeout owns termination mid-read.
      },
      async (_captured, port) => {
        await expect(describeImage({
          ref: REF,
          data: new Uint8Array(),
          facts: factsAt(port, { timeoutMs: 100 }),
        })).rejects.toMatchObject({ failure: { code: 'TIMEOUT' } })
      },
    )
  })

  it('reports a caller abort that lands while reading the body', async () => {
    await withServer(
      (_captured, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.write('{"choices":[{"message":')
        // Never finish the body; the abort owns termination.
      },
      async (_captured, port) => {
        const controller = new AbortController()
        const promise = describeImage({
          ref: REF,
          data: new Uint8Array(),
          facts: factsAt(port),
          signal: controller.signal,
        })
        controller.abort(new Error('stopped'))
        await expect(promise).rejects.toMatchObject({ failure: { code: 'ABORTED' } })
      },
    )
  })
})
