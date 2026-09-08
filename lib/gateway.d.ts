/**
 * The gateway adapter: a DeepSeek adapter that CLAIMS image input so the
 * apiproxy admission gates (`session.prompt`, `session.selectModel`) accept
 * pasted images, then serves each model according to what the DeepSeek
 * catalog declares:
 *
 * - Models the catalog declares image-capable (official
 *   `deepseek-v4-flash-vision-exp`) keep their images: the request passes
 *   through untouched and the parent serializes them natively.
 * - Text-only and uncatalogued models get the description bridge: every
 *   image is rewritten to text before the text-only DeepSeek wire is reached.
 *
 * Everything else — wire serialization, SSE parsing, reasoning efforts,
 * context windows, retry policy, idle watchdogs — is inherited from the
 * exported `DeepSeekAdapter` class.
 *
 * @module dsh-deepseek-vision/gateway
 */
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek';
import type { DeepSeekAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ImageBridge } from './bridge.js';
import type { ImageBridgeGeneration } from './bridge.js';
/** The gateway genuinely consumes images (via the VL leg), so the claim is real. */
export declare const GATEWAY_INPUT_MODALITIES: readonly ["text", "image"];
/** How this route treats image input. */
export type VisionFallbackMode = 'native-first' | 'always-describe' | 'disabled';
/**
 * One gateway route: models the DeepSeek catalog declares image-capable stream
 * natively, while text-only models get every image described before dispatch.
 */
export declare class VisionGatewayAdapter extends DeepSeekAdapter {
    private readonly bridge;
    /** Live selector label captured again whenever the registration is replaced. */
    private readonly displayName;
    /** Capture the complete vision leg for one prepared dispatch. */
    private readonly prepareBridge;
    /** Live mode used by catalog queries and captured by prepared calls. */
    private readonly mode;
    constructor(config: DeepSeekAdapterOptions, bridge: ImageBridge, displayName: () => string, prepareBridge: () => ImageBridgeGeneration, mode?: () => VisionFallbackMode);
    providerInfo(provider: string): LlmProviderInfo;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    /**
     * Bind the route claim and bridge decision to the parent's prepared dispatch.
     * The parent captures its connection facts at preparation; re-entering
     * `stream()` here would pair this generation's model metadata with a later
     * settings generation.
     */
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>;
    /** Rewrite one text-only prepared request before its captured parent dispatch. */
    private streamRewritten;
    /**
     * Whether the underlying DeepSeek catalog declares native image input for
     * this model. Read from the PARENT resolver (not the claim override), so the
     * passthrough decision is exactly the fact the parent's own stream uses
     * when it admits images — the two can never disagree.
     */
    private acceptsImagesNatively;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
