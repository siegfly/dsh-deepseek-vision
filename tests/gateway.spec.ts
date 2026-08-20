/**
 * Adapter-level tests: the gateway claims image input, delegates catalog and
 * reasoning metadata to the DeepSeek parent, and rewrites images out of the
 * request before the text-only wire is called. The image-source tests cover
 * the shapes rc.7 bridges through the durable attachment store — ACP inline
 * images (top-level) and MCP tool-returned images (nested in tool results).
 */

import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { ResolvedDeepSeekOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CallId, GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ImageBridge } from '../src/bridge.js'
import { GATEWAY_INPUT_MODALITIES, VisionGatewayAdapter } from '../src/gateway.js'

const REF = {
  attachmentId: 'img-1',
  mediaType: 'image/png',
  bytes: 4,
  width: 2,
  height: 2,
} as ImageAttachmentRef

interface Captured {
  url?: string
  body: unknown
}

async function withDeepSeekServer(run: (captured: Captured, port: number) => Promise<void>): Promise<void> {
  const captured: Captured = { body: undefined }
  const server: Server = createServer((req, res) => {
    captured.url = req.url
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      captured.body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
      // Non-ok on purpose: the assertions are about the request shape, and a
      // terminal error finish is the cleanest stream to drain.
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'capture only' } }))
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

/**
 * A DeepSeek mock that streams a real SSE success: two content deltas, a
 * finish_reason on the last, usage, and the `[DONE]` terminator — the exact
 * shape the official parser consumes (EOF without `[DONE]` is STREAM_CLOSED).
 */
async function withStreamingDeepSeekServer(run: (captured: Captured, port: number) => Promise<void>): Promise<void> {
  const captured: Captured = { body: undefined }
  const server: Server = createServer((req, res) => {
    captured.url = req.url
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      captured.body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')
      res.write('data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n')
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

function makeAdapter(
  port: number,
  describe: (r: ImageAttachmentRef, data: Uint8Array) => Promise<string>,
  displayName: () => string = () => 'DeepSeek + Vision',
): VisionGatewayAdapter {
  const connection: ResolvedDeepSeekOptions = resolveAdapterOptions({
    baseURL: `http://127.0.0.1:${port}`,
    thinking: 'disabled',
  })
  const attachments = {
    readImage: async (r: ImageAttachmentRef) => ({ ref: r, data: new Uint8Array([1]) }),
  } as unknown as AttachmentStore
  const bridge = new ImageBridge({
    attachments,
    describe,
    describeModel: () => 'qwen-vl-max',
    maxCacheEntries: () => 4,
    onFailure: () => 'fail',
  })
  return new VisionGatewayAdapter(
    {
      options: () => connection,
      resolveApiKey: async () => 'deepseek-key',
      resolveUserId: () => 'tester' as AnonymousUserId,
    },
    bridge,
    displayName,
  )
}

function imageRequest(): GenerateOptions {
  const messages: Message[] = [{
    role: 'user',
    content: [{ type: 'text', text: 'what is this?' }, { type: 'image', attachment: REF }],
    source: { kind: 'user' },
  }]
  return { provider: 'deepseek-vision', model: 'deepseek-v4-flash', messages }
}

afterEach(() => {
  // Each test owns its server.
})

describe('VisionGatewayAdapter', () => {
  it('labels the route with the gateway display name', async () => {
    await withDeepSeekServer(async (_captured, port) => {
      const adapter = makeAdapter(port, async () => 'desc')
      expect(adapter.providerInfo('deepseek-vision')).toEqual({ id: 'deepseek-vision', name: 'DeepSeek + Vision' })
    })
  })

  it('reads the selector label live, so a rename reaches the registry on re-registration', async () => {
    await withDeepSeekServer(async (_captured, port) => {
      let name = 'DeepSeek + Vision'
      const adapter = makeAdapter(port, async () => 'desc', () => name)
      expect(adapter.providerInfo('deepseek-vision').name).toBe('DeepSeek + Vision')
      name = 'DeepSeek Vision Renamed'
      expect(adapter.providerInfo('deepseek-vision').name).toBe('DeepSeek Vision Renamed')
    })
  })

  it('claims image input on every advertised model', async () => {
    await withDeepSeekServer(async (_captured, port) => {
      const adapter = makeAdapter(port, async () => 'desc')
      const models = await adapter.listModels('deepseek-vision')
      expect(models.length).toBeGreaterThan(0)
      for (const model of models) {
        expect(model.inputModalities).toEqual(GATEWAY_INPUT_MODALITIES)
        expect(model.provider).toBe('deepseek-vision')
      }
    })
  })

  it('claims image input in exact-model resolution while keeping reasoning metadata', async () => {
    await withDeepSeekServer(async (_captured, port) => {
      const adapter = makeAdapter(port, async () => 'desc')
      const info = await adapter.resolveModel('deepseek-vision', 'deepseek-v4-pro')
      expect(info.inputModalities).toEqual(GATEWAY_INPUT_MODALITIES)
      expect(info.context?.contextWindow).toBeGreaterThan(0)
      // thinking disabled → the single off effort is inherited from the parent.
      expect(info.reasoning?.efforts.map(effort => String(effort.id))).toContain('off')
    })
  })

  it('rewrites images to text before the DeepSeek wire and surfaces the provider failure', async () => {
    await withDeepSeekServer(async (captured, port) => {
      const adapter = makeAdapter(port, async () => 'a wiring diagram')
      // A direct adapter call (no LlmRuntime wrapper) throws the provider
      // error instead of normalizing it to a finish chunk.
      await expect(drain(adapter.stream(imageRequest())))
        .rejects.toMatchObject({ name: 'LlmError', failure: { code: 'SERVER' } })

      const body = captured.body as {
        messages: { role: string; content: unknown }[]
      }
      expect(captured.url).toBe('/chat/completions')
      const wire = JSON.stringify(body)
      expect(wire).toContain('a wiring diagram')
      expect(wire).not.toContain('image_url')
      expect(wire).not.toContain('data:image')
      expect(wire).not.toContain('"type":"image"')
    })
  })

  it('leaves image-free requests byte-for-byte untouched on the wire', async () => {
    await withDeepSeekServer(async (captured, port) => {
      const adapter = makeAdapter(port, async () => 'never called')
      const messages: Message[] = [{
        role: 'user',
        content: [{ type: 'text', text: 'plain question' }],
        source: { kind: 'user' },
      }]
      await expect(drain(adapter.stream({ provider: 'deepseek-vision', model: 'deepseek-v4-flash', messages })))
        .rejects.toMatchObject({ name: 'LlmError', failure: { code: 'SERVER' } })
      const body = captured.body as { messages: { content: string }[] }
      expect(body.messages[0]!.content).toBe('plain question')
    })
  })

  it('streams deltas, usage, and stop through unchanged while rewriting the image to text', async () => {
    await withStreamingDeepSeekServer(async (captured, port) => {
      const adapter = makeAdapter(port, async () => 'a wiring diagram')
      const chunks = await drain(adapter.stream(imageRequest()))
      // The full official chunk sequence, untouched by the gateway: the
      // yield* passthrough is the plugin's core transparency promise.
      expect(chunks.map(chunk => chunk.type)).toEqual([
        'block-start', 'text-delta', 'text-delta', 'block-end', 'usage', 'finish',
      ])
      expect(chunks[1]).toMatchObject({ type: 'text-delta', text: 'Hello' })
      expect(chunks[2]).toMatchObject({ type: 'text-delta', text: ' world' })
      expect(chunks[3]).toMatchObject({ type: 'block-end', block: { type: 'text', text: 'Hello world' } })
      expect(chunks[4]).toMatchObject({ type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } })
      expect(chunks[5]).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      // The rewrite happened before the stream: the DeepSeek wire saw the
      // description, never the image.
      const body = captured.body as { messages: { content: unknown }[] }
      const wire = JSON.stringify(body)
      expect(wire).toContain('a wiring diagram')
      expect(wire).not.toContain('image_url')
      expect(wire).not.toContain('data:image')
      expect(wire).not.toContain('"type":"image"')
    })
  })
})

describe('image sources (MCP / ACP)', () => {
  /** ACP inline image: a top-level user image block (rc.7 `admitAcpPrompt` shape). */
  function acpInlineImageRequest(): GenerateOptions {
    const messages: Message[] = [{
      role: 'user',
      content: [{ type: 'text', text: 'inspect this' }, { type: 'image', attachment: REF }],
      source: { kind: 'user' },
    }]
    return { provider: 'deepseek-vision', model: 'deepseek-v4-flash', messages }
  }

  /** MCP tool result: an image nested in a tool-result block (rc.7 `prepareImageProjection` shape). */
  function mcpToolResultImageRequest(): GenerateOptions {
    const messages: Message[] = [{
      role: 'user',
      content: [{
        type: 'tool-result',
        toolCallId: 'mcp-screenshot-1' as CallId,
        isError: false,
        content: [{ type: 'image', attachment: REF }],
      }],
      source: { kind: 'user' },
    }]
    return { provider: 'deepseek-vision', model: 'deepseek-v4-flash', messages }
  }

  it('describes an ACP inline image before the DeepSeek wire', async () => {
    await withStreamingDeepSeekServer(async (captured, port) => {
      const adapter = makeAdapter(port, async () => 'an ACP screenshot')
      const chunks = await drain(adapter.stream(acpInlineImageRequest()))
      expect(chunks.map(chunk => chunk.type)).toContain('finish')
      const wire = JSON.stringify(captured.body)
      expect(wire).toContain('an ACP screenshot')
      expect(wire).not.toContain('image_url')
      expect(wire).not.toContain('data:image')
      expect(wire).not.toContain('"type":"image"')
    })
  })

  it('describes an MCP tool-result image before the DeepSeek wire', async () => {
    await withStreamingDeepSeekServer(async (captured, port) => {
      const adapter = makeAdapter(port, async () => 'an MCP screenshot')
      const chunks = await drain(adapter.stream(mcpToolResultImageRequest()))
      expect(chunks.map(chunk => chunk.type)).toContain('finish')
      const wire = JSON.stringify(captured.body)
      expect(wire).toContain('an MCP screenshot')
      expect(wire).not.toContain('image_url')
      expect(wire).not.toContain('data:image')
      expect(wire).not.toContain('"type":"image"')
    })
  })
})
