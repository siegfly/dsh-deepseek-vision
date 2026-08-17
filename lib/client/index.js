/**
 * Client plugin half of dsh-deepseek-vision: registers one config card into the
 * Plugins → plugin-config section (slot `settings.plugin.item`) so the
 * `llm-vl-gateway.vl` section — endpoint, model, prompt, and the VL key — is
 * editable from the web GUI exactly like the in-box plugin cards.
 *
 * Cross-plugin collaboration goes through cordis services only (client bundle
 * purity gate): settingsScope for the section, connection's api for
 * path-addressed settings writes and the credential domain, locale for copy,
 * and the slots registry for the card contribution.
 *
 * @module dsh-deepseek-vision/client
 */
import { VlGatewayCard } from './card.js';
import { GATEWAY_SETTINGS_NS, VlGatewayCardController } from './controller.js';
import { NS, en, zh } from './locales.js';
/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope'];
const STYLES = `
.vlgt-card { padding: 12px 16px 16px; border: 1px solid var(--dsh-border, rgba(128,128,128,.35)); border-radius: 8px; }
.vlgt-head { margin-bottom: 10px; }
.vlgt-title { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.vlgt-description { margin: 0; font-size: 12px; opacity: .75; }
.vlgt-field { margin: 10px 0; }
.vlgt-field-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.vlgt-label { font-size: 12px; font-weight: 500; }
.vlgt-badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--dsh-accent, rgba(64,128,255,.18)); }
.vlgt-reset { margin-left: auto; font-size: 11px; border: 0; background: transparent; cursor: pointer; opacity: .7; }
.vlgt-reset:disabled { opacity: .3; cursor: default; }
.vlgt-input { width: 100%; box-sizing: border-box; padding: 6px 8px; font: inherit; font-size: 13px; border-radius: 6px; border: 1px solid var(--dsh-border, rgba(128,128,128,.35)); background: transparent; color: inherit; }
.vlgt-hint { margin-top: 3px; font-size: 11px; opacity: .65; }
.vlgt-actions { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.vlgt-failed { font-size: 11px; color: var(--dsh-danger, #e5484d); }
.vlgt-button { padding: 5px 12px; font: inherit; font-size: 12px; border-radius: 6px; border: 1px solid var(--dsh-border, rgba(128,128,128,.35)); background: transparent; color: inherit; cursor: pointer; }
.vlgt-button:disabled { opacity: .4; cursor: default; }
.vlgt-button-primary { background: var(--dsh-accent, rgba(64,128,255,.85)); border-color: transparent; color: #fff; }
`;
/** Inject the card's scoped stylesheet; removed when the plugin unloads. */
function injectStyles() {
    if (typeof document === 'undefined')
        return () => { };
    const id = 'dsh-deepseek-vision-styles';
    if (document.getElementById(id) !== null)
        return () => { };
    const tag = document.createElement('style');
    tag.id = id;
    tag.dataset.plugin = 'dsh-deepseek-vision';
    tag.textContent = STYLES;
    document.head.appendChild(tag);
    return () => { tag.remove(); };
}
/**
 * Mount the VL gateway config card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx) {
    const { api } = ctx.get('connection');
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'vl-gateway: card dictionaries');
    const removeStyles = injectStyles();
    ctx.effect(() => removeStyles, 'vl-gateway: card styles');
    const controller = new VlGatewayCardController(ctx.settingsScope.bind({ namespace: 'llm-vl-gateway' }), api);
    // The credential the card reports is not part of any settings section, so
    // its scope publishes nothing when one is written elsewhere. This forwarded
    // event is the only signal that a key written on another surface reached
    // the Host.
    ctx.effect(() => ctx.remote.$on('credentials/updated', (ref) => { controller.refreshCredential(ref); }), 'vl-gateway: credential invalidations');
    // One registration carries BOTH slot shapes so the same built bundle installs
    // on rc.6 and rc.7: rc.7 keyed `settings.plugin.item` by the settings
    // namespace (`key`), while rc.6 declared it as a `list` (`id` + `order`).
    // The loader validates only the field matching its declared kind and stores
    // the rest, so a single entry satisfies either. Hoisted (not inlined) so the
    // other version's fields are not fresh-literal excess-property errors.
    // Retire `id`/`order` and re-inline once the rc.6 support line is dropped.
    const cardEntry = {
        name: 'settings.plugin.item',
        key: GATEWAY_SETTINGS_NS,
        id: 'vl-gateway',
        order: 30,
        locale: NS,
        inject: () => controller.inject(),
    };
    ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register(cardEntry, VlGatewayCard);
    });
}
