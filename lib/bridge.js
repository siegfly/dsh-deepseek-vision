/**
 * Image-to-text request projection for text-only model routes.
 *
 * Every prepared gateway call supplies an immutable generation, so settings
 * changes affect the next call rather than a call between capability
 * resolution and dispatch. Successful descriptions are shared by their full
 * projection identity; concurrent callers retain independent cancellation.
 *
 * @module dsh-deepseek-vision/bridge
 */
import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm';
function formatDescription(ref, description) {
    const name = ref.name === undefined ? '' : ` ${ref.name}`;
    return `[Image:${name} ${ref.mediaType} ${ref.width}x${ref.height} — described by ${description.model}]\n${description.text}`;
}
function failureCode(error) {
    return error instanceof LlmError ? error.code : 'VL_DESCRIPTION_FAILED';
}
/** Await a shared operation without allowing one caller to cancel another. */
async function waitForPending(pending, signal) {
    pending.waiters += 1;
    let onAbort;
    try {
        if (signal === undefined)
            return await pending.promise;
        signal.throwIfAborted();
        const cancelled = new Promise((_resolve, reject) => {
            onAbort = () => reject(signal.reason);
            signal.addEventListener('abort', onAbort, { once: true });
        });
        return await Promise.race([pending.promise, cancelled]);
    }
    finally {
        if (onAbort !== undefined)
            signal?.removeEventListener('abort', onAbort);
        pending.waiters -= 1;
        if (!pending.settled && pending.waiters === 0)
            pending.controller.abort();
    }
}
/** Prepared-call-aware image projection and successful-result cache. */
export class ImageBridge {
    options;
    cache = new Map();
    inFlight = new Map();
    constructor(options) {
        this.options = options;
    }
    cacheKey(ref, generation) {
        return `${generation.cacheIdentity}\u0000${String(ref.attachmentId)}`;
    }
    assertWithinDeploymentLimits(ref) {
        const limits = this.options.attachments.imageLimits;
        if (limits === undefined)
            return;
        const withinSide = limits.maxImageDimension === undefined
            || (ref.width <= limits.maxImageDimension && ref.height <= limits.maxImageDimension);
        if (ref.bytes <= limits.maxImageBytes
            && ref.width * ref.height <= limits.maxImagePixels
            && withinSide)
            return;
        throw new LlmError(`image ${String(ref.attachmentId)} exceeds the deployment image limits`, 'IMAGE_TOO_LARGE');
    }
    remember(key, value, capacity) {
        this.cache.delete(key);
        while (this.cache.size >= capacity) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined)
                break;
            this.cache.delete(oldest);
        }
        this.cache.set(key, value);
    }
    descriptionFor(ref, generation, signal) {
        const key = this.cacheKey(ref, generation);
        const cached = this.cache.get(key);
        if (cached !== undefined) {
            this.cache.delete(key);
            this.cache.set(key, cached);
            return Promise.resolve(cached);
        }
        const shared = this.inFlight.get(key);
        if (shared !== undefined)
            return waitForPending(shared, signal);
        const controller = new AbortController();
        const pending = {};
        pending.controller = controller;
        pending.waiters = 0;
        pending.settled = false;
        pending.promise = (async () => {
            this.assertWithinDeploymentLimits(ref);
            const image = await this.options.attachments.readImageRequest(ref, generation.imagePolicy, controller.signal);
            const text = await generation.describe(ref, image, controller.signal);
            const value = { model: generation.model, text };
            this.remember(key, value, generation.maxCacheEntries);
            return value;
        })().finally(() => {
            pending.settled = true;
            if (this.inFlight.get(key) === pending)
                this.inFlight.delete(key);
        });
        void pending.promise.catch(() => { });
        this.inFlight.set(key, pending);
        return waitForPending(pending, signal);
    }
    async rewriteBlocks(blocks, generation, signal) {
        const out = [];
        for (const block of blocks) {
            if (block.type === 'image') {
                let text;
                try {
                    const description = await this.descriptionFor(block.attachment, generation, signal);
                    text = formatDescription(block.attachment, description);
                }
                catch (error) {
                    if (generation.onFailure === 'placeholder') {
                        text = `[Image: ${block.attachment.mediaType} — description unavailable (${failureCode(error)})]`;
                    }
                    else {
                        if (error instanceof LlmError)
                            throw error;
                        signal?.throwIfAborted();
                        throw new LlmError(`failed to describe image ${String(block.attachment.attachmentId)}`, 'VL_DESCRIPTION_FAILED', { cause: error });
                    }
                }
                out.push({ type: 'text', text });
                continue;
            }
            if (block.type === 'tool-result') {
                out.push({ ...block, content: await this.rewriteBlocks(block.content, generation, signal) });
                continue;
            }
            out.push(block);
        }
        return out;
    }
    /** Rewrite one request without mutating the durable or frozen source. */
    async rewrite(options, generation) {
        if (!options.messages.some(message => contentHasImage(message.content)))
            return options;
        const messages = [];
        for (const message of options.messages) {
            if (!contentHasImage(message.content)) {
                messages.push(message);
                continue;
            }
            messages.push({
                ...message,
                content: await this.rewriteBlocks(message.content, generation, options.signal),
            });
        }
        return { ...options, messages };
    }
}
