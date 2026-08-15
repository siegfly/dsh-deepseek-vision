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
 * @module dsh-deepseek-vision/client/form
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  SettingsScope,
  SettingsScopeSnapshot,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only imports from the in-box card contract (erased before the client
// purity gate runs): these four shapes are the drift-free official ones, so
// they are shared rather than re-declared. `CardFieldSpec` stays local — this
// card's fields live under the `vl` sub-section, so it adds the `path` member.
import type {
  CardActions,
  CardFieldState,
  CardSecretSpec,
  CardShell,
} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

export type { CardActions, CardFieldState, CardSecretSpec, CardShell }

/** Wire face the card writes through: path-addressed settings + credentials. */
export type CardApi = Pick<ConnectionHandle['api'], 'credentials' | 'settings'>

/** The write one field's staged text performs when the card is saved. */
export type FieldWrite =
  | { kind: 'set'; value: unknown }
  | { kind: 'clear' }

/** How one section field converts between its stored value and its draft text. */
export interface CardFieldSpec {
  /** Field name addressing this control inside the card's form. */
  field: string
  /** Settings path of the value inside the namespace section (e.g. `['vl', 'model']`). */
  path: readonly string[]
  /** Render a stored value as draft text; the empty string when the section carries none. */
  format: (value: unknown) => string
  /** The write this draft text stages, or undefined when the text is not a value this field accepts. */
  parse: (text: string) => FieldWrite | undefined
}

/** One field's staged edit. */
interface StagedEdit {
  /** Draft text the control renders. */
  text: string
  /** True when this edit clears the field whatever text it shows. */
  clear: boolean
}

/** One staged edit resolved into the write a save performs. */
interface PlannedWrite {
  /** Field this entry writes. */
  field: string
  /** Perform the write and report whether the Host accepted it. */
  run: (() => Promise<boolean>) | undefined
}

/** Read one scalar along a settings path, or undefined. */
function atPath(value: unknown, path: readonly string[]): unknown {
  let node: unknown = value
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return node
}

/** A free-text field; an empty draft clears the field. */
export function textField(field: string, path: readonly string[]): CardFieldSpec {
  return {
    field,
    path,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/** A whole-number field; an empty draft clears, any other non-finite draft blocks the save. */
export function numberField(field: string, path: readonly string[]): CardFieldSpec {
  return {
    field,
    path,
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/** A fixed-choice field; a draft outside the choice set blocks the save. */
export function choiceField(
  field: string,
  path: readonly string[],
  choices: readonly string[],
): CardFieldSpec {
  return {
    field,
    path,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      return choices.includes(trimmed) ? { kind: 'set', value: trimmed } : undefined
    },
  }
}

/**
 * Stages one card's edits over one settings namespace and writes them on save.
 * Field writes are path-addressed `settings.mutate` ops against the namespace;
 * the Host response is authoritative — an accepted write clears its draft, a
 * refused one keeps it so the user can correct it.
 */
export class CardForm<T> {
  private readonly specs = new Map<string, CardFieldSpec>()
  private readonly secretSpecs = new Map<string, CardSecretSpec>()
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false

  constructor(
    private readonly scope: SettingsScope<T>,
    private readonly api: CardApi,
    private readonly ns: string,
    specs: CardFieldSpec[],
    secrets: CardSecretSpec[] = [],
  ) {
    for (const spec of specs) this.specs.set(spec.field, spec)
    for (const spec of secrets) this.secretSpecs.set(spec.field, spec)
    scope.subscribe(() => { this.publish() })
  }

  /** Publish a projection of this form, rebuilt whenever the scope or a draft changes. */
  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  /** Read the card-level state: what the Host serves, and what a save would do. */
  shell(): CardShell {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /** Read one control's state. */
  field(field: string): CardFieldState {
    const staged = this.staged.get(field)
    if (this.secretSpecs.has(field)) {
      return { text: staged?.text ?? '', overridden: false, invalid: false }
    }
    const spec = this.spec(field)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
    return {
      text: staged.text,
      overridden: write?.kind === 'set',
      invalid: write === undefined,
    }
  }

  /** Build the edit, reset, save, and discard actions bound to this form. */
  actions(): CardActions {
    return {
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => {
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true })
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

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
  private async save(): Promise<void> {
    const plan = this.plan()
    const writes = plan.flatMap(item => item.run === undefined ? [] : [item.run])
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) {
      landed = await write() && landed
    }
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /** Every staged edit a save would write, in staging order. */
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const secret = this.secretSpecs.get(field)
      if (secret !== undefined) {
        const value = staged.text.trim()
        if (value !== '') plan.push({ field, run: () => secret.write(value) })
        continue
      }
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, run: () => this.clear(spec) })
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field, run: undefined })
      else if (write.kind === 'clear') plan.push({ field, run: () => this.clear(spec) })
      else plan.push({ field, run: () => this.write(spec, write.value) })
    }
    return plan
  }

  /** Path-addressed set through the settings transport. */
  private async write(spec: CardFieldSpec, value: unknown): Promise<boolean> {
    try {
      const response = await this.api.settings.mutate({
        ns: this.ns,
        ops: [{ op: 'set', path: [...spec.path], value }],
        ...this.expectedRevision(),
      })
      return response.result.ok
    } catch {
      return false
    }
  }

  /** Path-addressed clear, so the field re-inherits the composition layer. */
  private async clear(spec: CardFieldSpec): Promise<boolean> {
    try {
      const response = await this.api.settings.mutate({
        ns: this.ns,
        ops: [{ op: 'unset', path: [...spec.path] }],
        ...this.expectedRevision(),
      })
      return response.result.ok
    } catch {
      return false
    }
  }

  private expectedRevision(): { expectedRevision: number } | Record<string, never> {
    const revision = this.scope.getSnapshot().revision
    return revision === undefined ? {} : { expectedRevision: revision }
  }

  private stage(field: string, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private spec(field: string): CardFieldSpec {
    const spec = this.specs.get(field)
    if (spec === undefined) throw new Error(`plugin card has no field ${field}`)
    return spec
  }

  private snapshotOf(): SettingsScopeSnapshot<T> {
    return this.scope.getSnapshot()
  }

  private sectionValue(field: string): unknown {
    return atPath(this.snapshotOf().value, this.spec(field).path)
  }

  private baseValue(field: string): unknown {
    return atPath(this.snapshotOf().base, this.spec(field).path)
  }

  /** Presence in the raw user layer — not a value comparison — marks an override. */
  private stored(field: string): boolean {
    return atPath(this.snapshotOf().user, this.spec(field).path) !== undefined
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
