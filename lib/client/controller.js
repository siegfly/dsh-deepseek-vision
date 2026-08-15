/**
 * The VL gateway card's staged form over the `llm-vl-gateway` settings
 * namespace. All fields live under the namespace's `vl` sub-section; the key
 * is the one control that does not live in the section — its literal never
 * rides a response, so the card learns only whether one is configured and
 * writes it through the credentials domain, addressed by the reference the
 * section names.
 *
 * Namespace and section shape are spelled here rather than imported: a client
 * package must not depend on a Host package (client bundle purity gate).
 *
 * @module dsh-vl-gateway/client/controller
 */
import { CardForm, choiceField, numberField, textField, } from './form.js';
/** Host settings namespace the gateway plugin owns. */
export const GATEWAY_SETTINGS_NS = 'llm-vl-gateway';
/** Credential reference the gateway resolves when the section names none. */
export const DEFAULT_VL_API_KEY_REF = 'QWEN_VL_API_KEY';
/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey';
/** Bridges the `llm-vl-gateway` scope and the credentials domain onto the card. */
export class VlGatewayCardController {
    scope;
    api;
    form;
    store;
    credential = { ref: '', configured: false, writable: true };
    /**
     * @param scope - the bound settings scope for the `llm-vl-gateway` namespace.
     * @param api - wire face used for path-addressed settings writes and the credential.
     */
    constructor(scope, api) {
        this.scope = scope;
        this.api = api;
        this.form = new CardForm(scope, api, GATEWAY_SETTINGS_NS, [
            textField('apiKeyEnv', ['vl', 'apiKeyEnv']),
            textField('baseURL', ['vl', 'baseURL']),
            textField('model', ['vl', 'model']),
            textField('describePrompt', ['vl', 'describePrompt']),
            numberField('timeoutMs', ['vl', 'timeoutMs']),
            numberField('maxCacheEntries', ['vl', 'maxCacheEntries']),
            choiceField('onFailure', ['vl', 'onFailure'], ['fail', 'placeholder']),
        ], [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }]);
        this.store = this.form.bind(() => this.projection());
        scope.subscribe(() => { void this.readCredential(); });
        void this.readCredential();
    }
    projection() {
        return {
            ...this.form.shell(),
            apiKeyEnv: this.form.field('apiKeyEnv'),
            baseURL: this.form.field('baseURL'),
            model: this.form.field('model'),
            describePrompt: this.form.field('describePrompt'),
            timeoutMs: this.form.field('timeoutMs'),
            maxCacheEntries: this.form.field('maxCacheEntries'),
            onFailure: this.form.field('onFailure'),
            apiKey: this.form.field(API_KEY_FIELD),
            apiKeyConfigured: this.credential.configured,
            apiKeyWritable: this.credential.writable,
        };
    }
    /**
     * Ask the credentials domain about the reference the section currently
     * names. A response is published only while it still answers for the
     * reference in force.
     */
    async readCredential() {
        const ref = refOf(this.scope.getSnapshot());
        if (ref !== this.credential.ref) {
            this.credential = { ref, configured: false, writable: true };
            this.store.set(this.projection());
        }
        try {
            const response = await this.api.credentials.describe({ refs: [ref] });
            if (!response.result.ok || ref !== refOf(this.scope.getSnapshot()))
                return;
            const view = response.result.value.credentials[ref];
            const next = {
                ref,
                configured: view?.configured ?? false,
                writable: view?.writable ?? true,
            };
            if (next.configured === this.credential.configured && next.writable === this.credential.writable)
                return;
            this.credential = next;
            this.store.set(this.projection());
        }
        catch {
            // The card stays usable without this; a write still reaches the Host.
        }
    }
    /** Re-read after the Host reports a change to the reference this card watches. */
    refreshCredential(ref) {
        if (ref !== this.credential.ref)
            return;
        void this.readCredential();
    }
    /** Build the face the card's slot registration injects. */
    inject() {
        return { hooks: { vlGatewayCard: this.store }, ...this.form.actions() };
    }
    /** Write the staged key, then re-read whether the Host now holds one. */
    async writeKey(value) {
        try {
            await this.api.credentials.set({ ref: refOf(this.scope.getSnapshot()), value });
        }
        catch {
            // Refusals surface through the re-read below.
        }
        await this.readCredential();
        return this.credential.configured;
    }
}
/** The credential reference the section names, or the gateway default. */
function refOf(snapshot) {
    const declared = snapshot.value?.vl?.apiKeyEnv;
    return declared !== undefined && declared.length > 0 ? declared : DEFAULT_VL_API_KEY_REF;
}
