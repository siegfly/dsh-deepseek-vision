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
import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm';
/** Map an HTTP status to a stable harness error code (mirrors llm-deepseek). */
function statusCode(status) {
    if (status === 401 || status === 403)
        return 'AUTH';
    if (status === 429)
        return 'RATE_LIMIT';
    if (status === 400)
        return 'INVALID_REQUEST';
    if (status >= 500)
        return 'SERVER';
    return `HTTP_${status}`;
}
/** Extract one textual description from a provider response `content` field. */
function extractText(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return undefined;
    const parts = content.map((part) => {
        if (typeof part !== 'object' || part === null)
            return '';
        const text = part.text;
        return typeof text === 'string' ? text : '';
    });
    const text = parts.join('');
    return text.length > 0 ? text : undefined;
}
/**
 * Ask the configured VL model to describe one stored image.
 * @param input - reference, bytes, connection facts, and optional cancellation.
 * @returns the model's textual description (trimmed).
 * @throws {LlmError} with stable codes: `ABORTED`, `TIMEOUT`, `TRANSPORT`,
 *   `AUTH`, `RATE_LIMIT`, `INVALID_REQUEST`, `SERVER`, `HTTP_<status>`,
 *   `EMPTY_RESPONSE`.
 */
export async function describeImage(input) {
    const { ref, data, facts, signal } = input;
    const dataUrl = `data:${ref.mediaType};base64,${Buffer.from(data).toString('base64')}`;
    const timeout = AbortSignal.timeout(facts.timeoutMs);
    const upstream = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    let response;
    try {
        response = await fetch(`${facts.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${facts.apiKey}`,
                'content-type': 'application/json',
                accept: 'application/json',
                ...attributionHeaders(),
            },
            body: JSON.stringify({
                model: facts.model,
                stream: false,
                messages: [{
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: dataUrl } },
                            { type: 'text', text: facts.describePrompt },
                        ],
                    }],
            }),
            signal: upstream,
        });
    }
    catch (error) {
        if (signal?.aborted) {
            throw new LlmError('vision description aborted by caller', 'ABORTED', { cause: error });
        }
        if (upstream.aborted) {
            throw new LlmError(`vision description timed out after ${facts.timeoutMs}ms (model ${facts.model})`, 'TIMEOUT', { cause: error });
        }
        throw new LlmError(`vision request to ${facts.baseURL} failed`, 'TRANSPORT', { cause: error });
    }
    if (!response.ok) {
        let message = `vision API error (HTTP ${response.status})`;
        try {
            const parsed = await response.json();
            if (typeof parsed.error?.message === 'string' && parsed.error.message.length > 0) {
                message = parsed.error.message;
            }
        }
        catch {
            // A malformed error body must not mask the HTTP status.
        }
        throw new LlmError(message, statusCode(response.status), { status: response.status });
    }
    let payload;
    try {
        payload = await response.json();
    }
    catch (error) {
        throw new LlmError(`vision API returned an unreadable body for model ${facts.model}`, 'EMPTY_RESPONSE', { cause: error });
    }
    const description = extractText(payload.choices?.[0]?.message?.content);
    if (description === undefined || description.trim().length === 0) {
        throw new LlmError(`vision model ${facts.model} returned no textual description`, 'EMPTY_RESPONSE');
    }
    return description.trim();
}
