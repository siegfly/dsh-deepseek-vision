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
/** A control whose value is written outside the settings section (a credential). */
export interface CardSecretSpec {
    /** Field name addressing this control inside the card's form. */
    field: string;
    /** Write the staged text; resolves to whether the Host accepted it. */
    write: (text: string) => Promise<boolean>;
}
/** One field as a card's control renders it. */
export interface CardFieldState {
    /** Draft text the control renders. */
    text: string;
    /** Whether saving would leave a user-layer entry for this field. */
    overridden: boolean;
    /** Whether the draft is not a value this field accepts, which blocks saving. */
    invalid: boolean;
}
/** Form state every plugin card shares. */
export interface CardShell {
    /** False while the namespace is not served to this client. */
    available: boolean;
    /** Whether the Host document accepts writes. */
    writable: boolean;
    /** Whether the form holds edits that a save would write. */
    dirty: boolean;
    /** Whether any staged draft is invalid, which blocks the save. */
    invalid: boolean;
    /** Whether a save is crossing the wire. */
    saving: boolean;
    /** Whether the last save did not land as staged; cleared by the next edit or save. */
    failed: boolean;
}
/** The write actions every plugin card's slot entry injects. */
export interface CardActions {
    /** Stage draft text for one field. */
    edit: (field: string, text: string) => void;
    /** Stage a clear, so saving lets the field re-inherit the composition layer. */
    resetField: (field: string) => void;
    /** Write every staged edit. */
    save: () => void;
    /** Drop every staged edit. */
    discard: () => void;
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
