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

import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, choiceField, numberField, textField,
  type CardActions, type CardApi, type CardFieldState, type CardShell,
} from './form.js'

/** Host settings namespace the gateway plugin owns. */
export const GATEWAY_SETTINGS_NS = 'llm-vl-gateway'

/** Credential reference the gateway resolves when the section names none. */
export const DEFAULT_VL_API_KEY_REF = 'QWEN_VL_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The `vl` sub-section fields this card edits. */
export interface VlGatewayVlSection {
  apiKeyEnv?: string
  baseURL?: string
  model?: string
  describePrompt?: string
  timeoutMs?: number
  maxCacheEntries?: number
  onFailure?: 'fail' | 'placeholder'
}

/** The namespace section view this card reads (only the `vl` member is used). */
export interface VlGatewaySection {
  vl?: VlGatewayVlSection
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials.set` can affect it; false disables the control. */
  writable: boolean
}

/** What the VL gateway card renders. */
export interface VlGatewayCardState extends CardShell {
  apiKeyEnv: CardFieldState
  baseURL: CardFieldState
  model: CardFieldState
  describePrompt: CardFieldState
  timeoutMs: CardFieldState
  maxCacheEntries: CardFieldState
  onFailure: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the card's slot entry injects. */
export interface VlGatewayCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useVlGatewayCard. */
    vlGatewayCard: SnapshotStore<VlGatewayCardState>
  }
}

/** Bridges the `llm-vl-gateway` scope and the credentials domain onto the card. */
export class VlGatewayCardController {
  private readonly form: CardForm<VlGatewaySection>
  private readonly store: SnapshotStore<VlGatewayCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `llm-vl-gateway` namespace.
   * @param api - wire face used for path-addressed settings writes and the credential.
   */
  constructor(
    private readonly scope: SettingsScope<VlGatewaySection>,
    private readonly api: CardApi,
  ) {
    this.form = new CardForm(
      scope,
      api,
      GATEWAY_SETTINGS_NS,
      [
        textField('apiKeyEnv', ['vl', 'apiKeyEnv']),
        textField('baseURL', ['vl', 'baseURL']),
        textField('model', ['vl', 'model']),
        textField('describePrompt', ['vl', 'describePrompt']),
        numberField('timeoutMs', ['vl', 'timeoutMs']),
        numberField('maxCacheEntries', ['vl', 'maxCacheEntries']),
        choiceField('onFailure', ['vl', 'onFailure'], ['fail', 'placeholder']),
      ],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): VlGatewayCardState {
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
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently
   * names. A response is published only while it still answers for the
   * reference in force.
   */
  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    try {
      const response = await this.api.credentials.describe({ refs: [ref] })
      if (!response.result.ok || ref !== refOf(this.scope.getSnapshot())) return
      const view = response.result.value.credentials[ref]
      const next: CredentialState = {
        ref,
        configured: view?.configured ?? false,
        writable: view?.writable ?? true,
      }
      if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
      this.credential = next
      this.store.set(this.projection())
    } catch {
      // The card stays usable without this; a write still reaches the Host.
    }
  }

  /** Re-read after the Host reports a change to the reference this card watches. */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /** Build the face the card's slot registration injects. */
  inject(): VlGatewayCardFace {
    return { hooks: { vlGatewayCard: this.store }, ...this.form.actions() }
  }

  /** Write the staged key, then re-read whether the Host now holds one. */
  private async writeKey(value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({ ref: refOf(this.scope.getSnapshot()), value })
    } catch {
      // Refusals surface through the re-read below.
    }
    await this.readCredential()
    return this.credential.configured
  }
}

/** The credential reference the section names, or the gateway default. */
function refOf(snapshot: SettingsScopeSnapshot<VlGatewaySection>): string {
  const declared = snapshot.value?.vl?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_VL_API_KEY_REF
}
