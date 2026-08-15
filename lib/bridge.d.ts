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
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
/** Failure policy when the VL description cannot be produced. */
export type VlFailurePolicy = 'fail' | 'placeholder';
/** Dependencies of the rewrite pipeline, supplied by the plugin glue. */
export interface ImageBridgeOptions {
    /** Durable byte resolver for image references. */
    attachments: AttachmentStore;
    /** Describe one image; throws LlmError on failure. */
    describe: (ref: ImageAttachmentRef, data: Uint8Array, signal?: AbortSignal) => Promise<string>;
    /** Current VL model id, stamped into the injected text for transparency. */
    describeModel: () => string;
    /** Bounded per-process cache capacity (one entry per unique attachment). */
    maxCacheEntries: () => number;
    /** `fail` throws (fail-closed); `placeholder` substitutes an error note. */
    onFailure: () => VlFailurePolicy;
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
export declare class ImageBridge {
    private readonly options;
    private readonly cache;
    constructor(options: ImageBridgeOptions);
    /** Cached (or in-flight) description for one durable attachment. */
    private descriptionFor;
    /**
     * Fail fast when a durable reference exceeds the deployment's current image
     * limits. The store validated the bytes at save time, but limits can tighten
     * afterwards, and base64-encoding a multi-megabyte raster only to die inside
     * the VL endpoint wastes memory and hides the cause. The store's limits are
     * the best public approximation of "what the pipeline can move" — the
     * harness exposes no downsampling seam, so oversized rasters are refused
     * with a stable code (`IMAGE_TOO_LARGE`) instead of being shipped.
     */
    private assertWithinImageLimits;
    /** Rewrite one content-block array, recursing into tool results. */
    private rewriteBlocks;
    /**
     * Rewrite one request. Returns the SAME options object when it carries no
     * images; otherwise a new envelope with rewritten (image-free) messages.
     * The original (often deep-frozen) request is never mutated.
     */
    rewrite(options: GenerateOptions): Promise<GenerateOptions>;
}
