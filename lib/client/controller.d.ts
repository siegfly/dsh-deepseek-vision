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
 * @module dsh-deepseek-vision/client/controller
 */
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import { type CardActions, type CardApi, type CardFieldState, type CardShell } from './form.js';
/** Host settings namespace the gateway plugin owns. */
export declare const GATEWAY_SETTINGS_NS = "llm-vl-gateway";
/** Credential reference the gateway resolves when the section names none. */
export declare const DEFAULT_VL_API_KEY_REF = "QWEN_VL_API_KEY";
/** The `vl` sub-section fields this card edits. */
export interface VlGatewayVlSection {
    apiKeyEnv?: string;
    baseURL?: string;
    model?: string;
    describePrompt?: string;
    timeoutMs?: number;
    maxCacheEntries?: number;
    onFailure?: 'fail' | 'placeholder';
}
/** The namespace section view this card reads (only the `vl` member is used). */
export interface VlGatewaySection {
    vl?: VlGatewayVlSection;
}
/** What the VL gateway card renders. */
export interface VlGatewayCardState extends CardShell {
    apiKeyEnv: CardFieldState;
    baseURL: CardFieldState;
    model: CardFieldState;
    describePrompt: CardFieldState;
    timeoutMs: CardFieldState;
    maxCacheEntries: CardFieldState;
    onFailure: CardFieldState;
    /** The staged credential, which starts blank on every load. */
    apiKey: CardFieldState;
    /** Whether the Host reports a credential configured for the referenced key. */
    apiKeyConfigured: boolean;
    /** Whether the credentials domain accepts a write for it; false disables the control. */
    apiKeyWritable: boolean;
}
/** The registration-side face the card's slot entry injects. */
export interface VlGatewayCardFace extends CardActions {
    hooks: {
        /** Card snapshot bound by the renderer as useVlGatewayCard. */
        vlGatewayCard: SnapshotStore<VlGatewayCardState>;
    };
}
/** Bridges the `llm-vl-gateway` scope and the credentials domain onto the card. */
export declare class VlGatewayCardController {
    private readonly scope;
    private readonly api;
    private readonly form;
    private readonly store;
    private credential;
    /**
     * @param scope - the bound settings scope for the `llm-vl-gateway` namespace.
     * @param api - wire face used for path-addressed settings writes and the credential.
     */
    constructor(scope: SettingsScope<VlGatewaySection>, api: CardApi);
    private projection;
    /**
     * Ask the credentials domain about the reference the section currently
     * names. A response is published only while it still answers for the
     * reference in force.
     */
    private readCredential;
    /** Re-read after the Host reports a change to the reference this card watches. */
    refreshCredential(ref: string): void;
    /** Build the face the card's slot registration injects. */
    inject(): VlGatewayCardFace;
    /** Write the staged key, then re-read whether the Host now holds one. */
    private writeKey;
}
