/**
 * Mount test for the client plugin half: the slot registration wiring (name,
 * id, order, locale, injected face) and the service dependencies it declares.
 * Services are stubbed through ctx.provide, exactly as the browser module
 * table would satisfy them.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import * as client from '../src/client/index.js'

interface RegisteredCard {
  options: { name: string; id: string; order: number; locale: string }
  component: (props: never) => unknown
  inject: () => unknown
}

function mountClient(): Promise<{ cards: RegisteredCard[]; face: () => unknown }> {
  const cards: RegisteredCard[] = []
  const ctx = new Context()
  const scope: SettingsScope<{ vl?: Record<string, unknown> }> = {
    getSnapshot: () => ({
      status: 'ready',
      value: {},
      base: {},
      user: {},
      revision: 1,
      writable: true,
      mode: 'host',
    }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  }
  ctx.provide('slots', {
    inject: (_name: string, generator: () => Generator<RegisteredCard>) => {
      for (const registered of generator()) cards.push(registered)
    },
    register: (options: RegisteredCard['options'], component: RegisteredCard['component']) => {
      return { options, component } as RegisteredCard & { inject: () => unknown }
    },
  })
  ctx.provide('locale', {
    bind: () => (key: string) => key,
    register: () => () => {},
  })
  ctx.provide('connection', {
    api: {
      settings: { mutate: async () => ({ result: { ok: true } }) },
      credentials: {
        describe: async () => ({ result: { ok: true, value: { credentials: {} } } }),
        set: async () => ({ result: { ok: true } }),
      },
    },
  })
  ctx.provide('remote', { $on: () => () => {} })
  ctx.provide('settingsScope', { bind: () => scope })
  return ctx.plugin(Object.assign(
    (inner: Context) => client.apply(inner as never),
    { inject: client.inject },
  )).then(() => ({
    cards,
    face: () => {
      const registered = cards[0]
      if (registered === undefined) throw new Error('no card registered')
      return registered.options.inject()
    },
  }))
}

describe('client plugin half', () => {
  it('registers one settings.plugin.item card with the gateway face', async () => {
    const { cards, face } = await mountClient()
    expect(cards).toHaveLength(1)
    expect(cards[0]!.options).toMatchObject({
      name: 'settings.plugin.item',
      id: 'vl-gateway',
      order: 30,
      locale: 'vl-gateway',
    })
    expect(typeof cards[0]!.options.inject).toBe('function')
    expect(typeof cards[0]!.component).toBe('function')
    const injected = face() as {
      hooks: { vlGatewayCard: { getSnapshot: () => unknown } }
      edit: unknown
      save: unknown
      discard: unknown
      resetField: unknown
    }
    expect(typeof injected.hooks.vlGatewayCard.getSnapshot).toBe('function')
    expect(typeof injected.edit).toBe('function')
    expect(typeof injected.save).toBe('function')
    expect(typeof injected.discard).toBe('function')
    expect(typeof injected.resetField).toBe('function')
  })

  it('declares the client services the card needs', () => {
    expect(client.inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })
})
