/**
 * Unit tests for the client card form model and controller: staging, save
 * write-through via path-addressed settings ops, reset semantics, invalid
 * drafts blocking saves, and the credential domain wiring.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { CardForm, choiceField, numberField, textField } from '../src/client/form.js'
import type { CardApi } from '../src/client/form.js'
import { DEFAULT_VL_API_KEY_REF, VlGatewayCardController } from '../src/client/controller.js'
import type { VlGatewaySection } from '../src/client/controller.js'
import { nodeClientRuntimeAvailable } from './support/client-runtime.js'

interface SectionUser {
  vl?: Record<string, unknown>
}

interface Section {
  vl?: {
    apiKeyEnv?: string
    baseURL?: string
    model?: string
    describePrompt?: string
    timeoutMs?: number
    maxCacheEntries?: number
    onFailure?: string
  }
}

function makeScope(initial: {
  value?: Section
  base?: Record<string, unknown>
  user?: SectionUser
  writable?: boolean
  status?: SettingsScopeSnapshot<Section>['status']
}): {
  scope: SettingsScope<Section>
  publish: (next: Partial<SettingsScopeSnapshot<Section>>) => void
} {
  let snapshot: SettingsScopeSnapshot<Section> = {
    status: initial.status ?? 'ready',
    value: initial.value,
    base: initial.base,
    user: initial.user,
    revision: 1,
    writable: initial.writable ?? true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async () => {},
    unset: async () => {},
  } as SettingsScope<Section>
  return {
    scope,
    publish: (next) => {
      snapshot = { ...snapshot, ...next }
      for (const listener of listeners) listener()
    },
  }
}

function makeApi(): {
  api: CardApi
  mutate: ReturnType<typeof vi.fn>
  credentialsDescribe: ReturnType<typeof vi.fn>
  credentialsSet: ReturnType<typeof vi.fn>
} {
  const mutate = vi.fn(async () => ({ result: { ok: true, value: {} } }))
  const credentialsDescribe = vi.fn(async () => ({
    result: { ok: true, value: { credentials: {} } },
  }))
  const credentialsSet = vi.fn(async () => ({ result: { ok: true } }))
  return {
    api: {
      settings: { mutate },
      credentials: {
        describe: credentialsDescribe,
        set: credentialsSet,
      },
    } as unknown as CardApi,
    mutate,
    credentialsDescribe,
    credentialsSet,
  }
}

function makeForm(overrides: {
  scope?: SettingsScope<Section>
  api?: CardApi
} = {}) {
  const { scope, publish } = makeScope({})
  const { api, ...spies } = makeApi()
  const form = new CardForm<Section>(
    overrides.scope ?? scope,
    overrides.api ?? api,
    'llm-vl-gateway',
    [
      textField('baseURL', ['vl', 'baseURL']),
      textField('model', ['vl', 'model']),
      numberField('timeoutMs', ['vl', 'timeoutMs']),
      choiceField('onFailure', ['vl', 'onFailure'], ['fail', 'placeholder']),
    ],
  )
  return { form, scope, publish, api, ...spies }
}

// Skipped on npm-only machines: the official client runtime ships browser-only
// there (see tests/support/client-runtime.ts). Checkout machines run it.
describe.skipIf(!nodeClientRuntimeAvailable())('CardForm', () => {
  it('seeds drafts from the section and marks user-layer presence as overridden', () => {
    const { form, scope, publish } = makeForm()
    publish({
      value: { vl: { baseURL: 'https://dashscope.example', model: 'qwen-vl-max' } },
      user: { vl: { model: 'qwen-vl-max' } },
    })
    expect(form.field('baseURL')).toMatchObject({ text: 'https://dashscope.example', overridden: false })
    expect(form.field('model')).toMatchObject({ text: 'qwen-vl-max', overridden: true })
  })

  it('stages edits and writes them as path-addressed ops on save', async () => {
    const { form, publish, mutate } = makeForm()
    publish({ value: {}, user: {} })
    form.actions().edit('baseURL', ' https://openrouter.example/api/v1 ')
    form.actions().edit('timeoutMs', '90000')
    expect(form.shell()).toMatchObject({ dirty: true, invalid: false })
    form.actions().save()
    await vi.waitFor(() => {
      expect(mutate).toHaveBeenCalledWith({
        ns: 'llm-vl-gateway',
        ops: [{ op: 'set', path: ['vl', 'baseURL'], value: 'https://openrouter.example/api/v1' }],
        expectedRevision: 1,
      })
    })
    await vi.waitFor(() => {
      expect(mutate).toHaveBeenCalledWith({
        ns: 'llm-vl-gateway',
        ops: [{ op: 'set', path: ['vl', 'timeoutMs'], value: 90000 }],
        expectedRevision: 1,
      })
    })
  })

  it('blocks the save while a draft is invalid', async () => {
    const { form, publish, mutate } = makeForm()
    publish({ value: {}, user: {} })
    form.actions().edit('timeoutMs', 'not-a-number')
    expect(form.shell()).toMatchObject({ dirty: true, invalid: true })
    form.actions().save()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(mutate).not.toHaveBeenCalled()
  })

  it('clears a field on reset when the user layer carries it', async () => {
    const { form, publish, mutate } = makeForm()
    publish({ value: { vl: { model: 'custom' } }, user: { vl: { model: 'custom' } } })
    form.actions().resetField('model')
    form.actions().save()
    await vi.waitFor(() => {
      expect(mutate).toHaveBeenCalledWith({
        ns: 'llm-vl-gateway',
        ops: [{ op: 'unset', path: ['vl', 'model'] }],
        expectedRevision: 1,
      })
    })
  })

  it('refuses a choice draft outside the choice set', () => {
    const { form, publish } = makeForm()
    publish({ value: {}, user: {} })
    form.actions().edit('onFailure', 'explode')
    expect(form.field('onFailure')).toMatchObject({ invalid: true })
  })

  it('drops staged edits on discard', () => {
    const { form, publish } = makeForm()
    publish({ value: {}, user: {} })
    form.actions().edit('baseURL', 'https://x')
    expect(form.shell().dirty).toBe(true)
    form.actions().discard()
    expect(form.shell().dirty).toBe(false)
    expect(form.field('baseURL').text).toBe('')
  })

  it('reports a refused write as failed and keeps the draft', async () => {
    const { form, scope, publish } = makeForm()
    publish({ value: {}, user: {} })
    const mutate = vi.fn(async () => ({ result: { ok: false } }))
    const failing = new CardForm<Section>(
      scope,
      { settings: { mutate }, credentials: {} } as unknown as CardApi,
      'llm-vl-gateway',
      [textField('baseURL', ['vl', 'baseURL'])],
    )
    failing.actions().edit('baseURL', 'https://x')
    failing.actions().save()
    await vi.waitFor(() => {
      expect(failing.shell().failed).toBe(true)
    })
    expect(failing.field('baseURL').text).toBe('https://x')
  })
})

describe.skipIf(!nodeClientRuntimeAvailable())('VlGatewayCardController', () => {
  it('projects every vl field and the credential state into the card snapshot', async () => {
    const { scope, publish } = makeScope({})
    const { api, credentialsDescribe, credentialsSet } = makeApi()
    const controller = new VlGatewayCardController(scope, api)
    publish({
      value: { vl: { model: 'qwen-vl-max', timeoutMs: 60000, onFailure: 'placeholder' } },
      user: { vl: { timeoutMs: 60000 } },
    })
    const face = controller.inject()
    const state = face.hooks.vlGatewayCard.getSnapshot()
    expect(state.model).toMatchObject({ text: 'qwen-vl-max' })
    expect(state.timeoutMs).toMatchObject({ text: '60000', overridden: true })
    expect(state.onFailure).toMatchObject({ text: 'placeholder' })
    expect(state.apiKeyConfigured).toBe(false)
    expect(state.apiKeyWritable).toBe(true)
    void credentialsSet
  })

  it('describes the default credential reference when the section names none', async () => {
    const { scope } = makeScope({ value: {} })
    const { api, credentialsDescribe } = makeApi()
    new VlGatewayCardController(scope, api)
    await vi.waitFor(() => {
      expect(credentialsDescribe).toHaveBeenCalledWith({ refs: [DEFAULT_VL_API_KEY_REF] })
    })
  })

  it('writes the staged key to the credentials domain and reflects the read-back', async () => {
    const { scope, publish } = makeScope({ value: { vl: { apiKeyEnv: 'MY_VL_KEY' } } })
    const { api, credentialsDescribe, credentialsSet } = makeApi()
    credentialsDescribe.mockResolvedValue({
      result: { ok: true, value: { credentials: { MY_VL_KEY: { configured: false, writable: true } } } },
    })
    const controller = new VlGatewayCardController(scope, api)
    await vi.waitFor(() => {
      expect(credentialsDescribe).toHaveBeenCalledWith({ refs: ['MY_VL_KEY'] })
    })
    const face = controller.inject()
    face.edit('apiKey', 'sk-secret')
    face.save()
    await vi.waitFor(() => {
      expect(credentialsSet).toHaveBeenCalledWith({ ref: 'MY_VL_KEY', value: 'sk-secret' })
    })
    // The Host now holds the key and forwards credentials/updated; the card
    // re-reads through the same path the plugin's event subscription uses.
    credentialsDescribe.mockResolvedValue({
      result: { ok: true, value: { credentials: { MY_VL_KEY: { configured: true, writable: true } } } },
    })
    controller.refreshCredential('MY_VL_KEY')
    await vi.waitFor(() => {
      expect(face.hooks.vlGatewayCard.getSnapshot().apiKeyConfigured).toBe(true)
    })
    void publish
  })
})
