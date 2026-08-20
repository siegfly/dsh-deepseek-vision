/**
 * dsh-deepseek-vision — an out-of-tree dsh provider plugin.
 *
 * Registers one new LLM provider route (`deepseek-vision` by default) that
 * serves the DeepSeek catalog while CLAIMING image input. When a request
 * reaches the route with image blocks (pasted into the chat window, or nested
 * in tool results), each image is first described by a configured
 * vision-language model (Qwen-VL by default, any OpenAI-compatible
 * `/chat/completions` endpoint), and the description text replaces the image
 * before the text-only DeepSeek wire is called.
 *
 * Composition: add a row `{ id: llm-vl-gateway, name: dsh-deepseek-vision }` to a
 * profile patch layer (see README), then select the `DeepSeek + Vision`
 * provider in the web Models page.
 *
 * @module dsh-deepseek-vision
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import {
  resolveAdapterOptions,
  Config as DeepSeekSectionSchema,
} from '@deepseek-ai/dsh-llm-deepseek'
import type {
  Config as DeepSeekSection,
  ResolvedDeepSeekOptions,
} from '@deepseek-ai/dsh-llm-deepseek'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { describeImage } from './vl.js'
import type { VlConnectionFacts } from './vl.js'
import { ImageBridge } from './bridge.js'
import type { VlFailurePolicy } from './bridge.js'
import { VisionGatewayAdapter } from './gateway.js'

export const name = 'llm-vl-gateway'
export const inject = ['llm', 'attachments']

export { VisionGatewayAdapter, GATEWAY_INPUT_MODALITIES } from './gateway.js'
export { ImageBridge } from './bridge.js'
export type { VlFailurePolicy, ImageBridgeOptions } from './bridge.js'
export { describeImage } from './vl.js'
export type { VlConnectionFacts, VlDescribeInput } from './vl.js'

const NS = settingsNamespace('llm-vl-gateway')

/** The provider route this plugin owns (avoid `deepseek-official`, which llm-deepseek owns). */
export const DEFAULT_PROVIDER = 'deepseek-vision'
/** Selector label shown in the web model picker. */
export const DEFAULT_DISPLAY_NAME = 'DeepSeek + Vision'

/** Credential reference for the vision-language endpoint. */
export const DEFAULT_VL_API_KEY_ENV = 'QWEN_VL_API_KEY'
/** DashScope OpenAI-compatible base; any `/chat/completions` gateway works. */
export const DEFAULT_VL_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
/** Qwen3-VL flash tier on the compatible endpoint: newest generation, lowest price. */
export const DEFAULT_VL_MODEL = 'qwen3-vl-flash'
/** Hard cap on one description request. */
export const DEFAULT_VL_TIMEOUT_MS = 120_000
/** Bounded per-process description cache (one entry per unique attachment). */
export const DEFAULT_VL_MAX_CACHE_ENTRIES = 64

/** Instruction sent beside each image; tune for your workload. */
export const DEFAULT_VL_DESCRIBE_PROMPT = [
  'Describe this image in detail so a text-only model can reason about it.',
  'Reproduce any visible text verbatim: code, error messages, logs, UI labels, diagrams, tables.',
  'Describe the visual layout and any element relationships that matter.',
  'Reply in the language the user is most likely using, with no preamble.',
].join(' ')

/** The vision-language leg of the plugin configuration. */
export interface VlSection {
  /** Credential reference (environment-variable name) resolved per request. */
  apiKeyEnv?: string
  /** Endpoint base; `/chat/completions` is appended. */
  baseURL?: string
  /** Wire model id the endpoint accepts. */
  model?: string
  /** Instruction sent beside each image. */
  describePrompt?: string
  /** Hard cap on one description request, in milliseconds. */
  timeoutMs?: number
  /** Per-process description cache capacity. */
  maxCacheEntries?: number
  /** `fail` fails the whole request when a description cannot be produced; `placeholder` substitutes an error note. */
  onFailure?: VlFailurePolicy
}

/** Plugin configuration; doubles as the `llm-vl-gateway` settings-section shape. */
export interface Config {
  /** Registered provider route id; defaults to {@link DEFAULT_PROVIDER}. */
  provider?: string
  /** Selector label; defaults to {@link DEFAULT_DISPLAY_NAME}. */
  displayName?: string
  /**
   * The DeepSeek leg — the full `llm-deepseek` section shape (key reference,
   * base URL, thinking mode, catalog, retry policy). The gateway route serves
   * this catalog with image input claimed.
   */
  deepseek?: DeepSeekSection
  /** The vision-language leg. */
  vl?: VlSection
}

const vlSectionSchema = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_VL_API_KEY_ENV),
  baseURL: z.string().default(DEFAULT_VL_BASE_URL),
  model: z.string().default(DEFAULT_VL_MODEL),
  describePrompt: z.string().default(DEFAULT_VL_DESCRIBE_PROMPT),
  timeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_VL_TIMEOUT_MS),
  maxCacheEntries: z.number().step(1).min(1).max(100_000).default(DEFAULT_VL_MAX_CACHE_ENTRIES),
  onFailure: z.union(['fail', 'placeholder']).default('fail' as const),
})

export const Config: z<Config> = z.object({
  // Materialized with their defaults so the settings seam's eager schema
  // resolve never sees a required-but-absent field. A live settings section
  // may override these, and apply() re-registers the route/directory when it
  // does (see ensureRegistrationFacts below).
  provider: z.string().default(DEFAULT_PROVIDER),
  displayName: z.string().default(DEFAULT_DISPLAY_NAME),
  deepseek: DeepSeekSectionSchema.default({}),
  vl: vlSectionSchema.default({
    apiKeyEnv: DEFAULT_VL_API_KEY_ENV,
    baseURL: DEFAULT_VL_BASE_URL,
    model: DEFAULT_VL_MODEL,
    describePrompt: DEFAULT_VL_DESCRIBE_PROMPT,
    timeoutMs: DEFAULT_VL_TIMEOUT_MS,
    maxCacheEntries: DEFAULT_VL_MAX_CACHE_ENTRIES,
    onFailure: 'fail',
  }),
})

/** One resolution's complete vision-leg facts, all fields defaulted. */
interface ResolvedVlSection {
  apiKeyEnv: string
  baseURL: string
  model: string
  describePrompt: string
  timeoutMs: number
  maxCacheEntries: number
  onFailure: VlFailurePolicy
}

/** Materialize the vision-leg section with every default resolved. */
function resolveVlSection(raw: Config): ResolvedVlSection {
  // The schema materializes defaults; these guard programmatic construction.
  const section = raw.vl ?? {}
  return {
    apiKeyEnv: section.apiKeyEnv ?? DEFAULT_VL_API_KEY_ENV,
    baseURL: section.baseURL ?? DEFAULT_VL_BASE_URL,
    model: section.model ?? DEFAULT_VL_MODEL,
    describePrompt: section.describePrompt ?? DEFAULT_VL_DESCRIBE_PROMPT,
    timeoutMs: section.timeoutMs ?? DEFAULT_VL_TIMEOUT_MS,
    maxCacheEntries: section.maxCacheEntries ?? DEFAULT_VL_MAX_CACHE_ENTRIES,
    onFailure: section.onFailure ?? 'fail',
  }
}

/**
 * Register the gateway provider route. Per-request connection facts for both
 * legs resolve lazily, so settings edits and credential rotations reach the
 * very next request without restarting anything. The route id and selector
 * label are registration facts the registries capture, so a live change to
 * them re-registers atomically (a refused swap keeps the previous set).
 */
export function apply(ctx: Context, config: Config): void {
  // Settings (when mounted) replace the composition entry; everything below
  // reads through this thunk so live snapshots flow into both legs.
  let current: () => Config = () => config
  let lastRaw: DeepSeekSection | undefined
  let lastGood: ResolvedDeepSeekOptions | undefined
  const connectionOptions = (): ResolvedDeepSeekOptions => {
    const raw = current().deepseek ?? {}
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      // Only a live settings snapshot can fail here (static composition
      // resolved before anything registered); keep serving the last good
      // facts and say so once per bad snapshot.
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-vl-gateway: keeping the last good DeepSeek configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }

  const resolveApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string> => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    const value = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (value !== undefined && value.length > 0) return assertUsableApiKey(value, 'llm-vl-gateway', ref)
    throw new LlmError(
      `llm-vl-gateway: no API key for provider route "${currentProvider()}"; store ${ref} through the`
      + ` credentials service (the web Models page writes it) or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  const resolveVlApiKey = async (ref: string): Promise<string> => {
    const credential = credentialRef(ref)
    const credentials = ctx.get('credentials')
    const value = credentials !== undefined
      ? (await credentials.resolve(credential))?.value
      : launchEnvironmentOf(ctx).get(credential)?.value
    if (value !== undefined && value.length > 0) return assertUsableApiKey(value, 'llm-vl-gateway', credential)
    throw new LlmError(
      `llm-vl-gateway: no API key for the vision model; store ${ref} through the credentials`
      + ` service or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId: AnonymousUserId | undefined
  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()

  const vlFacts = async (): Promise<VlConnectionFacts> => {
    const section = resolveVlSection(current())
    return {
      apiKey: await resolveVlApiKey(section.apiKeyEnv),
      baseURL: section.baseURL,
      model: section.model,
      describePrompt: section.describePrompt,
      timeoutMs: section.timeoutMs,
    }
  }

  const bridge = new ImageBridge({
    attachments: ctx.attachments,
    describe: async (ref, data, signal) => {
      const facts = await vlFacts()
      return describeImage({ ref, data, facts, signal })
    },
    describeModel: () => resolveVlSection(current()).model,
    maxCacheEntries: () => resolveVlSection(current()).maxCacheEntries,
    onFailure: () => resolveVlSection(current()).onFailure,
  })

  // The route id and selector label read from the LIVE source: they are
  // captured by both registries, so a settings edit re-registers (below).
  // The initial call doubles as the load-time validation — an empty provider
  // fails loudly before anything registers.
  const currentProvider = (): string => {
    const value = (current().provider ?? DEFAULT_PROVIDER).trim()
    if (value.length === 0) throw new Error('llm-vl-gateway: provider must be non-empty')
    return value
  }
  const currentDisplayName = (): string => {
    const value = (current().displayName ?? '').trim()
    return value.length === 0 ? DEFAULT_DISPLAY_NAME : value
  }

  const adapter = new VisionGatewayAdapter(
    { options: connectionOptions, resolveApiKey, resolveUserId },
    bridge,
    currentDisplayName,
  )

  /** One configurable-provider directory entry, read from the live source. */
  const directoryEntry = () => ({
    provider: currentProvider(),
    displayName: currentDisplayName(),
    settingsNs: NS,
    settingsPath: ['deepseek'],
    // The route exists only because configuration declared it: the gateway
    // adapter ships nothing under this key on its own.
    declared: true,
  })

  const initialEntry = directoryEntry()
  const directory = ctx.llm.registerConfigurableProviders([initialEntry])

  const registration = ctx.llm.registerAdapter([initialEntry.provider], adapter)
  let registeredFacts: { provider: string; displayName: string; policy: ResolvedDeepSeekOptions['retryPolicy'] } = {
    provider: initialEntry.provider,
    displayName: initialEntry.displayName,
    policy: connectionOptions().retryPolicy,
  }
  let directoryFacts: unknown = initialEntry

  /**
   * Re-apply every registration-level fact both registries capture: the route
   * set + selector label + retry policy (adapter registry) and the directory
   * entry. The two registries have no shared swap, so the directory is
   * re-applied after the route swap and a refused directory swap rolls the
   * route back — the old route is this plugin's own, so the revert cannot
   * conflict. Either both registries advance or neither does, and
   * `registeredFacts`/`directoryFacts` only advance once both hold the new
   * set, so returning to a working configuration always re-applies.
   */
  const ensureRegistrationFacts = (): void => {
    const next = {
      provider: currentProvider(),
      displayName: currentDisplayName(),
      policy: connectionOptions().retryPolicy,
    }
    const entry = directoryEntry()
    if (deepEqualJson(next, registeredFacts) && deepEqualJson(entry, directoryFacts)) return
    // The adapter registry captures the route set, the selector name, and the
    // retry policy at registration, so a change to any of them must
    // re-register. The swap is atomic (same adapter instance, validated
    // before anything moves): a conflicting route leaves the previous route
    // serving, and nothing below runs.
    registration.replace([next.provider])
    try {
      // Atomic replace, never dispose-then-register: a provider id another
      // plugin's directory already declares would otherwise leave the Models
      // page without this entry. The candidate set is validated first, so a
      // collision keeps the previous entry serving.
      directory.replace([entry])
    } catch (error) {
      registration.replace([registeredFacts.provider])
      throw error
    }
    registeredFacts = next
    directoryFacts = entry
  }

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      // Named here rather than left to the settings watcher so a refusal
      // reaches the operator as a specific diagnostic naming the plugin —
      // and the previous route/directory keep serving either way.
      try {
        ensureRegistrationFacts()
      } catch (error) {
        ctx.logger.error('llm-vl-gateway: keeping the previously registered route and directory after a refused update')
        ctx.logger.error(error)
      }
    },
  })
}
