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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services (cordis fiber inject). */
export declare const inject: string[];
/**
 * Mount the VL gateway config card.
 * @param ctx - the browser plugin context.
 */
export declare function apply(ctx: ClientContext): void;
