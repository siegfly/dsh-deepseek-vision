/**
 * Dictionary namespace owned by the VL gateway client plugin. The merge into
 * `LocaleNamespaceMap` is what types `PropsLocale<'vl-gateway'>` and
 * `ctx.locale.bind(NS)`.
 *
 * @module dsh-deepseek-vision/client/locales
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

export const NS = 'vl-gateway'

/** Locale keys this card renders. */
export type VlGatewayLocaleKey =
  | 'title'
  | 'description'
  | 'apiKey'
  | 'apiKeyHint'
  | 'apiKeySet'
  | 'apiKeyUnset'
  | 'apiKeyEnv'
  | 'apiKeyEnvHint'
  | 'baseURL'
  | 'baseURLHint'
  | 'model'
  | 'modelHint'
  | 'describePrompt'
  | 'describePromptHint'
  | 'timeoutMs'
  | 'timeoutMsHint'
  | 'maxCacheEntries'
  | 'maxCacheEntriesHint'
  | 'onFailure'
  | 'onFailureHint'
  | 'overridden'
  | 'reset'
  | 'invalidNumber'
  | 'invalidChoice'
  | 'save'
  | 'discard'
  | 'saving'
  | 'saveFailed'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'vl-gateway': VlGatewayLocaleKey
  }
}

export const zh: Record<VlGatewayLocaleKey, string> = {
  title: 'DeepSeek + Vision（视觉语言桥接）',
  description: '贴图后由这里的 VL 模型转成文字再发给 DeepSeek。留空即继承默认值。',
  apiKey: 'VL 模型密钥',
  apiKeyHint: '写入凭据存储，绝不出现在响应或设置里；留空不写。',
  apiKeySet: '已配置',
  apiKeyUnset: '未配置',
  apiKeyEnv: '密钥引用名',
  apiKeyEnvHint: '凭据/环境变量的名字，默认 QWEN_VL_API_KEY。',
  baseURL: 'VL 端点',
  baseURLHint: 'OpenAI 兼容网关，/chat/completions 会自动追加。默认 DashScope 兼容模式。',
  model: 'VL 模型',
  modelHint: '端点接受的模型 id，默认 qwen3-vl-flash。',
  describePrompt: '描述提示词',
  describePromptHint: '发给 VL 模型的描述指令；逐字提取代码、报错、日志、UI 文案等。',
  timeoutMs: '超时（毫秒）',
  timeoutMsHint: '单次描述请求的硬超时，默认 120000。',
  maxCacheEntries: '缓存条数',
  maxCacheEntriesHint: '进程内按图片去重的描述缓存容量，默认 64。',
  onFailure: '失败策略',
  onFailureHint: 'fail=描述失败整个请求失败；placeholder=降级为文字占位继续。',
  overridden: '已覆盖',
  reset: '重置',
  invalidNumber: '无效数字',
  invalidChoice: '无效选项',
  save: '保存',
  discard: '放弃修改',
  saving: '保存中…',
  saveFailed: '保存未全部生效',
}

export const en: Record<VlGatewayLocaleKey, string> = {
  title: 'DeepSeek + Vision (vision-language bridge)',
  description: 'Pasted images are described by this VL model before DeepSeek sees the text. Empty fields inherit the defaults.',
  apiKey: 'VL model API key',
  apiKeyHint: 'Written to the credential store; never appears in responses or settings. Leave blank to keep unchanged.',
  apiKeySet: 'configured',
  apiKeyUnset: 'not configured',
  apiKeyEnv: 'Credential reference',
  apiKeyEnvHint: 'Name of the credential/environment variable; defaults to QWEN_VL_API_KEY.',
  baseURL: 'VL endpoint',
  baseURLHint: 'Any OpenAI-compatible gateway; /chat/completions is appended. Defaults to the DashScope compatible endpoint.',
  model: 'VL model',
  modelHint: 'Model id the endpoint accepts; defaults to qwen3-vl-flash.',
  describePrompt: 'Description prompt',
  describePromptHint: 'Instruction sent with each image; ask for verbatim extraction of code, errors, logs, and UI text.',
  timeoutMs: 'Timeout (ms)',
  timeoutMsHint: 'Hard cap on one description request; defaults to 120000.',
  maxCacheEntries: 'Cache entries',
  maxCacheEntriesHint: 'Per-image in-process description cache capacity; defaults to 64.',
  onFailure: 'Failure policy',
  onFailureHint: 'fail: the whole request fails. placeholder: substitute an error note and continue.',
  overridden: 'overridden',
  reset: 'reset',
  invalidNumber: 'invalid number',
  invalidChoice: 'invalid choice',
  save: 'Save',
  discard: 'Discard',
  saving: 'Saving…',
  saveFailed: 'Save did not fully land',
}
