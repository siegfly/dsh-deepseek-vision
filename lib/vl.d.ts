/**
 * Minimal OpenAI-compatible chat-completions client for the vision-language
 * leg. One non-streaming request per image description; the main conversation
 * keeps streaming through the DeepSeek wire untouched.
 *
 * Wire contract: `POST {baseURL}/chat/completions` with an `image_url` data
 * URL part plus a text instruction. Every major Qwen-VL deployment (DashScope
 * compatible-mode, OpenRouter, self-hosted vLLM) serves this shape.
 *
 * @module dsh-vl-gateway/vl
 */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
/** Per-call connection facts for the VL endpoint, resolved by the plugin. */
export interface VlConnectionFacts {
    /** Bearer token resolved from the plugin's credential reference. */
    apiKey: string;
    /** Endpoint base; `/chat/completions` is appended. */
    baseURL: string;
    /** Wire model id the endpoint accepts (e.g. `qwen3-vl-flash`). */
    model: string;
    /** Text instruction sent beside the image. */
    describePrompt: string;
    /** Hard cap on one description request, in milliseconds. */
    timeoutMs: number;
}
/** One description request: the durable image reference plus its resolved bytes. */
export interface VlDescribeInput {
    ref: ImageAttachmentRef;
    data: Uint8Array;
    facts: VlConnectionFacts;
    /** Conversation cancellation; description failure follows it. */
    signal?: AbortSignal;
}
/**
 * Ask the configured VL model to describe one stored image.
 * @param input - reference, bytes, connection facts, and optional cancellation.
 * @returns the model's textual description (trimmed).
 * @throws {LlmError} with stable codes: `ABORTED`, `TIMEOUT`, `TRANSPORT`,
 *   `AUTH`, `RATE_LIMIT`, `INVALID_REQUEST`, `SERVER`, `HTTP_<status>`,
 *   `EMPTY_RESPONSE`.
 */
export declare function describeImage(input: VlDescribeInput): Promise<string>;
