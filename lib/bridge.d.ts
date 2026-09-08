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
import type { AttachmentStore, ImageAttachmentRef, ImageRequestPolicy, RequestImageAttachment } from '@deepseek-ai/dsh-attachment';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
export type VlFailurePolicy = 'fail' | 'placeholder';
/** Complete VL projection facts captured for one prepared call. */
export interface ImageBridgeGeneration {
    /** Stable identity covering endpoint, model, prompt, limits, and protocol. */
    cacheIdentity: string;
    /** Model id stamped into the model-visible replacement. */
    model: string;
    /** DSH-owned deterministic request-image projection. */
    imagePolicy: ImageRequestPolicy;
    maxCacheEntries: number;
    onFailure: VlFailurePolicy;
    describe: (ref: ImageAttachmentRef, image: RequestImageAttachment, signal?: AbortSignal) => Promise<string>;
}
export interface ImageBridgeOptions {
    attachments: AttachmentStore;
}
/** Prepared-call-aware image projection and successful-result cache. */
export declare class ImageBridge {
    private readonly options;
    private readonly cache;
    private readonly inFlight;
    constructor(options: ImageBridgeOptions);
    private cacheKey;
    private assertWithinDeploymentLimits;
    private remember;
    private descriptionFor;
    private rewriteBlocks;
    /** Rewrite one request without mutating the durable or frozen source. */
    rewrite(options: GenerateOptions, generation: ImageBridgeGeneration): Promise<GenerateOptions>;
}
