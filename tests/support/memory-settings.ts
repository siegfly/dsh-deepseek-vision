/**
 * In-memory settings provider for live-section tests: the smallest real
 * SettingsProvider subclass, replicating the (unshipped) upstream fixture
 * packages/settings/settings/tests/memory.ts. Mounted via ctx.provide /
 * ctx.plugin so the tests exercise the REAL register/watch semantics and
 * settings/updated events; `pushExternal` publishes a live snapshot exactly
 * as a storage change reaching the provider would.
 */

import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** In-memory provider exposing the protected provider hooks to tests. */
export class MemorySettings extends SettingsProvider {
  /** Raw document the provider "storage" currently holds. */
  doc: Record<string, unknown>
  /** Every persist() call observed, in order. */
  persisted: Array<{ ns: SettingsNamespace; section: Record<string, unknown> }> = []
  /** When false, update() must reject before reaching persist(). */
  writableFlag: boolean

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: {
    doc?: Record<string, unknown>
    writable?: boolean
  }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
    this.writableFlag = options?.writable ?? true
  }

  get writable(): boolean {
    return this.writableFlag
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.persisted.push({ ns, section: structuredClone(section) })
    this.doc[ns] = structuredClone(section)
  }

  /** Simulate an external storage change reaching the provider. */
  pushExternal(doc: Record<string, unknown>): void {
    this.doc = structuredClone(doc)
    this.publish(structuredClone(doc))
  }
}
