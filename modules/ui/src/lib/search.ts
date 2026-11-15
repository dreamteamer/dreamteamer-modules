/**
 * ONE SEARCH (cr-modules-022) — the browser host's Cmd/Ctrl-K. The protocol has no cross-collection search route, so
 * this asks each collection the nav lists for its rows matching the term (`GET /collections/<c>/records?q=…&limit=…`,
 * the per-collection substring search every list already uses), a few collections at a time, and ranks what comes
 * back: a title that starts with the term, then one that contains it, then a row that matched on another field.
 * A collection that refuses (a layer that cannot be read, a level) is skipped, never an error.
 */
export interface SearchHit { collection: string; collectionTitle: string; icon?: string; id: string; title: string; route: string; rank: number }
export interface SearchTarget { collection: string; title: string; icon?: string; titleOf: (record: Record<string, unknown>) => string }

export const SEARCH_PER_COLLECTION = 6;
export const SEARCH_MAX_HITS = 40;
const PARALLEL = 6;

/** 0: the title starts with the term · 1: a word of the title does · 2: the title contains it · 3: another field did. */
export function rankTitle(title: string, term: string): number {
	const t = title.toLocaleLowerCase();
	const q = term.trim().toLocaleLowerCase();
	if (!q) return 3;
	if (t.startsWith(q)) return 0;
	if (t.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 1;
	return t.includes(q) ? 2 : 3;
}

/** Best rank first, then shorter titles (a closer match), then by collection and title so the order is stable. */
export function sortHits(hits: SearchHit[]): SearchHit[] {
	return [...hits].sort((a, b) => a.rank - b.rank || a.title.length - b.title.length || a.collectionTitle.localeCompare(b.collectionTitle) || a.title.localeCompare(b.title));
}

export async function searchRecords(
	term: string,
	targets: readonly SearchTarget[],
	request: (method: string, path: string) => Promise<unknown>,
	isStale: () => boolean = () => false,
): Promise<SearchHit[]> {
	const q = term.trim();
	if (q.length < 2) return [];
	const hits: SearchHit[] = [];
	let next = 0;
	const worker = async () => {
		while (next < targets.length && !isStale()) {
			const target = targets[next++];
			try {
				const res = (await request('GET', `/collections/${encodeURIComponent(target.collection)}/records?q=${encodeURIComponent(q)}&limit=${SEARCH_PER_COLLECTION}`)) as { records?: Record<string, unknown>[] } | null;
				for (const record of res?.records ?? []) {
					const id = typeof record['id'] === 'string' ? record['id'] : '';
					if (!id) continue;
					const title = target.titleOf(record) || id;
					hits.push({ collection: target.collection, collectionTitle: target.title, ...(target.icon ? { icon: target.icon } : {}), id, title, route: `/content/${target.collection}/${id}`, rank: rankTitle(title, q) });
				}
			} catch { /* a collection that will not answer is left out */ }
		}
	};
	await Promise.all(Array.from({ length: Math.min(PARALLEL, targets.length) }, worker));
	return sortHits(hits).slice(0, SEARCH_MAX_HITS);
}
