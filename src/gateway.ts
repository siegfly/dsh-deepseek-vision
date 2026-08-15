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

import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { ImageBridge } from './bridge.js'

/** The gateway genuinely consumes images (via the VL leg), so the claim is real. */
export const GATEWAY_INPUT_MODALITIES = ['text', 'image'] as const

/** A DeepSeek route that transparently describes images before dispatch. */
export class VisionGatewayAdapter extends DeepSeekAdapter {
  constructor(
    config: DeepSeekAdapterOptions,
    private readonly bridge: ImageBridge,
    /**
     * Live selector label. The registry captures `providerInfo` at
     * registration, so a rename reaches `listProviders()` only through
     * `registration.replace()`; this thunk makes that re-capture read the
     * name in force, not the one from construction.
     */
    private readonly displayName: () => string,
  ) {
    super(config)
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.displayName() }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const models = await super.listModels(provider)
    return models.map(model => ({ ...model, inputModalities: GATEWAY_INPUT_MODALITIES }))
  }

  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const info = await super.resolveModel(provider, model, signal)
    return { ...info, inputModalities: GATEWAY_INPUT_MODALITIES }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const rewritten = await this.bridge.rewrite(options)
    yield* super.stream(rewritten)
  }
}
