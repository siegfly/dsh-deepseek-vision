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
    /** Live selector label captured again whenever the registration is replaced. */
    displayName;
    /** Capture the complete vision leg for one prepared dispatch. */
    prepareBridge;
    /** Live mode used by catalog queries and captured by prepared calls. */
    mode;
    constructor(config, bridge, displayName, prepareBridge, mode = () => 'native-first') {
        super(config);
        this.bridge = bridge;
        this.displayName = displayName;
        this.prepareBridge = prepareBridge;
        this.mode = mode;
    }
    providerInfo(provider) {
        return { id: provider, name: this.displayName() };
    }
    async listModels(provider) {
        const models = await super.listModels(provider);
        if (this.mode() === 'disabled')
            return models;
        return models.map(model => ({ ...model, inputModalities: GATEWAY_INPUT_MODALITIES }));
    }
    async resolveModel(provider, model, signal) {
        const info = await super.resolveModel(provider, model, signal);
        return this.mode() === 'disabled'
            ? info
            : { ...info, inputModalities: GATEWAY_INPUT_MODALITIES };
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
        const mode = this.mode();
        const bridge = this.prepareBridge();
        const describesImages = mode === 'always-describe'
            || (mode === 'native-first' && !acceptsImages);
        return {
            model: mode === 'disabled'
                ? prepared.model
                : { ...prepared.model, inputModalities: GATEWAY_INPUT_MODALITIES },
            stream: (options) => describesImages
                ? this.streamRewritten(prepared, options, bridge)
                : prepared.stream(options),
        };
    }
    /** Rewrite one text-only prepared request before its captured parent dispatch. */
    async *streamRewritten(prepared, options, bridge) {
        yield* prepared.stream(await this.bridge.rewrite(options, bridge));
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
        const mode = this.mode();
        const acceptsImages = await this.acceptsImagesNatively(options.provider, options.model);
        const describesImages = mode === 'always-describe'
            || (mode === 'native-first' && !acceptsImages);
        const rewritten = describesImages
            ? await this.bridge.rewrite(options, this.prepareBridge())
            : options;
        yield* super.stream(rewritten);
    }
}
