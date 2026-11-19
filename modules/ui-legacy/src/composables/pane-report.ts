/**
 * THE PAGE'S REPORT TO THE CHAT (cr-modules-017 §5) — on a pane host only (reading 3). 200 ms after the last route
 * or selection change, one `PUT /selection { view, refs }`: the place in one of the four shapes and the ticked rows
 * as `<collection>/<id>`, at most 50 (a larger selection sends the first 50). Sent at every level — a Read pane
 * reports too (round-3 finding a-read-pane-cannot-report…). A refusal (a 400 for a record deleted between the tick and
 * the put) is dropped silently: the next change reports again.
 *
 * And the chat's push back: `dt:select { refs }` ticks those rows — App calls `receiveSelect`, which holds the refs
 * for the list of their collection and, when that collection is not the one on screen, goes there first.
 */
import { unref, watch, type Ref } from 'vue';
import type { Router } from 'vue-router';
import { hostRequest } from '../api/transport';
import { pageSelection, placeOf, pushedSelection, splitRef } from '../lib/pane-place';

export const MAX_REPORTED = 50;

type RouteLike = { name?: string | symbol | null; params: Record<string, unknown>; fullPath: string };

export function startPaneReport(o: {
	route: RouteLike | Ref<RouteLike>;
	collections: () => string[];
	request?: typeof hostRequest;
	debounceMs?: number;
}): () => void {
	const request = o.request ?? hostRequest;
	const delay = o.debounceMs ?? 200;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const send = (): void => {
		timer = null;
		const route = unref(o.route);
		const sel = pageSelection.value;
		const refs = sel ? sel.ids.slice(0, MAX_REPORTED).map((id) => `${sel.collection}/${id}`) : [];
		request('PUT', '/selection', { view: placeOf(route, o.collections()), refs }).catch(() => { /* a 400 is dropped */ });
	};
	const stopWatch = watch(
		() => [unref(o.route).fullPath, pageSelection.value, o.collections().length],
		() => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(send, delay);
		},
		{ immediate: true },
	);
	return () => {
		stopWatch();
		if (timer) clearTimeout(timer);
		timer = null;
	};
}

/** `dt:select { refs }` from the server: hold them for the list of their collection; go there first when it is not
 *  the one on screen. `[]` clears whatever is ticked. */
export function receiveSelect(refs: unknown, o: { router: Router; collections: () => string[] }): void {
	const list = Array.isArray(refs) ? refs.filter((r): r is string => typeof r === 'string') : [];
	pushedSelection.value = { refs: list, at: Date.now() };
	if (!list.length) return;
	const target = splitRef(list[0], o.collections())?.collection;
	if (!target) return;
	const here = placeOf(o.router.currentRoute.value, o.collections());
	if ('collection' in here && here.collection === target && !('id' in here)) return;
	void o.router.push(`/content/${target}`);
}
