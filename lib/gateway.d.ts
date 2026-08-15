/**
 * The gateway adapter: a DeepSeek adapter that CLAIMS image input so the
 * apiproxy admission gates (`session.prompt`, `session.selectModel`) accept
 * pasted images, then rewrites those images to text before the text-only
 * DeepSeek wire is reached.
 *
 * Everything else — wire serialization, SSE parsing, reasoning efforts,
 * context windows, retry policy, idle watchdogs — is inherited from the
 * exported `DeepSeekAdapter` class.
 *
 * @module dsh-vl-gateway/gateway
 */
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek';
import type { DeepSeekAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ImageBridge } from './bridge.js';
/** The gateway genuinely consumes images (via the VL leg), so the claim is real. */
export declare const GATEWAY_INPUT_MODALITIES: readonly ["text", "image"];
/** A DeepSeek route that transparently describes images before dispatch. */
export declare class VisionGatewayAdapter extends DeepSeekAdapter {
    private readonly bridge;
    private readonly displayName;
    constructor(config: DeepSeekAdapterOptions, bridge: ImageBridge, displayName: string);
    providerInfo(provider: string): LlmProviderInfo;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
