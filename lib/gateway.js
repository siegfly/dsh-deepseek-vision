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
 * @module dsh-deepseek-vision/gateway
 */
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek';
/** The gateway genuinely consumes images (via the VL leg), so the claim is real. */
export const GATEWAY_INPUT_MODALITIES = ['text', 'image'];
/** A DeepSeek route that transparently describes images before dispatch. */
export class VisionGatewayAdapter extends DeepSeekAdapter {
    bridge;
    displayName;
    constructor(config, bridge, 
    /**
     * Live selector label. The registry captures `providerInfo` at
     * registration, so a rename reaches `listProviders()` only through
     * `registration.replace()`; this thunk makes that re-capture read the
     * name in force, not the one from construction.
     */
    displayName) {
        super(config);
        this.bridge = bridge;
        this.displayName = displayName;
    }
    providerInfo(provider) {
        return { id: provider, name: this.displayName() };
    }
    async listModels(provider) {
        const models = await super.listModels(provider);
        return models.map(model => ({ ...model, inputModalities: GATEWAY_INPUT_MODALITIES }));
    }
    async resolveModel(provider, model, signal) {
        const info = await super.resolveModel(provider, model, signal);
        return { ...info, inputModalities: GATEWAY_INPUT_MODALITIES };
    }
    async *stream(options) {
        const rewritten = await this.bridge.rewrite(options);
        yield* super.stream(rewritten);
    }
}
