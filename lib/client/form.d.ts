/**
 * Compact card form model for the VL gateway settings card.
 *
 * This mirrors the official `dsh-client-ui-settings-plugins` card-form model
 * (staged drafts, presence marks overrides, invalid drafts block the save) —
 * an out-of-tree client bundle cannot import the in-box module (client bundle
 * purity gate: cross-plugin value imports are forbidden), so the model lives
 * here with one adaptation: this card's fields live under the `vl` sub-section
 * of the `llm-vl-gateway` namespace, so writes are path-addressed through
 * `api.settings.mutate` (the client `SettingsScope.set` addresses only
 * root-level scalar fields).
 *
 * @module dsh-vl-gateway/client/form
 */
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { CardActions, CardFieldState, CardSecretSpec, CardShell } from '@deepseek-ai/dsh-client-ui-settings-plugins/client';
export type { CardActions, CardFieldState, CardSecretSpec, CardShell };
/** Wire face the card writes through: path-addressed settings + credentials. */
export type CardApi = Pick<ConnectionHandle['api'], 'credentials' | 'settings'>;
/** The write one field's staged text performs when the card is saved. */
export type FieldWrite = {
    kind: 'set';
    value: unknown;
} | {
    kind: 'clear';
};
/** How one section field converts between its stored value and its draft text. */
export interface CardFieldSpec {
    /** Field name addressing this control inside the card's form. */
    field: string;
    /** Settings path of the value inside the namespace section (e.g. `['vl', 'model']`). */
    path: readonly string[];
    /** Render a stored value as draft text; the empty string when the section carries none. */
    format: (value: unknown) => string;
    /** The write this draft text stages, or undefined when the text is not a value this field accepts. */
    parse: (text: string) => FieldWrite | undefined;
}
/** A free-text field; an empty draft clears the field. */
export declare function textField(field: string, path: readonly string[]): CardFieldSpec;
/** A whole-number field; an empty draft clears, any other non-finite draft blocks the save. */
export declare function numberField(field: string, path: readonly string[]): CardFieldSpec;
/** A fixed-choice field; a draft outside the choice set blocks the save. */
export declare function choiceField(field: string, path: readonly string[], choices: readonly string[]): CardFieldSpec;
/**
 * Stages one card's edits over one settings namespace and writes them on save.
 * Field writes are path-addressed `settings.mutate` ops against the namespace;
 * the Host response is authoritative — an accepted write clears its draft, a
 * refused one keeps it so the user can correct it.
 */
export declare class CardForm<T> {
    private readonly scope;
    private readonly api;
    private readonly ns;
    private readonly specs;
    private readonly secretSpecs;
    private readonly staged;
    private readonly listeners;
    private saving;
    private failed;
    constructor(scope: SettingsScope<T>, api: CardApi, ns: string, specs: CardFieldSpec[], secrets?: CardSecretSpec[]);
    /** Publish a projection of this form, rebuilt whenever the scope or a draft changes. */
    bind<S>(project: () => S): SnapshotStore<S>;
    /** Read the card-level state: what the Host serves, and what a save would do. */
    shell(): CardShell;
    /** Read one control's state. */
    field(field: string): CardFieldState;
    /** Build the edit, reset, save, and discard actions bound to this form. */
    actions(): CardActions;
    /**
     * Write every staged edit in staging order. The Host response is the only
     * authority on acceptance; drafts survive a refused save.
     *
     * Re-seed dependency: after the writes land, the controls re-read their
     * stored values when the Host forwards the `settings/document-updated`
     * event through the scope subscription — the path-addressed
     * `api.settings.mutate` below has no inline re-read like `SettingsScope.set`
     * does. The forwarded event lands in the same Host settlement, so the
     * re-seed is a same-tick refresh, not a poll.
     */
    private save;
    /** Every staged edit a save would write, in staging order. */
    private plan;
    /** Path-addressed set through the settings transport. */
    private write;
    /** Path-addressed clear, so the field re-inherits the composition layer. */
    private clear;
    private expectedRevision;
    private stage;
    private spec;
    private snapshotOf;
    private sectionValue;
    private baseValue;
    /** Presence in the raw user layer — not a value comparison — marks an override. */
    private stored;
    private publish;
}
