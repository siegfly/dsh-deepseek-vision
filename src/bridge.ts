/**
 * Image-to-text request projection for text-only model routes.
 *
 * Every prepared gateway call supplies an immutable generation, so settings
 * changes affect the next call rather than a call between capability
 * resolution and dispatch. Successful descriptions are shared by their full
 * projection identity; concurrent callers retain independent cancellation.
 *
 * @module dsh-deepseek-vision/bridge
 */

import type {
  AttachmentStore,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'

export type VlFailurePolicy = 'fail' | 'placeholder'

/** Complete VL projection facts captured for one prepared call. */
export interface ImageBridgeGeneration {
  /** Stable identity covering endpoint, model, prompt, limits, and protocol. */
  cacheIdentity: string
  /** Model id stamped into the model-visible replacement. */
  model: string
  /** DSH-owned deterministic request-image projection. */
  imagePolicy: ImageRequestPolicy
  maxCacheEntries: number
  onFailure: VlFailurePolicy
  describe: (
    ref: ImageAttachmentRef,
    image: RequestImageAttachment,
    signal?: AbortSignal,
  ) => Promise<string>
}

export interface ImageBridgeOptions {
  attachments: AttachmentStore
}

interface CachedDescription {
  model: string
  text: string
}

interface PendingDescription {
  controller: AbortController
  promise: Promise<CachedDescription>
  waiters: number
  settled: boolean
}

function formatDescription(ref: ImageAttachmentRef, description: CachedDescription): string {
  const name = ref.name === undefined ? '' : ` ${ref.name}`
  return `[Image:${name} ${ref.mediaType} ${ref.width}x${ref.height} — described by ${description.model}]\n${description.text}`
}

function failureCode(error: unknown): string {
  return error instanceof LlmError ? error.code : 'VL_DESCRIPTION_FAILED'
}

/** Await a shared operation without allowing one caller to cancel another. */
async function waitForPending(
  pending: PendingDescription,
  signal?: AbortSignal,
): Promise<CachedDescription> {
  pending.waiters += 1
  let onAbort: (() => void) | undefined
  try {
    if (signal === undefined) return await pending.promise
    signal.throwIfAborted()
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
    })
    return await Promise.race([pending.promise, cancelled])
  } finally {
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
    pending.waiters -= 1
    if (!pending.settled && pending.waiters === 0) pending.controller.abort()
  }
}

/** Prepared-call-aware image projection and successful-result cache. */
export class ImageBridge {
  private readonly cache = new Map<string, CachedDescription>()
  private readonly inFlight = new Map<string, PendingDescription>()

  constructor(private readonly options: ImageBridgeOptions) {}

  private cacheKey(ref: ImageAttachmentRef, generation: ImageBridgeGeneration): string {
    return `${generation.cacheIdentity}\u0000${String(ref.attachmentId)}`
  }

  private assertWithinDeploymentLimits(ref: ImageAttachmentRef): void {
    const limits = this.options.attachments.imageLimits
    if (limits === undefined) return
    const withinSide = limits.maxImageDimension === undefined
      || (ref.width <= limits.maxImageDimension && ref.height <= limits.maxImageDimension)
    if (ref.bytes <= limits.maxImageBytes
      && ref.width * ref.height <= limits.maxImagePixels
      && withinSide) return
    throw new LlmError(
      `image ${String(ref.attachmentId)} exceeds the deployment image limits`,
      'IMAGE_TOO_LARGE',
    )
  }

  private remember(key: string, value: CachedDescription, capacity: number): void {
    this.cache.delete(key)
    while (this.cache.size >= capacity) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    this.cache.set(key, value)
  }

  private descriptionFor(
    ref: ImageAttachmentRef,
    generation: ImageBridgeGeneration,
    signal?: AbortSignal,
  ): Promise<CachedDescription> {
    const key = this.cacheKey(ref, generation)
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return Promise.resolve(cached)
    }
    const shared = this.inFlight.get(key)
    if (shared !== undefined) return waitForPending(shared, signal)

    const controller = new AbortController()
    const pending = {} as PendingDescription
    pending.controller = controller
    pending.waiters = 0
    pending.settled = false
    pending.promise = (async () => {
      this.assertWithinDeploymentLimits(ref)
      const image = await this.options.attachments.readImageRequest(
        ref,
        generation.imagePolicy,
        controller.signal,
      )
      const text = await generation.describe(ref, image, controller.signal)
      const value = { model: generation.model, text }
      this.remember(key, value, generation.maxCacheEntries)
      return value
    })().finally(() => {
      pending.settled = true
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key)
    })
    void pending.promise.catch(() => {})
    this.inFlight.set(key, pending)
    return waitForPending(pending, signal)
  }

  private async rewriteBlocks(
    blocks: readonly ContentBlock[],
    generation: ImageBridgeGeneration,
    signal?: AbortSignal,
  ): Promise<ContentBlock[]> {
    const out: ContentBlock[] = []
    for (const block of blocks) {
      if (block.type === 'image') {
        let text: string
        try {
          const description = await this.descriptionFor(block.attachment, generation, signal)
          text = formatDescription(block.attachment, description)
        } catch (error) {
          if (generation.onFailure === 'placeholder') {
            text = `[Image: ${block.attachment.mediaType} — description unavailable (${failureCode(error)})]`
          } else {
            if (error instanceof LlmError) throw error
            signal?.throwIfAborted()
            throw new LlmError(
              `failed to describe image ${String(block.attachment.attachmentId)}`,
              'VL_DESCRIPTION_FAILED',
              { cause: error },
            )
          }
        }
        out.push({ type: 'text', text })
        continue
      }
      if (block.type === 'tool-result') {
        out.push({ ...block, content: await this.rewriteBlocks(block.content, generation, signal) })
        continue
      }
      out.push(block)
    }
    return out
  }

  /** Rewrite one request without mutating the durable or frozen source. */
  async rewrite(options: GenerateOptions, generation: ImageBridgeGeneration): Promise<GenerateOptions> {
    if (!options.messages.some(message => contentHasImage(message.content))) return options
    const messages: Message[] = []
    for (const message of options.messages) {
      if (!contentHasImage(message.content)) {
        messages.push(message)
        continue
      }
      messages.push({
        ...message,
        content: await this.rewriteBlocks(message.content, generation, options.signal),
      })
    }
    return { ...options, messages }
  }
}
