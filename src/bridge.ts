/**
 * The image→text rewrite pipeline: replaces every image block (top-level and
 * nested inside tool results) in a loop-built request with a cached textual
 * description, so the text-only DeepSeek serializer never sees an image.
 *
 * The session log keeps the original image blocks untouched — the rewrite is a
 * wire-level transformation inside the adapter, which is exactly where the
 * agent-loop reconstruction invariant stops looking.
 *
 * @module dsh-vl-gateway/bridge
 */

import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'

/** Failure policy when the VL description cannot be produced. */
export type VlFailurePolicy = 'fail' | 'placeholder'

/** Dependencies of the rewrite pipeline, supplied by the plugin glue. */
export interface ImageBridgeOptions {
  /** Durable byte resolver for image references. */
  attachments: AttachmentStore
  /** Describe one image; throws LlmError on failure. */
  describe: (ref: ImageAttachmentRef, data: Uint8Array, signal?: AbortSignal) => Promise<string>
  /** Current VL model id, stamped into the injected text for transparency. */
  describeModel: () => string
  /** Bounded per-process cache capacity (one entry per unique attachment). */
  maxCacheEntries: number
  /** `fail` throws (fail-closed); `placeholder` substitutes an error note. */
  onFailure: VlFailurePolicy
}

/** Render one image block's replacement text. */
function formatDescription(
  ref: ImageAttachmentRef,
  description: string,
  model: string,
): string {
  const name = ref.name === undefined ? '' : ` ${ref.name}`
  return `[Image:${name} ${ref.mediaType} ${ref.width}x${ref.height} — described by ${model}]\n${description}`
}

/**
 * Rewrites images inside one request into text descriptions.
 *
 * Descriptions are cached per `attachmentId` for the process lifetime, so
 * retries, compaction passes, and later turns reuse the first description.
 * A failed in-flight description is evicted so the next attempt retries it.
 */
export class ImageBridge {
  private readonly cache = new Map<string, Promise<string>>()

  constructor(private readonly options: ImageBridgeOptions) {}

  /** Cached (or in-flight) description promise for one durable attachment. */
  private descriptionFor(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<string> {
    const id = ref.attachmentId
    const existing = this.cache.get(id)
    if (existing !== undefined) {
      // LRU refresh: re-insert at the tail.
      this.cache.delete(id)
      this.cache.set(id, existing)
      return existing
    }
    const pending = (async () => {
      const stored = await this.options.attachments.readImage(ref, signal)
      return this.options.describe(ref, stored.data, signal)
    })()
    if (this.cache.size >= this.options.maxCacheEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(id, pending)
    void pending.catch(() => {
      // Failed descriptions never cache; the next request retries.
      if (this.cache.get(id) === pending) this.cache.delete(id)
    })
    return pending
  }

  /** Rewrite one content-block array, recursing into tool results. */
  private async rewriteBlocks(
    blocks: readonly ContentBlock[],
    signal?: AbortSignal,
  ): Promise<ContentBlock[]> {
    const out: ContentBlock[] = []
    for (const block of blocks) {
      if (block.type === 'image') {
        let text: string
        try {
          const description = await this.descriptionFor(block.attachment, signal)
          text = formatDescription(block.attachment, description, this.options.describeModel())
        } catch (error) {
          if (this.options.onFailure === 'placeholder') {
            const reason = error instanceof Error ? error.message : String(error)
            text = `[Image: ${block.attachment.mediaType} — description unavailable: ${reason}]`
          } else {
            if (error instanceof LlmError) throw error
            throw new LlmError(
              `failed to describe image ${String(block.attachment.attachmentId)}: ${String(error)}`,
              'VL_DESCRIPTION_FAILED',
              { cause: error },
            )
          }
        }
        out.push({ type: 'text', text })
        continue
      }
      if (block.type === 'tool-result') {
        out.push({ ...block, content: await this.rewriteBlocks(block.content, signal) })
        continue
      }
      out.push(block)
    }
    return out
  }

  /**
   * Rewrite one request. Returns the SAME options object when it carries no
   * images; otherwise a new envelope with rewritten (image-free) messages.
   * The original (often deep-frozen) request is never mutated.
   */
  async rewrite(options: GenerateOptions): Promise<GenerateOptions> {
    if (!options.messages.some(message => contentHasImage(message.content))) return options
    const messages: Message[] = []
    for (const message of options.messages) {
      if (!contentHasImage(message.content)) {
        messages.push(message)
        continue
      }
      messages.push({ ...message, content: await this.rewriteBlocks(message.content, options.signal) })
    }
    return { ...options, messages }
  }
}
