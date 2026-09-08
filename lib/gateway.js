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
     * Bind the route claim and bridge decision to the parent's prepared dispatch.
     * The parent captures its connection facts at preparation; re-entering
     * `stream()` here would pair this generation's model metadata with a later
     * settings generation.
     */
    async prepareCall(provider, model, signal) {
        const prepared = await super.prepareCall(provider, model, signal);
        const acceptsImages = prepared.model.inputModalities?.includes('image') === true;
        return {
            model: { ...prepared.model, inputModalities: GATEWAY_INPUT_MODALITIES },
            stream: (options) => acceptsImages
                ? prepared.stream(options)
                : this.streamRewritten(prepared, options),
        };
    }
    /** Rewrite one text-only prepared request before its captured parent dispatch. */
    async *streamRewritten(prepared, options) {
        yield* prepared.stream(await this.bridge.rewrite(options));
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
