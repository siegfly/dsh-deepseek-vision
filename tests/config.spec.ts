/**
 * Schema-boundary tests for the plugin configuration: every field
 * materializes its default, and values outside the schema bounds are
 * rejected at composition/registration time rather than surfacing later
 * as wire-level surprises.
 */

import { describe, expect, it } from 'vitest'
import {
  Config, DEFAULT_DISPLAY_NAME, DEFAULT_PROVIDER, DEFAULT_VL_API_KEY_ENV,
  DEFAULT_VL_BASE_URL, DEFAULT_VL_DESCRIBE_PROMPT, DEFAULT_VL_MAX_CACHE_ENTRIES,
  DEFAULT_VL_MODEL, DEFAULT_VL_TIMEOUT_MS,
} from '../src/index.js'

describe('Config schema', () => {
  it('materializes every default from an empty composition', () => {
    const value = Config({})
    expect(value.provider).toBe(DEFAULT_PROVIDER)
    expect(value.displayName).toBe(DEFAULT_DISPLAY_NAME)
    expect(value.deepseek).toBeTruthy()
    expect(value.vl).toEqual({
      apiKeyEnv: DEFAULT_VL_API_KEY_ENV,
      baseURL: DEFAULT_VL_BASE_URL,
      model: DEFAULT_VL_MODEL,
      describePrompt: DEFAULT_VL_DESCRIBE_PROMPT,
      timeoutMs: DEFAULT_VL_TIMEOUT_MS,
      maxCacheEntries: DEFAULT_VL_MAX_CACHE_ENTRIES,
      onFailure: 'fail',
    })
  })

  it('accepts an empty deepseek section (the official schema is optional)', () => {
    const value = Config({ deepseek: {} })
    expect(value.deepseek).toBeTruthy()
  })

  it('rejects an unknown failure policy', () => {
    expect(() => Config({ vl: { onFailure: 'bogus' as never } })).toThrow()
  })

  it('rejects a non-positive VL timeout', () => {
    expect(() => Config({ vl: { timeoutMs: 0 } })).toThrow()
  })

  it('rejects a zero description-cache capacity', () => {
    expect(() => Config({ vl: { maxCacheEntries: 0 } })).toThrow()
  })
})
