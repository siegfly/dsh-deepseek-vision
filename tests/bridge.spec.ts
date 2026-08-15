/**
 * Unit tests for the image→text rewrite pipeline: replacement shape, nested
 * tool-result recursion, per-attachment caching, LRU eviction, and the two
 * failure policies.
 */

import { describe, expect, it, vi } from 'vitest'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { CallId, ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { ImageBridge } from '../src/bridge.js'

function ref(id: string, overrides: Partial<ImageAttachmentRef> = {}): ImageAttachmentRef {
  return {
    attachmentId: id as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 4,
    width: 2,
    height: 2,
    ...overrides,
  }
}

const IMAGE_A = ref('a')
const IMAGE_B = ref('b')

function text(text: string): ContentBlock {
  return { type: 'text', text }
}

function image(attachment: ImageAttachmentRef): ContentBlock {
  return { type: 'image', attachment }
}

function user(content: ContentBlock[]): Message {
  return { role: 'user', content, source: { kind: 'user' } }
}

function request(messages: Message[]): GenerateOptions {
  return { provider: 'gateway', model: 'deepseek-v4-flash', messages }
}

function makeBridge(
  describe: (r: ImageAttachmentRef, data: Uint8Array, signal?: AbortSignal) => Promise<string>,
  overrides: Partial<ConstructorParameters<typeof ImageBridge>[0]> = {},
): ImageBridge {
  const attachments = {
    readImage: async (r: ImageAttachmentRef) => ({ ref: r, data: new Uint8Array([9]) }),
  } as unknown as AttachmentStore
  return new ImageBridge({
    attachments,
    describe,
    describeModel: () => 'qwen-vl-max',
    maxCacheEntries: () => 4,
    onFailure: () => 'fail',
    ...overrides,
  })
}

describe('ImageBridge.rewrite', () => {
  it('replaces a top-level image with a labeled description text block', async () => {
    const bridge = makeBridge(async () => 'the content')
    const rewritten = await bridge.rewrite(request([user([text('look:'), image(IMAGE_A)])]))
    expect(rewritten.messages[0]!.content).toEqual([
      text('look:'),
      text('[Image: image/png 2x2 — described by qwen-vl-max]\nthe content'),
    ])
  })

  it('replaces images nested inside tool results and keeps their tool-call ids', async () => {
    const bridge = makeBridge(async (r) => `desc-${r.attachmentId}`)
    const original = request([user([
      { type: 'tool-result', toolCallId: 'call-1' as CallId, content: [image(IMAGE_A), text('log tail')], isError: false },
    ])])
    const rewritten = await bridge.rewrite(original)
    const block = rewritten.messages[0]!.content[0]!
    expect(block.type).toBe('tool-result')
    if (block.type !== 'tool-result') throw new Error('expected tool-result')
    expect(block.toolCallId).toBe('call-1')
    expect(block.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('desc-a') })
    expect(block.content[1]).toEqual(text('log tail'))
  })

  it('passes image-free messages through by reference in a mixed conversation', async () => {
    const describe = vi.fn(async () => 'content')
    const bridge = makeBridge(describe)
    const plain = user([text('keep me')])
    const rewritten = await bridge.rewrite(request([plain, user([image(IMAGE_A)])]))
    expect(rewritten.messages[0]).toBe(plain)
    expect(rewritten.messages[1]!.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('content') })
    expect(describe).toHaveBeenCalledTimes(1)
  })

  it('returns the SAME options object when no message carries an image', async () => {
    const describe = vi.fn(async () => 'never')
    const bridge = makeBridge(describe)
    const original = request([user([text('plain')])])
    const rewritten = await bridge.rewrite(original)
    expect(rewritten).toBe(original)
    expect(describe).not.toHaveBeenCalled()
  })

  it('caches one description per attachment across rewrites', async () => {
    const describe = vi.fn(async (r) => `desc-${r.attachmentId}`)
    const bridge = makeBridge(describe)
    const one = await bridge.rewrite(request([user([image(IMAGE_A)])]))
    const two = await bridge.rewrite(request([user([image(IMAGE_A), image(IMAGE_A)])]))
    expect(describe).toHaveBeenCalledTimes(1)
    expect(one.messages[0]!.content[0]).toEqual(two.messages[0]!.content[0])
  })

  it('deduplicates concurrent rewrites of the same attachment', async () => {
    let calls = 0
    const bridge = makeBridge(async () => {
      calls += 1
      await new Promise(resolve => setTimeout(resolve, 5))
      return 'shared'
    })
    await Promise.all([
      bridge.rewrite(request([user([image(IMAGE_A)])])),
      bridge.rewrite(request([user([image(IMAGE_A)])])),
    ])
    expect(calls).toBe(1)
  })

  it('evicts failed descriptions so the next rewrite retries', async () => {
    let attempt = 0
    const describe = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new LlmError('vl down', 'TRANSPORT')
      return 'recovered'
    })
    const bridge = makeBridge(describe)
    await expect(bridge.rewrite(request([user([image(IMAGE_A)])]))).rejects.toMatchObject({ failure: { code: 'TRANSPORT' } })
    const rewritten = await bridge.rewrite(request([user([image(IMAGE_A)])]))
    expect(describe).toHaveBeenCalledTimes(2)
    expect(rewritten.messages[0]!.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('recovered') })
  })

  it('substitutes a placeholder when onFailure is placeholder', async () => {
    const bridge = makeBridge(async () => {
      throw new LlmError('vl down', 'TRANSPORT')
    }, { onFailure: () => 'placeholder' })
    const rewritten = await bridge.rewrite(request([user([image(IMAGE_A)])]))
    expect(rewritten.messages[0]!.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('description unavailable: vl down'),
    })
  })

  it('re-reads the live failure policy on every rewrite (settings edits reach the next request)', async () => {
    let policy: 'fail' | 'placeholder' = 'fail'
    const bridge = makeBridge(async () => {
      throw new LlmError('boom', 'AUTH')
    }, { onFailure: () => policy })
    await expect(bridge.rewrite(request([user([image(IMAGE_A)])])))
      .rejects.toMatchObject({ name: 'LlmError', failure: { code: 'AUTH' } })
    policy = 'placeholder'
    const rewritten = await bridge.rewrite(request([user([image(IMAGE_A)])]))
    expect(rewritten.messages[0]!.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('description unavailable: boom'),
    })
  })

  it('stamps cached descriptions with the model that produced them, even after the model setting changes', async () => {
    let model = 'qwen-vl-max'
    const bridge = makeBridge(async () => 'screenshot content', { describeModel: () => model })
    await bridge.rewrite(request([user([image(IMAGE_A)])]))
    model = 'qwen-vl-plus'
    const rewritten = await bridge.rewrite(request([user([image(IMAGE_A)])]))
    // The cached text keeps the producing model's stamp: the setting changed,
    // the provenance does not lie.
    expect(rewritten.messages[0]!.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('described by qwen-vl-max'),
    })
    expect(rewritten.messages[0]!.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('screenshot content'),
    })
  })

  it('wraps non-LlmError describe failures as VL_DESCRIPTION_FAILED', async () => {
    const bridge = makeBridge(async () => {
      throw new Error('socket closed')
    })
    await expect(bridge.rewrite(request([user([image(IMAGE_A)])])))
      .rejects.toMatchObject({ name: 'LlmError', failure: { code: 'VL_DESCRIPTION_FAILED' } })
  })

  it('evicts the oldest cached entry past the capacity', async () => {
    const describe = vi.fn(async (r) => `desc-${r.attachmentId}`)
    const bridge = makeBridge(describe, { maxCacheEntries: () => 2 })
    const ids = ['a', 'b', 'c']
    for (const id of ids) await bridge.rewrite(request([user([image(ref(id))])]))
    expect(describe).toHaveBeenCalledTimes(3)
    // Cache holds [b, c]; describing 'a' again is a miss that evicts 'b'.
    await bridge.rewrite(request([user([image(ref('a'))])]))
    expect(describe).toHaveBeenCalledTimes(4)
    // Cache now holds [c, a]; only 'c' is still cached.
    await bridge.rewrite(request([user([image(ref('c'))])]))
    expect(describe).toHaveBeenCalledTimes(4)
    await bridge.rewrite(request([user([image(ref('b'))])]))
    expect(describe).toHaveBeenCalledTimes(5)
  })

  it('fails fast with IMAGE_TOO_LARGE before reading bytes when a reference exceeds the deployment limits', async () => {
    let reads = 0
    const bridge = makeBridge(async () => 'never', {
      attachments: {
        readImage: async () => {
          reads += 1
          throw new Error('must not be read')
        },
        imageLimits: {
          maxImageBytes: 1_000,
          maxImagesPerMessage: 1,
          maxMessageImageBytes: 1_000,
          maxImagePixels: 10_000,
          mediaTypes: ['image/png'],
        },
      } as unknown as AttachmentStore,
    })
    const oversized = ref('big', { bytes: 9_999, width: 100, height: 100 })
    await expect(bridge.rewrite(request([user([image(oversized)])])))
      .rejects.toMatchObject({ name: 'LlmError', failure: { code: 'IMAGE_TOO_LARGE' } })
    expect(reads).toBe(0)
  })

  it('substitutes a placeholder for an oversized image under the placeholder policy', async () => {
    const bridge = makeBridge(async () => 'never', {
      onFailure: () => 'placeholder',
      attachments: {
        readImage: async () => {
          throw new Error('must not be read')
        },
        imageLimits: {
          maxImageBytes: 1_000,
          maxImagesPerMessage: 1,
          maxMessageImageBytes: 1_000,
          maxImagePixels: 10_000,
          mediaTypes: ['image/png'],
        },
      } as unknown as AttachmentStore,
    })
    const oversized = ref('big', { bytes: 9_999, width: 100, height: 100 })
    const rewritten = await bridge.rewrite(request([user([image(oversized)])]))
    expect(rewritten.messages[0]!.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('description unavailable: image big exceeds the deployment image limits'),
    })
  })

  it('never mutates a frozen request', async () => {
    const bridge = makeBridge(async () => 'content')
    const frozen = Object.freeze({
      provider: 'gateway',
      model: 'deepseek-v4-flash',
      messages: Object.freeze([user(Object.freeze([image(IMAGE_A)]))]),
    }) as GenerateOptions
    await expect(bridge.rewrite(frozen)).resolves.toMatchObject({
      messages: [{ content: [{ type: 'text', text: expect.stringContaining('content') }] }],
    })
  })
})
