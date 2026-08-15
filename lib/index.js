/**
 * dsh-vl-gateway — an out-of-tree dsh provider plugin.
 *
 * Registers one new LLM provider route (`deepseek-vision` by default) that
 * serves the DeepSeek catalog while CLAIMING image input. When a request
 * reaches the route with image blocks (pasted into the chat window, or nested
 * in tool results), each image is first described by a configured
 * vision-language model (Qwen-VL by default, any OpenAI-compatible
 * `/chat/completions` endpoint), and the description text replaces the image
 * before the text-only DeepSeek wire is called.
 *
 * Composition: add a row `{ id: llm-vl-gateway, name: dsh-vl-gateway }` to a
 * profile patch layer (see README), then select the `DeepSeek + Vision`
 * provider in the web Models page.
 *
 * @module dsh-vl-gateway
 */
import z from '@deepseek-ai/schemastery';
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm';
import { resolveAdapterOptions, Config as DeepSeekSectionSchema, } from '@deepseek-ai/dsh-llm-deepseek';
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';
import { describeImage } from './vl.js';
import { ImageBridge } from './bridge.js';
import { VisionGatewayAdapter } from './gateway.js';
export const name = 'llm-vl-gateway';
export const inject = ['llm', 'attachments'];
export { VisionGatewayAdapter, GATEWAY_INPUT_MODALITIES } from './gateway.js';
export { ImageBridge } from './bridge.js';
export { describeImage } from './vl.js';
const NS = settingsNamespace('llm-vl-gateway');
/** The provider route this plugin owns (avoid `deepseek-official`, which llm-deepseek owns). */
export const DEFAULT_PROVIDER = 'deepseek-vision';
/** Selector label shown in the web model picker. */
export const DEFAULT_DISPLAY_NAME = 'DeepSeek + Vision';
/** Credential reference for the vision-language endpoint. */
export const DEFAULT_VL_API_KEY_ENV = 'QWEN_VL_API_KEY';
/** DashScope OpenAI-compatible base; any `/chat/completions` gateway works. */
export const DEFAULT_VL_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
/** Qwen's flagship VL model on the compatible endpoint. */
export const DEFAULT_VL_MODEL = 'qwen-vl-max';
/** Hard cap on one description request. */
export const DEFAULT_VL_TIMEOUT_MS = 120_000;
/** Bounded per-process description cache (one entry per unique attachment). */
export const DEFAULT_VL_MAX_CACHE_ENTRIES = 64;
/** Instruction sent beside each image; tune for your workload. */
export const DEFAULT_VL_DESCRIBE_PROMPT = [
    'Describe this image in detail so a text-only model can reason about it.',
    'Reproduce any visible text verbatim: code, error messages, logs, UI labels, diagrams, tables.',
    'Describe the visual layout and any element relationships that matter.',
    'Reply in the language the user is most likely using, with no preamble.',
].join(' ');
const vlSectionSchema = z.object({
    apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_VL_API_KEY_ENV),
    baseURL: z.string().default(DEFAULT_VL_BASE_URL),
    model: z.string().default(DEFAULT_VL_MODEL),
    describePrompt: z.string().default(DEFAULT_VL_DESCRIBE_PROMPT),
    timeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_VL_TIMEOUT_MS),
    maxCacheEntries: z.number().step(1).min(1).max(100_000).default(DEFAULT_VL_MAX_CACHE_ENTRIES),
    onFailure: z.union(['fail', 'placeholder']).default('fail'),
});
export const Config = z.object({
    provider: z.string(),
    displayName: z.string(),
    deepseek: DeepSeekSectionSchema.default({}),
    vl: vlSectionSchema.default({
        apiKeyEnv: DEFAULT_VL_API_KEY_ENV,
        baseURL: DEFAULT_VL_BASE_URL,
        model: DEFAULT_VL_MODEL,
        describePrompt: DEFAULT_VL_DESCRIBE_PROMPT,
        timeoutMs: DEFAULT_VL_TIMEOUT_MS,
        maxCacheEntries: DEFAULT_VL_MAX_CACHE_ENTRIES,
        onFailure: 'fail',
    }),
});
/** Materialize the vision-leg section with every default resolved. */
function resolveVlSection(raw) {
    // The schema materializes defaults; these guard programmatic construction.
    const section = raw.vl ?? {};
    return {
        apiKeyEnv: section.apiKeyEnv ?? DEFAULT_VL_API_KEY_ENV,
        baseURL: section.baseURL ?? DEFAULT_VL_BASE_URL,
        model: section.model ?? DEFAULT_VL_MODEL,
        describePrompt: section.describePrompt ?? DEFAULT_VL_DESCRIBE_PROMPT,
        timeoutMs: section.timeoutMs ?? DEFAULT_VL_TIMEOUT_MS,
        maxCacheEntries: section.maxCacheEntries ?? DEFAULT_VL_MAX_CACHE_ENTRIES,
        onFailure: section.onFailure ?? 'fail',
    };
}
/**
 * Register the gateway provider route. Per-request connection facts for both
 * legs resolve lazily, so settings edits and credential rotations reach the
 * very next request without restarting anything.
 */
export function apply(ctx, config) {
    const provider = (config.provider ?? DEFAULT_PROVIDER).trim();
    if (provider.length === 0)
        throw new Error('llm-vl-gateway: provider must be non-empty');
    const displayName = (config.displayName ?? '').trim() || DEFAULT_DISPLAY_NAME;
    // Settings (when mounted) replace the composition entry; everything below
    // reads through this thunk so live snapshots flow into both legs.
    let current = () => config;
    let lastRaw;
    let lastGood;
    const connectionOptions = () => {
        const raw = current().deepseek ?? {};
        if (raw === lastRaw && lastGood !== undefined)
            return lastGood;
        try {
            const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx));
            lastRaw = raw;
            lastGood = next;
            return next;
        }
        catch (error) {
            // Only a live settings snapshot can fail here (static composition
            // resolved before anything registered); keep serving the last good
            // facts and say so once per bad snapshot.
            if (lastGood === undefined)
                throw error;
            lastRaw = raw;
            ctx.logger.error('llm-vl-gateway: keeping the last good DeepSeek configuration after an invalid settings section');
            ctx.logger.error(error);
            return lastGood;
        }
    };
    const resolveApiKey = async (connection) => {
        const ref = connection.apiKeyEnv;
        const credentials = ctx.get('credentials');
        if (credentials !== undefined) {
            const hit = await credentials.resolve(ref);
            if (hit !== undefined)
                return assertUsableApiKey(hit.value, 'llm-vl-gateway', ref);
        }
        else {
            const ambient = launchEnvironmentOf(ctx).get(ref);
            if (ambient !== undefined && ambient.value.length > 0) {
                return assertUsableApiKey(ambient.value, 'llm-vl-gateway', ref);
            }
        }
        throw new LlmError(`llm-vl-gateway: no API key for provider route "${provider}"; store ${ref} through the`
            + ` credentials service (the web Models page writes it) or export ${ref} in the launching environment`, 'MISSING_CREDENTIAL');
    };
    const resolveVlApiKey = async (ref) => {
        const credential = credentialRef(ref);
        const credentials = ctx.get('credentials');
        if (credentials !== undefined) {
            const hit = await credentials.resolve(credential);
            if (hit !== undefined)
                return assertUsableApiKey(hit.value, 'llm-vl-gateway', credential);
        }
        else {
            const ambient = launchEnvironmentOf(ctx).get(credential);
            if (ambient !== undefined && ambient.value.length > 0) {
                return assertUsableApiKey(ambient.value, 'llm-vl-gateway', credential);
            }
        }
        throw new LlmError(`llm-vl-gateway: no API key for the vision model; store ${ref} through the credentials`
            + ` service or export ${ref} in the launching environment`, 'MISSING_CREDENTIAL');
    };
    let userId;
    const resolveUserId = () => userId ??= getOrCreateAnonymousUserId();
    const vlFacts = async () => {
        const section = resolveVlSection(current());
        return {
            apiKey: await resolveVlApiKey(section.apiKeyEnv),
            baseURL: section.baseURL,
            model: section.model,
            describePrompt: section.describePrompt,
            timeoutMs: section.timeoutMs,
        };
    };
    const bridge = new ImageBridge({
        attachments: ctx.attachments,
        describe: async (ref, data, signal) => {
            const facts = await vlFacts();
            return describeImage({ ref, data, facts, signal });
        },
        describeModel: () => resolveVlSection(current()).model,
        maxCacheEntries: resolveVlSection(current()).maxCacheEntries,
        onFailure: resolveVlSection(current()).onFailure,
    });
    const adapter = new VisionGatewayAdapter({ options: connectionOptions, resolveApiKey, resolveUserId }, bridge, displayName);
    ctx.llm.registerConfigurableProviders([
        { provider, displayName, settingsNs: NS, settingsPath: ['deepseek'] },
    ]);
    const registration = ctx.llm.registerAdapter([provider], adapter);
    let registeredPolicy = connectionOptions().retryPolicy;
    const ensureRegistrationFacts = () => {
        const policy = connectionOptions().retryPolicy;
        if (deepEqualJson(policy, registeredPolicy))
            return;
        registration.replace([provider]);
        registeredPolicy = policy;
    };
    installSettingsSection(ctx, NS, Config, config, {
        setSource: (source) => {
            current = source;
        },
        onChange: ensureRegistrationFacts,
    });
}
