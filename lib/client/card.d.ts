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
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { VlGatewayCardFace } from './controller.js';
/** Props the renderer binds for the VL gateway card. */
export type VlGatewayCardProps = PropsRuntime<'settings.plugin.item'> & PropsLocale<'vl-gateway'> & InjectFace<VlGatewayCardFace>;
/**
 * Render the VL gateway card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export declare function VlGatewayCard(props: VlGatewayCardProps): import("react").JSX.Element | null;
