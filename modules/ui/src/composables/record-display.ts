/**
 * useRecordDisplay(): WHICH record display a record page draws, read off the live sources — the
 * collection's row of the display contract (`useCollections`) and the loaded ui-views — through the
 * pure precedence in `lib/record-display.ts`.
 *
 * Its own composable, not inline in `ContentDetail`, because that page cannot mount in the render
 * tier (reka-ui) and the wire is what has to be proved: the collection's `display.record.options`
 * reaches its row as `record.options` (engine 0.33.0), and a `relation_views` authored THERE has to
 * reach the record page's renderer as its `options`, exactly as a `scope: record` view's does.
 */
import { computed, type ComputedRef } from 'vue';
import { useCollections } from './collections';
import { recordDisplayOf, type RecordDisplay } from '../lib/record-display';
import { uiViews } from '../ui-views';

export function useRecordDisplay(collection: () => string, viewId: () => string | undefined): ComputedRef<RecordDisplay> {
	const { tree } = useCollections();
	return computed(() => {
		const id = viewId();
		const view = id ? uiViews.value.find((v) => v.id === id) : undefined;
		return recordDisplayOf(view, tree.value.find((row) => row.collection === collection())?.record);
	});
}
