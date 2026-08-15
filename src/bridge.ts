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
  maxCacheEntries: () => number
  /** `fail` throws (fail-closed); `placeholder` substitutes an error note. */
  onFailure: () => VlFailurePolicy
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

/** One cached description plus the model that actually produced it. */
interface CachedDescription {
  /** Wire model id in force when the description was produced. */
  model: string
  /** The description text. */
  text: string
}

/**
 * Rewrites images inside one request into text descriptions.
 *
 * Descriptions are cached per `attachmentId` for the process lifetime, so
 * retries, compaction passes, and later turns reuse the first description.
 * A failed in-flight description is evicted so the next attempt retries it.
 * Each entry also records the model that produced it — the injected stamp
 * must stay truthful even when the configured VL model changes afterwards.
 */
export class ImageBridge {
  private readonly cache = new Map<string, Promise<CachedDescription>>()

  constructor(private readonly options: ImageBridgeOptions) {}

  /** Cached (or in-flight) description for one durable attachment. */
  private descriptionFor(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<CachedDescription> {
    const id = ref.attachmentId
    const existing = this.cache.get(id)
    if (existing !== undefined) {
      // LRU refresh: re-insert at the tail.
      this.cache.delete(id)
      this.cache.set(id, existing)
      return existing
    }
    // Capture the producing model once per entry: the stamp attached to this
    // description stays the one that actually described it, even if the
    // settings change while the request is in flight or later on.
    const model = this.options.describeModel()
    const pending = (async (): Promise<CachedDescription> => {
      this.assertWithinImageLimits(ref)
      const stored = await this.options.attachments.readImage(ref, signal)
      const text = await this.options.describe(ref, stored.data, signal)
      return { model, text }
    })()
    if (this.cache.size >= this.options.maxCacheEntries()) {
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

  /**
   * Fail fast when a durable reference exceeds the deployment's current image
   * limits. The store validated the bytes at save time, but limits can tighten
   * afterwards, and base64-encoding a multi-megabyte raster only to die inside
   * the VL endpoint wastes memory and hides the cause. The store's limits are
   * the best public approximation of "what the pipeline can move" — the
   * harness exposes no downsampling seam, so oversized rasters are refused
   * with a stable code (`IMAGE_TOO_LARGE`) instead of being shipped.
   */
  private assertWithinImageLimits(ref: ImageAttachmentRef): void {
    const limits = this.options.attachments.imageLimits
    if (limits === undefined) return
    if (ref.bytes <= limits.maxImageBytes && ref.width * ref.height <= limits.maxImagePixels) return
    throw new LlmError(
      `image ${String(ref.attachmentId)} exceeds the deployment image limits`
      + ` (${ref.bytes} bytes, ${ref.width}x${ref.height} px; limits ${limits.maxImageBytes} bytes, ${limits.maxImagePixels} px)`,
      'IMAGE_TOO_LARGE',
    )
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
          text = formatDescription(block.attachment, description.text, description.model)
        } catch (error) {
          if (this.options.onFailure() === 'placeholder') {
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
