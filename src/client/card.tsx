/**
 * The VL gateway card component: a staged form over the `vl` sub-section of
 * the `llm-vl-gateway` settings namespace plus the VL credential control.
 *
 * The card is registered into the `settings.plugin.item` slot (the Plugins →
 * plugin-config section the in-box settings surface stacks); the section
 * supplies nothing, so the card draws its own chrome. Styles are one scoped
 * stylesheet injected at plugin load (the official client bundles do the same
 * through their CSS pipeline; this out-of-tree bundle ships a plain style tag).
 *
 * @module dsh-deepseek-vision/client/card
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the in-box client slot contract merges `settings.plugin.item` into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { VlGatewayCardFace } from './controller.js'

/** Props the renderer binds for the VL gateway card. */
export type VlGatewayCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'vl-gateway'>
  & InjectFace<VlGatewayCardFace>

/** One labeled text/select control of the card. */
function Field(props: {
  id: string
  label: string
  hint: string
  overriddenLabel: string
  resetLabel: string
  invalidLabel: string
  text: string
  overridden: boolean
  invalid: boolean
  disabled: boolean
  /** Hide the reset control — write-only fields (the credential) have no stored value to reset to. */
  noReset?: boolean
  type?: 'text' | 'number' | 'password' | 'select'
  choices?: readonly string[]
  onEdit: (text: string) => void
  onReset: () => void
}): import('react').ReactElement {
  return (
    <div className="vlgt-field">
      <div className="vlgt-field-head">
        <label className="vlgt-label" htmlFor={props.id}>{props.label}</label>
        {props.overridden && <span className="vlgt-badge">{props.overriddenLabel}</span>}
        {!props.noReset && (
          <button
            type="button"
            className="vlgt-reset"
            disabled={props.disabled || (!props.overridden && props.text === '')}
            onClick={props.onReset}
          >
            {props.resetLabel}
          </button>
        )}
      </div>
      {props.type === 'select' && props.choices !== undefined
        ? (
          <select
            id={props.id}
            className="vlgt-input"
            disabled={props.disabled}
            value={props.text}
            onChange={event => { props.onEdit(event.target.value) }}
          >
            <option value=""></option>
            {props.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
          </select>
        )
        : (
          <input
            id={props.id}
            className="vlgt-input"
            type={props.type ?? 'text'}
            disabled={props.disabled}
            value={props.text}
            onChange={event => { props.onEdit(event.target.value) }}
          />
        )}
      <div className="vlgt-hint">{props.invalid ? props.invalidLabel : props.hint}</div>
    </div>
  )
}

/**
 * Render the VL gateway card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function VlGatewayCard(props: VlGatewayCardProps) {
  const { t } = props
  const state = props.useVlGatewayCard(snapshot => snapshot)
  if (!state.available) return null
  const disabled = !state.writable
  return (
    <div className="vlgt-card">
      <div className="vlgt-head">
        <h3 className="vlgt-title">{t('title')}</h3>
        <p className="vlgt-description">{t('description')}</p>
      </div>

      <Field
        id="vlgt-apiKey"
        label={t('apiKey')}
        hint={t('apiKeyHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        type="password"
        noReset
        text={state.apiKey.text}
        overridden={state.apiKey.overridden}
        invalid={state.apiKey.invalid}
        disabled={!state.apiKeyWritable}
        onEdit={text => { props.edit('apiKey', text) }}
        onReset={() => { props.edit('apiKey', '') }}
      />
      <div className="vlgt-hint">{state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset')}</div>

      <Field
        id="vlgt-apiKeyEnv"
        label={t('apiKeyEnv')}
        hint={t('apiKeyEnvHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.apiKeyEnv}
        onEdit={text => { props.edit('apiKeyEnv', text) }}
        onReset={() => { props.resetField('apiKeyEnv') }}
      />
      <Field
        id="vlgt-baseURL"
        label={t('baseURL')}
        hint={t('baseURLHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseURL}
        onEdit={text => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <Field
        id="vlgt-model"
        label={t('model')}
        hint={t('modelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.model}
        onEdit={text => { props.edit('model', text) }}
        onReset={() => { props.resetField('model') }}
      />
      <Field
        id="vlgt-describePrompt"
        label={t('describePrompt')}
        hint={t('describePromptHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.describePrompt}
        onEdit={text => { props.edit('describePrompt', text) }}
        onReset={() => { props.resetField('describePrompt') }}
      />
      <Field
        id="vlgt-timeoutMs"
        label={t('timeoutMs')}
        hint={t('timeoutMsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        type="number"
        disabled={disabled}
        {...state.timeoutMs}
        onEdit={text => { props.edit('timeoutMs', text) }}
        onReset={() => { props.resetField('timeoutMs') }}
      />
      <Field
        id="vlgt-maxCacheEntries"
        label={t('maxCacheEntries')}
        hint={t('maxCacheEntriesHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        type="number"
        disabled={disabled}
        {...state.maxCacheEntries}
        onEdit={text => { props.edit('maxCacheEntries', text) }}
        onReset={() => { props.resetField('maxCacheEntries') }}
      />
      <Field
        id="vlgt-onFailure"
        label={t('onFailure')}
        hint={t('onFailureHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidChoice')}
        type="select"
        choices={['fail', 'placeholder']}
        disabled={disabled}
        {...state.onFailure}
        onEdit={text => { props.edit('onFailure', text) }}
        onReset={() => { props.resetField('onFailure') }}
      />

      <div className="vlgt-actions">
        {state.failed && <span className="vlgt-failed">{t('saveFailed')}</span>}
        {state.saving && <span className="vlgt-hint">{t('saving')}</span>}
        <button
          type="button"
          className="vlgt-button vlgt-button-primary"
          disabled={disabled || !state.dirty || state.invalid || state.saving}
          onClick={props.save}
        >
          {t('save')}
        </button>
        <button
          type="button"
          className="vlgt-button"
          disabled={!state.dirty || state.saving}
          onClick={props.discard}
        >
          {t('discard')}
        </button>
      </div>
    </div>
  )
}
