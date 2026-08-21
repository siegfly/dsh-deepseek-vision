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
/** The gateway genuinely consumes images (via the VL leg), so the claim is real. */
export const GATEWAY_INPUT_MODALITIES = ['text', 'image'];
/**
 * One gateway route: models the DeepSeek catalog declares image-capable stream
 * natively, while text-only models get every image described before dispatch.
 */
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
    async prepareCall(provider, model, signal) {
        const info = await this.resolveModel(provider, model, signal);
        return {
            model: info,
            stream: (options) => this.stream(options),
        };
    }
    /**
     * Whether the underlying DeepSeek catalog declares native image input for
     * this model. Read from the PARENT resolver (not the claim override), so the
     * passthrough decision is exactly the fact the parent's own stream uses
     * when it admits images — the two can never disagree.
     */
    async acceptsImagesNatively(provider, model) {
        const info = await super.resolveModel(provider, model);
        return info.inputModalities?.includes('image') === true;
    }
    async *stream(options) {
        const rewritten = await this.acceptsImagesNatively(options.provider, options.model)
            ? options
            : await this.bridge.rewrite(options);
        yield* super.stream(rewritten);
    }
}
