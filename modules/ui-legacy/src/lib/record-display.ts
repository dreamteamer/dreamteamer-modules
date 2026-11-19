/**
 * WHICH RECORD DISPLAY A RECORD PAGE DRAWS — pure, so the precedence is a test rather than a page.
 *
 * Descriptor v2 (§3.5): a collection's `display.record` is its default record page, and a
 * `scope: record` ui-view is a named variant whose `compiled.display.record` is that block merged
 * over the collection's. There is no `target: item, default: true` view any more.
 *
 * The engine's default record layout is `page` — "the built-in record page" — so it selects no
 * renderer of its own: `layout` is answered only for another name, and the caller's built-in
 * default (`properties`) stands otherwise.
 */
import type { UiViewRecord } from '../ui-views';
import { drawnDisplay } from '../ui-views';

export interface RecordDisplay {
	/** A registered record renderer id, or undefined for the built-in record page. */
	layout?: string;
	/** The renderer's options — where `relation_views` is authored. */
	options?: Record<string, unknown>;
}

/** The engine's name for the built-in record page. */
export const DEFAULT_RECORD_LAYOUT = 'page';

export function recordDisplayOf(view: UiViewRecord | undefined, collectionRecord: { layout?: string; options?: Record<string, unknown> } | undefined): RecordDisplay {
	const block = (view?.scope === 'record' ? drawnDisplay(view).record : undefined) ?? collectionRecord ?? {};
	const layout = typeof block.layout === 'string' && block.layout && block.layout !== DEFAULT_RECORD_LAYOUT ? block.layout : undefined;
	const options = block.options && typeof block.options === 'object' && !Array.isArray(block.options) ? (block.options as Record<string, unknown>) : undefined;
	return { ...(layout ? { layout } : {}), ...(options ? { options } : {}) };
}
