/**
 * Dictionary namespace owned by the VL gateway client plugin. The merge into
 * `LocaleNamespaceMap` is what types `PropsLocale<'vl-gateway'>` and
 * `ctx.locale.bind(NS)`.
 *
 * @module dsh-deepseek-vision/client/locales
 */
export declare const NS = "vl-gateway";
/** Locale keys this card renders. */
export type VlGatewayLocaleKey = 'title' | 'description' | 'apiKey' | 'apiKeyHint' | 'apiKeySet' | 'apiKeyUnset' | 'apiKeyEnv' | 'apiKeyEnvHint' | 'baseURL' | 'baseURLHint' | 'model' | 'modelHint' | 'describePrompt' | 'describePromptHint' | 'timeoutMs' | 'timeoutMsHint' | 'maxCacheEntries' | 'maxCacheEntriesHint' | 'onFailure' | 'onFailureHint' | 'overridden' | 'reset' | 'invalidNumber' | 'invalidChoice' | 'save' | 'discard' | 'saving' | 'saveFailed';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'vl-gateway': VlGatewayLocaleKey;
    }
}
export declare const zh: Record<VlGatewayLocaleKey, string>;
export declare const en: Record<VlGatewayLocaleKey, string>;
