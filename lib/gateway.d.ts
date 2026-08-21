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
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ImageBridge } from './bridge.js';
/** The gateway genuinely consumes images (via the VL leg), so the claim is real. */
export declare const GATEWAY_INPUT_MODALITIES: readonly ["text", "image"];
/** One generation: exact model metadata bound to its eventual stream call. */
interface PreparedGatewayCall {
    model: LlmResolvedModelInfo;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/**
 * One gateway route: models the DeepSeek catalog declares image-capable stream
 * natively, while text-only models get every image described before dispatch.
 */
export declare class VisionGatewayAdapter extends DeepSeekAdapter {
    private readonly bridge;
    /**
     * Live selector label. The registry captures `providerInfo` at
     * registration, so a rename reaches `listProviders()` only through
     * `registration.replace()`; this thunk makes that re-capture read the
     * name in force, not the one from construction.
     */
    private readonly displayName;
    constructor(config: DeepSeekAdapterOptions, bridge: ImageBridge, 
    /**
     * Live selector label. The registry captures `providerInfo` at
     * registration, so a rename reaches `listProviders()` only through
     * `registration.replace()`; this thunk makes that re-capture read the
     * name in force, not the one from construction.
     */
    displayName: () => string);
    providerInfo(provider: string): LlmProviderInfo;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    /**
     * One generation bound to its eventual stream call.
     *
     * dsh 0.1.1-rc.2 changed BOTH generation-binding seams of the parent's
     * `prepareCall`, and each one would silently break this route if left
     * inherited:
     *
     * 1. The parent's generation now resolves through `modelInfoFor()` directly
     *    instead of the virtual `resolveModel` (the rc.1 base class called the
     *    virtual), and the llm runtime projects images to placeholder text for
     *    any call-prep result whose `inputModalities` exclude image — so a
     *    claim made only in `resolveModel`/`listModels` would be bypassed and
     *    this route's images would never reach the bridge.
     * 2. The parent binds the dispatch to `streamWithConnection` directly
     *    instead of the virtual `stream()`, so the bridge/passthrough decision
     *    in this adapter's `stream()` would never run and a text-only model's
     *    image would die in the parent's `UNSUPPORTED_CONTENT` admission gate.
     *
     * The parent's `prepareCall` (and its `PreparedAdapterCall` type) only
     * exists on rc.2 hosts, so this override rebuilds the generation the way
     * the rc.1 base `LlmAdapter.prepareCall` did — virtual `resolveModel` (the
     * route's image claim) plus virtual `stream()` (the passthrough/bridge
     * decision) — which is exactly the behavior this plugin was built against,
     * and compiles against both rc.1 and rc.2 types.
     */
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedGatewayCall>;
    /**
     * Whether the underlying DeepSeek catalog declares native image input for
     * this model. Read from the PARENT resolver (not the claim override), so the
     * passthrough decision is exactly the fact the parent's own stream uses
     * when it admits images — the two can never disagree.
     */
    private acceptsImagesNatively;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
export {};
