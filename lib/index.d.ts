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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Config as DeepSeekSection } from '@deepseek-ai/dsh-llm-deepseek';
import type { VlFailurePolicy } from './bridge.js';
export declare const name = "llm-vl-gateway";
export declare const inject: string[];
export { VisionGatewayAdapter, GATEWAY_INPUT_MODALITIES } from './gateway.js';
export { ImageBridge } from './bridge.js';
export type { VlFailurePolicy, ImageBridgeOptions } from './bridge.js';
export { describeImage } from './vl.js';
export type { VlConnectionFacts, VlDescribeInput } from './vl.js';
/** The provider route this plugin owns (avoid `deepseek-official`, which llm-deepseek owns). */
export declare const DEFAULT_PROVIDER = "deepseek-vision";
/** Selector label shown in the web model picker. */
export declare const DEFAULT_DISPLAY_NAME = "DeepSeek + Vision";
/** Credential reference for the vision-language endpoint. */
export declare const DEFAULT_VL_API_KEY_ENV = "QWEN_VL_API_KEY";
/** DashScope OpenAI-compatible base; any `/chat/completions` gateway works. */
export declare const DEFAULT_VL_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
/** Qwen3-VL flash tier on the compatible endpoint: newest generation, lowest price. */
export declare const DEFAULT_VL_MODEL = "qwen3-vl-flash";
/** Hard cap on one description request. */
export declare const DEFAULT_VL_TIMEOUT_MS = 120000;
/** Bounded per-process description cache (one entry per unique attachment). */
export declare const DEFAULT_VL_MAX_CACHE_ENTRIES = 64;
/** Instruction sent beside each image; tune for your workload. */
export declare const DEFAULT_VL_DESCRIBE_PROMPT: string;
/** The vision-language leg of the plugin configuration. */
export interface VlSection {
    /** Credential reference (environment-variable name) resolved per request. */
    apiKeyEnv?: string;
    /** Endpoint base; `/chat/completions` is appended. */
    baseURL?: string;
    /** Wire model id the endpoint accepts. */
    model?: string;
    /** Instruction sent beside each image. */
    describePrompt?: string;
    /** Hard cap on one description request, in milliseconds. */
    timeoutMs?: number;
    /** Per-process description cache capacity. */
    maxCacheEntries?: number;
    /** `fail` fails the whole request when a description cannot be produced; `placeholder` substitutes an error note. */
    onFailure?: VlFailurePolicy;
}
/** Plugin configuration; doubles as the `llm-vl-gateway` settings-section shape. */
export interface Config {
    /** Registered provider route id; defaults to {@link DEFAULT_PROVIDER}. */
    provider?: string;
    /** Selector label; defaults to {@link DEFAULT_DISPLAY_NAME}. */
    displayName?: string;
    /**
     * The DeepSeek leg — the full `llm-deepseek` section shape (key reference,
     * base URL, thinking mode, catalog, retry policy). The gateway route serves
     * this catalog with image input claimed.
     */
    deepseek?: DeepSeekSection;
    /** The vision-language leg. */
    vl?: VlSection;
}
export declare const Config: z<Config>;
/**
 * Register the gateway provider route. Per-request connection facts for both
 * legs resolve lazily, so settings edits and credential rotations reach the
 * very next request without restarting anything.
 */
export declare function apply(ctx: Context, config: Config): void;
